## SecureLiquidPool Program - Complete Working Explanation

### Overview Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           USER FLOW (Stake SOL → JitoSOL)                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   [1] USER INTENT          [2] COMMIT PHASE         [3] REVEAL PHASE        │
│   ──────────────           ────────────────         ────────────────        │
│                                                                             │
│   "I want to stake         Hash is stored           Verify hash, execute    │
│    2 SOL for JitoSOL"      on-chain (hidden)        Jupiter + Jito CPI      │
│                                                                             │
│         │                        │                        │                 │
│         ▼                        ▼                        ▼                 │
│   ┌───────────┐            ┌───────────┐            ┌───────────┐           │
│   │  Jupiter  │            │ Commitment│            │  Jupiter  │           │
│   │   Quote   │────────────│    PDA    │────────────│   CPI     │           │
│   │   (API)   │  SHA-256   │  (Chain)  │  Verify    │  + Jito   │           │
│   └───────────┘            └───────────┘            └───────────┘           │
│                                                                             │
│   OFF-CHAIN                ON-CHAIN                 ON-CHAIN                │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

### Step-by-Step Program Flow

#### **STEP 1: User Prepares Stake (Off-chain)**

```
User wants to stake 2 SOL
        │
        ▼
┌─────────────────────────────────────┐
│  Frontend calls Jupiter API         │
│  GET /quote?inputMint=SOL           │
│         &outputMint=JitoSOL         │
│         &amount=2000000000          │
│                                     │
│  Response:                          │
│  {                                  │
│    inAmount: 2000000000,            │
│    outAmount: 1950000000,  ◄─── Expected JitoSOL output
│    slippageBps: 50,                 │
│    ...                              │
│  }                                  │
└─────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────┐
│  Create SwapDetails struct:         │
│  {                                  │
│    amount_in: 2000000000,           │
│    min_out: 1950000000,             │
│    slippage_bps: 50,                │
│    nonce: [random 32 bytes]  ◄─── Prevents replay attacks
│  }                                  │
└─────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────┐
│  Hash = SHA-256(SwapDetails)        │
│                                     │
│  This hash HIDES:                   │
│  - How much SOL being staked        │
│  - Expected output amount           │
│  - Slippage tolerance               │
│                                     │
│  MEV bots see ONLY the hash!        │
└─────────────────────────────────────┘
```

---

#### **STEP 2: Commit Phase (On-chain)**

```rust
// Program Instruction: commit(hash: [u8; 32])

pub fn commit(ctx: Context<Commit>, hash: [u8; 32]) -> Result<()> {
    let commitment = &mut ctx.accounts.commitment;
    
    // Store commitment data in PDA
    commitment.user = ctx.accounts.user.key();
    commitment.hash = hash;                              // ◄── The hidden intent
    commitment.timestamp = Clock::get()?.unix_timestamp; // ◄── For delay enforcement
    commitment.bump = ctx.bumps.commitment;
    
    Ok(())
}
```

**What happens on-chain:**

```
┌──────────────────────────────────────────────────────────────┐
│                    COMMITMENT PDA                             │
│  Address: PDA([b"commit", user_pubkey], program_id)          │
├──────────────────────────────────────────────────────────────┤
│  user:      0x7a3b...4c2d  (user's wallet)                   │
│  hash:      0x8f2e...1a9b  (SHA-256 of SwapDetails)          │
│  timestamp: 1701234567     (Unix timestamp)                  │
│  bump:      254            (PDA bump seed)                   │
└──────────────────────────────────────────────────────────────┘

MEV Bot sees this transaction:
┌─────────────────────────────────────┐
│ "User committed hash 0x8f2e...1a9b" │
│                                     │
│ Bot: "I have NO IDEA what this      │
│       user is planning to do!"      │
│                                     │
│ ❌ Cannot front-run                 │
│ ❌ Cannot sandwich                  │
└─────────────────────────────────────┘
```

---

#### **STEP 3: Wait Period (Delay Enforcement)**

```
Time: T                    Time: T + 1 second
      │                          │
      ▼                          ▼
┌───────────┐              ┌───────────┐
│  Commit   │──── wait ────│  Reveal   │
│  Tx       │   (1-2 sec)  │  Allowed  │
└───────────┘              └───────────┘

WHY THE DELAY?
─────────────
Even if a bot SOMEHOW guesses the intent,
they cannot act on it because:

1. The reveal transaction is bundled via Jito
2. The delay ensures commit is finalized first
3. Atomic execution prevents manipulation
```

---

#### **STEP 4: Reveal Phase (On-chain)**

```rust
pub fn reveal_and_stake(
    ctx: Context<RevealAndStake>,
    details: SwapDetails,           // ◄── Original swap parameters
    jupiter_swap_data: Vec<u8>,     // ◄── Jupiter instruction data
) -> Result<()> {
    let commitment = &ctx.accounts.commitment;
    
    // ═══════════════════════════════════════════════════════
    // STEP 4a: Verify Time Delay
    // ═══════════════════════════════════════════════════════
    let now = Clock::get()?.unix_timestamp;
    require!(
        now >= commitment.timestamp + 1,  // At least 1 second delay
        ErrorCode::DelayNotMet
    );
    
    // ═══════════════════════════════════════════════════════
    // STEP 4b: Verify Hash Matches
    // ═══════════════════════════════════════════════════════
    let input = details.try_to_vec()?;
    let computed_hash = solana_program::hash::hash(&input).to_bytes();
    
    require!(
        computed_hash == commitment.hash,
        ErrorCode::HashMismatch  // ◄── Prevents tampering!
    );
    
    // ═══════════════════════════════════════════════════════
    // STEP 4c: Validate Price with Pyth Oracle
    // ═══════════════════════════════════════════════════════
    let price_update = &ctx.accounts.price_update;
    let price = price_update.get_price_no_older_than(
        &Clock::get()?,
        60,  // Max 60 seconds old
        &get_feed_id_from_hex(SOL_USD_FEED)?,
    )?;
    
    // Check that min_out is reasonable given oracle price
    // Protects against stale Jupiter quotes
    
    // ═══════════════════════════════════════════════════════
    // STEP 4d: Execute Jupiter Swap via CPI
    // ═══════════════════════════════════════════════════════
    let jupiter_ix = Instruction {
        program_id: ctx.accounts.jupiter_program.key(),
        accounts: build_jupiter_accounts(&ctx),
        data: jupiter_swap_data,
    };
    
    invoke(&jupiter_ix, &ctx.accounts.to_account_infos())?;
    
    // User now has wSOL or intermediate token
    
    // ═══════════════════════════════════════════════════════
    // STEP 4e: Deposit to Jito Stake Pool
    // ═══════════════════════════════════════════════════════
    let deposit_ix = spl_stake_pool::instruction::deposit_sol(
        &spl_stake_pool::id(),
        &ctx.accounts.jito_stake_pool.key(),
        // ... other stake pool accounts
        details.amount_in,
    );
    
    invoke(&deposit_ix, &stake_pool_accounts)?;
    
    // User now has JitoSOL!
    
    // ═══════════════════════════════════════════════════════
    // STEP 4f: Close Commitment PDA (Return Rent)
    // ═══════════════════════════════════════════════════════
    // The `close = user` attribute returns rent to user
    
    Ok(())
}
```

---

### Visual Flow of the Reveal Transaction

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      REVEAL TRANSACTION (Bundled via Jito)              │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  Instruction 1: reveal_and_stake                                        │
│  ─────────────────────────────────                                      │
│     │                                                                   │
│     ├──► Verify delay (timestamp check)                                 │
│     │                                                                   │
│     ├──► Verify hash (SHA-256 match)                                    │
│     │                                                                   │
│     ├──► Validate price (Pyth CPI)                                      │
│     │         │                                                         │
│     │         └──► Pyth Program ──► Returns SOL/USD price               │
│     │                                                                   │
│     ├──► Execute swap (Jupiter CPI)                                     │
│     │         │                                                         │
│     │         └──► Jupiter Program                                      │
│     │               ├──► Raydium                                        │
│     │               ├──► Orca                                           │
│     │               └──► Best route executed                            │
│     │                                                                   │
│     ├──► Deposit to Jito (Stake Pool CPI)                               │
│     │         │                                                         │
│     │         └──► SPL Stake Pool Program                               │
│     │               └──► Mints JitoSOL to user                          │
│     │                                                                   │
│     └──► Close PDA (return rent)                                        │
│                                                                         │
│  Instruction 2: Jito Tip (for bundle priority)                          │
│  ─────────────────────────────────────────────                          │
│     └──► Transfer 0.001 SOL to Jito tip account                         │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

### Why This Protects Against Sandwich Attacks

```
NORMAL SWAP (Vulnerable):
═════════════════════════
Mempool visibility:
┌─────────────────────────────────────┐
│ User: "Swap 2 SOL for JitoSOL"      │◄── Bot sees this!
└─────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────┐
│ MEV Bot Front-run: Buy JitoSOL      │ Price ↑
├─────────────────────────────────────┤
│ User Swap: Gets less JitoSOL        │ User loses
├─────────────────────────────────────┤
│ MEV Bot Back-run: Sell JitoSOL      │ Bot profits
└─────────────────────────────────────┘


COMMIT-REVEAL (Protected):
══════════════════════════
Phase 1 - Commit:
┌─────────────────────────────────────┐
│ User: "Hash = 0x8f2e...1a9b"        │◄── Bot sees NOTHING useful
└─────────────────────────────────────┘
         │
         ▼
Phase 2 - Reveal (Jito Bundle):
┌─────────────────────────────────────┐
│ Atomic Bundle:                      │
│ ├─ Verify hash                      │
│ ├─ Jupiter swap                     │◄── All in ONE atomic bundle
│ ├─ Jito deposit                     │
│ └─ Tip to Jito                      │
└─────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────┐
│ ✅ No front-running possible        │
│ ✅ No sandwich possible             │
│ ✅ Transaction lands atomically     │
└─────────────────────────────────────┘
```

---

### Account Structure Summary

```
┌─────────────────────────────────────────────────────────────────┐
│                        PROGRAM ACCOUNTS                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  COMMITMENT PDA (per user)                                      │
│  Seeds: ["commit", user_pubkey]                                 │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ user: Pubkey          │ Who made the commitment           │  │
│  │ hash: [u8; 32]        │ SHA-256 of swap details           │  │
│  │ timestamp: i64        │ When committed (for delay)        │  │
│  │ bump: u8              │ PDA bump seed                     │  │
│  │ amount_lamports: u64  │ Amount being staked               │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
│  EXTERNAL ACCOUNTS (passed in)                                  │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ Pyth Price Feed       │ SOL/USD oracle price              │  │
│  │ Jupiter Program       │ For swap CPI                      │  │
│  │ Jupiter Accounts      │ DEX accounts (via remaining)      │  │
│  │ Jito Stake Pool       │ For deposit CPI                   │  │
│  │ JitoSOL Mint          │ Token mint address                │  │
│  │ User Token Account    │ Receives JitoSOL                  │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

### Unstake Flow (Reverse Direction)

The unstake flow mirrors the stake flow:

```
┌─────────────────────────────────────────────────────────────────┐
│                    UNSTAKE: JitoSOL → SOL                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. COMMIT: Hash(JitoSOL amount, min SOL out, nonce)            │
│                                                                 │
│  2. REVEAL:                                                     │
│     ├─ Verify hash                                              │
│     ├─ Withdraw from Jito stake pool (get SOL)                  │
│     ├─ Optional: Jupiter swap if needed                         │
│     └─ Close commitment PDA                                     │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

This architecture provides **MEV protection** through the commit-reveal pattern while leveraging **Jupiter's optimal routing** and **Jito's liquid staking rewards**. The Jito bundle ensures atomic execution of the reveal transaction, preventing any manipulation between steps.