# SecureLiquidPool - Complete User Flow & Technical Documentation

## Table of Contents
1. [Architecture Overview](#1-architecture-overview)
2. [On-Chain Programs](#2-on-chain-programs)
3. [Exchange Rate Math](#3-exchange-rate-math)
4. [MEV Protection: Commit-Reveal Flow](#4-mev-protection-commit-reveal-flow)
5. [User Flows](#5-user-flows)
6. [Testing Guide](#6-testing-guide)
7. [Program Addresses](#7-program-addresses)

---

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          FRONTEND (Next.js)                              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐    │
│  │   Stake     │  │   Unstake   │  │   Swap      │  │  Liquidity  │    │
│  │   Form      │  │   Form      │  │   Form      │  │   Form      │    │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘    │
│         │                │                │                │            │
│         └────────────────┴────────────────┴────────────────┘            │
│                                   │                                      │
│                    ┌──────────────▼──────────────┐                      │
│                    │     useCommitReveal Hook    │                      │
│                    │   (Commit-Reveal Workflow)  │                      │
│                    └──────────────┬──────────────┘                      │
└───────────────────────────────────┼──────────────────────────────────────┘
                                    │
                           Solana RPC (Devnet)
                                    │
┌───────────────────────────────────┼──────────────────────────────────────┐
│                          ON-CHAIN PROGRAMS                               │
│                                   │                                      │
│  ┌────────────────────────────────▼────────────────────────────────┐    │
│  │              SecureLP Program (MEV Protection)                   │    │
│  │  ┌──────────┐   ┌───────────────────┐   ┌──────────────────┐   │    │
│  │  │  commit  │   │ reveal_and_stake  │   │ reveal_and_swap  │   │    │
│  │  └────┬─────┘   └─────────┬─────────┘   └────────┬─────────┘   │    │
│  │       │                   │                       │             │    │
│  │       │           ┌───────┴───────┐               │             │    │
│  │       │           │     CPI       │               │             │    │
│  │       │           ▼               ▼               │             │    │
│  └───────┼───────────────────────────────────────────┼─────────────┘    │
│          │                                           │                   │
│  ┌───────▼────────────────┐      ┌───────────────────▼──────────────┐   │
│  │   Stake Pool Program   │      │           AMM Program            │   │
│  │  ┌────────────────┐   │      │  ┌────────────────────────────┐  │   │
│  │  │  deposit_sol   │   │      │  │          swap              │  │   │
│  │  │  withdraw_sol  │   │      │  │    add_liquidity           │  │   │
│  │  │ harvest_rewards│   │      │  │   remove_liquidity         │  │   │
│  │  └────────────────┘   │      │  └────────────────────────────┘  │   │
│  └───────────────────────┘      └──────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 2. On-Chain Programs

### 2.1 Stake Pool Program (`EyWBdqo6J5KEzQSvPYhsGFXjJfC6kkmTMGo8JTEzqhZ7`)

The stake pool manages liquid staking with the following key features:

#### State: `PoolConfig`
```rust
pub struct PoolConfig {
    pub admin: Pubkey,              // Pool admin
    pub slp_mint: Pubkey,           // slpSOL token mint
    pub total_staked_lamports: u64, // SOL delegated to validators
    pub total_slp_supply: u64,      // Total slpSOL minted
    pub reserve_lamports: u64,      // SOL kept liquid for instant unstakes
    pub fee_bps: u16,               // Protocol fee (50 = 0.5%)
    pub last_harvest_epoch: u64,    // Last epoch rewards harvested
    // ...
}
```

#### Instructions

| Instruction | Purpose | Key Logic |
|-------------|---------|-----------|
| `initialize_pool` | Create pool + slpSOL mint | Sets admin, fee, creates mint with PDA authority |
| `deposit_sol` | Stake SOL → get slpSOL | Calculates exchange rate, transfers SOL, mints slpSOL |
| `withdraw_sol` | Burn slpSOL → get SOL | Verifies reserve, burns slpSOL, transfers SOL |
| `harvest_rewards` | Simulate staking rewards | Adds ~7% APY worth of SOL to pool (increases exchange rate) |
| `delegate_stake` | Move reserve → staked | Tracks delegation to validators |

#### Code: Deposit SOL
```rust
pub fn deposit_sol(ctx: Context<DepositSol>, amount_lamports: u64) -> Result<()> {
    // Calculate how much slpSOL to mint
    let slp_to_mint = pool.calculate_slp_for_deposit(amount_lamports)?;
    
    // Transfer SOL from user to reserve vault
    system_program::transfer(cpi_context, amount_lamports)?;
    
    // Update pool state
    pool.reserve_lamports += reserve_amount;
    pool.total_staked_lamports += stake_amount;
    pool.total_slp_supply += slp_to_mint;
    
    // Mint slpSOL to user's token account
    token::mint_to(cpi_ctx, slp_to_mint)?;
}
```

---

### 2.2 AMM Program (`AcaXW2nDrvkpmuZnuiARDRJzmmfT1AZwLm4SMeYwnXKS`)

A constant-product (x * y = k) AMM for slpSOL/SOL trading.

#### State: `AmmPool`
```rust
pub struct AmmPool {
    pub authority: Pubkey,          // Admin
    pub token_a_mint: Pubkey,       // SOL wrapped (wSOL)
    pub token_b_mint: Pubkey,       // slpSOL
    pub token_a_vault: Pubkey,      // SOL vault
    pub token_b_vault: Pubkey,      // slpSOL vault
    pub lp_mint: Pubkey,            // LP token mint
    pub reserve_a: u64,             // SOL in pool
    pub reserve_b: u64,             // slpSOL in pool
    pub total_lp_supply: u64,       // LP tokens issued
    pub fee_bps: u16,               // Swap fee (30 = 0.3%)
    // ...
}
```

#### Instructions

| Instruction | Purpose | Key Logic |
|-------------|---------|-----------|
| `initialize_pool` | Create AMM pool | Sets token pair, creates vaults and LP mint |
| `add_liquidity` | Deposit both tokens | Mints LP tokens proportional to contribution |
| `remove_liquidity` | Burn LP → get both tokens | Returns tokens proportional to LP share |
| `swap` | Trade A ↔ B | Constant product formula with fee |

#### Code: Swap with Constant Product
```rust
pub fn calculate_swap_output(&self, amount_in: u64, a_to_b: bool) -> Result<(u64, u64)> {
    let (input_reserve, output_reserve) = if a_to_b {
        (self.reserve_a, self.reserve_b)
    } else {
        (self.reserve_b, self.reserve_a)
    };

    // Apply fee (e.g., 0.3%)
    let fee_multiplier = 10000 - self.fee_bps as u64;
    let amount_in_after_fee = amount_in * fee_multiplier / 10000;
    let fee = amount_in - amount_in_after_fee;

    // Constant product: k = x * y
    // new_output = output_reserve - k / (input_reserve + amount_in_after_fee)
    // Simplified: amount_out = (output_reserve * amount_in_after_fee) / (input_reserve + amount_in_after_fee)
    let numerator = output_reserve * amount_in_after_fee;
    let denominator = input_reserve + amount_in_after_fee;
    let amount_out = numerator / denominator;

    Ok((amount_out, fee))
}
```

---

### 2.3 SecureLP Program (`BMxQAdqNJE3Zn6iJedc6A6XbsSTmNBQi6UzFdfrNvE21`)

MEV protection using commit-reveal pattern.

#### State: `Commitment`
```rust
pub struct Commitment {
    pub user: Pubkey,           // User who committed
    pub hash: [u8; 32],         // SHA-256 of SwapDetails
    pub timestamp: i64,         // When commitment was created
    pub amount_lamports: u64,   // Amount (for display)
    pub is_stake: bool,         // true = stake, false = unstake
    pub bump: u8,               // PDA bump
}
```

#### SwapDetails (Hashed)
```rust
pub struct SwapDetails {
    pub amount_in: u64,         // Amount to swap
    pub min_out: u64,           // Minimum output (slippage protection)
    pub slippage_bps: u16,      // Slippage tolerance
    pub nonce: [u8; 32],        // Random nonce (prevents replay)
}
```

---

## 3. Exchange Rate Math

### 3.1 Initial State (First Deposit)
```
total_staked_lamports = 0
total_slp_supply = 0
exchange_rate = 1.0 (1 SOL = 1 slpSOL)
```

### 3.2 Exchange Rate Formula
```
exchange_rate = (total_staked_lamports + reserve_lamports) / total_slp_supply
```

### 3.3 Example Scenario

**Step 1: User A deposits 100 SOL**
```
Before:  total_sol = 0, slp_supply = 0
Action:  deposit 100 SOL
After:   total_sol = 100, slp_supply = 100
Rate:    100/100 = 1.0
User A receives: 100 slpSOL
```

**Step 2: Rewards harvested (+7 SOL simulated)**
```
Before:  total_sol = 100, slp_supply = 100
Action:  harvest_rewards adds 7 SOL (7% APY)
After:   total_sol = 107, slp_supply = 100
Rate:    107/100 = 1.07 SOL per slpSOL
```

**Step 3: User B deposits 50 SOL**
```
Current rate: 1.07 SOL per slpSOL
slpSOL to mint: 50 / 1.07 = 46.73 slpSOL

Before:  total_sol = 107, slp_supply = 100
After:   total_sol = 157, slp_supply = 146.73
Rate:    157/146.73 ≈ 1.07 (unchanged!)
```

**Step 4: User A unstakes 50 slpSOL**
```
Current rate: 1.07 SOL per slpSOL
SOL to return: 50 × 1.07 = 53.5 SOL

User A started with 100 SOL, gets back 53.5 SOL for half their slpSOL
Total value of User A's position: 107 SOL (53.5 + 53.5)
Profit: 7 SOL (from staking rewards)
```

---

## 4. MEV Protection: Commit-Reveal Flow

### 4.1 The Problem: Sandwich Attacks

Without protection:
```
1. User submits: "Stake 10 SOL at current rate"
2. MEV bot sees this in mempool
3. MEV bot front-runs: buys slpSOL to raise price
4. User's tx executes at worse rate
5. MEV bot back-runs: sells slpSOL for profit
```

### 4.2 The Solution: Commit-Reveal

**Phase 1: Commit (Hidden Intent)**
```javascript
// Frontend creates swap details
const swapDetails = {
  amountIn: 10_000_000_000n,  // 10 SOL
  minOut: 9_500_000_000n,     // min 9.5 slpSOL (5% slippage)
  slippageBps: 500,
  nonce: crypto.getRandomValues(new Uint8Array(32))
};

// Hash the details (hidden from MEV bots)
const hash = sha256(serialize(swapDetails));

// Submit commit transaction
await program.methods.commit(hash, amount, true).rpc();
```

What MEV bots see: `hash: 0x7f3a...` (meaningless)
What they DON'T see: actual amount, slippage, direction

**Phase 2: Reveal (After 1 second delay)**
```javascript
// Wait minimum delay
await sleep(1500);

// Submit reveal with original details
await program.methods
  .revealAndStake(swapDetails)
  .accounts({...})
  .rpc();
```

**On-Chain Verification:**
```rust
// Re-compute hash from provided details
let serialized = details.try_to_vec()?;
let computed_hash = sha256(serialized);

// Verify it matches stored commitment
require!(computed_hash == commitment.hash, HashMismatch);

// Verify minimum delay passed
require!(clock.timestamp >= commitment.timestamp + 1, DelayNotMet);

// Execute the actual stake/swap via CPI
deposit_sol(cpi_ctx, details.amount_in)?;
```

### 4.3 Why This Works

1. **Hidden Intent**: Commitment only reveals the hash - MEV bots can't decode the swap details
2. **Time Delay**: 1-second minimum delay makes front-running impractical (transactions already in block)
3. **Atomic Execution**: Reveal + execute happen in same transaction
4. **Slippage Protection**: `min_out` ensures user gets acceptable rate even if slight manipulation occurred

---

## 5. User Flows

### 5.1 Stake SOL → slpSOL

```
┌─────────────────────────────────────────────────────────────────┐
│                        STAKE FLOW                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  USER                    FRONTEND                  ON-CHAIN      │
│    │                        │                         │          │
│    │  Enter amount          │                         │          │
│    │  (e.g., 5 SOL)        │                         │          │
│    ├───────────────────────►│                         │          │
│    │                        │                         │          │
│    │                        │ Calculate quote         │          │
│    │                        │ (5 SOL → ~5 slpSOL)    │          │
│    │                        │                         │          │
│    │  Click "Stake"         │                         │          │
│    ├───────────────────────►│                         │          │
│    │                        │                         │          │
│    │                        │ 1. Create SwapDetails   │          │
│    │                        │ 2. Generate nonce       │          │
│    │                        │ 3. Compute hash         │          │
│    │                        │                         │          │
│    │                        │ Send commit tx          │          │
│    │                        ├────────────────────────►│          │
│    │                        │                         │          │
│    │                        │                   ┌─────┴─────┐    │
│    │                        │                   │  SecureLP │    │
│    │                        │                   │  commit() │    │
│    │                        │                   │  Creates  │    │
│    │                        │                   │  PDA with │    │
│    │                        │                   │  hash     │    │
│    │                        │                   └─────┬─────┘    │
│    │                        │◄────────────────────────┤          │
│    │                        │                         │          │
│    │  Show "Waiting 1s..."  │                         │          │
│    │◄───────────────────────┤                         │          │
│    │                        │                         │          │
│    │  (1 second passes)     │                         │          │
│    │                        │                         │          │
│    │                        │ Send reveal tx          │          │
│    │                        ├────────────────────────►│          │
│    │                        │                         │          │
│    │                        │                   ┌─────┴─────┐    │
│    │                        │                   │  SecureLP │    │
│    │                        │                   │reveal_and │    │
│    │                        │                   │  _stake() │    │
│    │                        │                   │    │      │    │
│    │                        │                   │    │ CPI  │    │
│    │                        │                   │    ▼      │    │
│    │                        │                   │StakePool  │    │
│    │                        │                   │deposit_sol│    │
│    │                        │                   │    │      │    │
│    │                        │                   │ Transfer  │    │
│    │                        │                   │   SOL     │    │
│    │                        │                   │    │      │    │
│    │                        │                   │ Mint      │    │
│    │                        │                   │  slpSOL   │    │
│    │                        │                   └─────┬─────┘    │
│    │                        │◄────────────────────────┤          │
│    │                        │                         │          │
│    │  Show "Complete! ✓"    │                         │          │
│    │  Balance: 5 slpSOL     │                         │          │
│    │◄───────────────────────┤                         │          │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 5.2 Unstake slpSOL → SOL

Same flow as stake, but:
- User enters slpSOL amount
- `reveal_and_unstake` calls `withdraw_sol` instead
- User receives SOL at current exchange rate

### 5.3 AMM Swap (Instant Trading)

For users who want immediate liquidity without waiting:

```
User has: 10 slpSOL
Wants: SOL immediately

AMM Pool State:
  reserve_a (SOL): 1000
  reserve_b (slpSOL): 950
  fee: 0.3%

Calculation:
  input = 10 slpSOL
  input_after_fee = 10 * 0.997 = 9.97
  output = (1000 * 9.97) / (950 + 9.97) = 10.38 SOL

User receives: ~10.38 SOL
```

---

## 6. Testing Guide

### 6.1 Prerequisites

```bash
# 1. Install Solana CLI
sh -c "$(curl -sSfL https://release.solana.com/v1.18.15/install)"

# 2. Configure for devnet
solana config set --url devnet

# 3. Create wallet (if needed)
solana-keygen new

# 4. Get devnet SOL
solana airdrop 2

# 5. Verify balance
solana balance
```

### 6.2 Start Frontend

```bash
cd frontend
bun install
bun run dev
# Open http://localhost:3000
```

### 6.3 Test Flow: Staking

1. **Connect Wallet**
   - Install Phantom wallet extension
   - Switch to Devnet in Phantom settings
   - Click "Connect Wallet" on the DApp

2. **Stake SOL**
   - Go to "Stake" tab
   - Enter amount (e.g., 0.5 SOL)
   - Click "Commit Intent"
   - Wait 1 second
   - Click "Execute Stake"
   - Check slpSOL balance in wallet

3. **View Dashboard**
   - Go to "Dashboard" tab
   - See pool stats (Total SOL, slpSOL supply, APY)
   - See your balances

### 6.4 Test Flow: Unstaking

1. Go to "Unstake" tab
2. Enter slpSOL amount
3. Click "Commit Intent"
4. Wait 1 second
5. Click "Execute Unstake"
6. Verify SOL returned to wallet

### 6.5 Test Flow: Simulate Rewards (CLI)

To see the exchange rate increase:

```bash
cd securelp

# Run harvest_rewards instruction
ANCHOR_PROVIDER_URL=https://api.devnet.solana.com \
ANCHOR_WALLET=~/.config/solana/id.json \
bunx ts-node scripts/harvest.ts  # You'd need to create this script
```

Or programmatically:
```typescript
const stakePoolProgram = getStakePoolProgram(provider);
const [poolConfigPda] = getPoolConfigPDA();

await stakePoolProgram.methods
  .harvestRewards()
  .accounts({
    cranker: wallet.publicKey,
    poolConfig: poolConfigPda,
  })
  .rpc();
```

### 6.6 Test Flow: AMM Swap

1. Go to "Swap" tab
2. Select direction (SOL → slpSOL or slpSOL → SOL)
3. Enter amount
4. Click "Commit Intent"
5. Wait 1 second
6. Click "Execute Swap"

### 6.7 Verify On-Chain Data

```bash
# View pool config
solana account DRXqHu3XPsgqT16Y7TYSHzgDNp8zEJPitXQTkEb7CSnP

# View slpSOL mint
spl-token display HdYGfy1Mk9WNZU8ZocQ1tNKfmGBApMWyFqNPRSya4V6s

# Check your slpSOL balance
spl-token balance HdYGfy1Mk9WNZU8ZocQ1tNKfmGBApMWyFqNPRSya4V6s
```

---

## 7. Program Addresses

### Deployed Programs (Devnet)

| Program | Address |
|---------|---------|
| SecureLP | `BMxQAdqNJE3Zn6iJedc6A6XbsSTmNBQi6UzFdfrNvE21` |
| Stake Pool | `EyWBdqo6J5KEzQSvPYhsGFXjJfC6kkmTMGo8JTEzqhZ7` |
| AMM | `AcaXW2nDrvkpmuZnuiARDRJzmmfT1AZwLm4SMeYwnXKS` |

### Initialized PDAs (Devnet)

| Account | Address | Purpose |
|---------|---------|---------|
| Pool Config | `DRXqHu3XPsgqT16Y7TYSHzgDNp8zEJPitXQTkEb7CSnP` | Main pool state |
| slpSOL Mint | `HdYGfy1Mk9WNZU8ZocQ1tNKfmGBApMWyFqNPRSya4V6s` | Liquid staking token |
| Reserve Vault | (Derived from pool config) | Holds liquid SOL |
| Pool Authority | (Derived from pool config) | Signs for minting |

### Explorer Links

- [SecureLP Program](https://explorer.solana.com/address/BMxQAdqNJE3Zn6iJedc6A6XbsSTmNBQi6UzFdfrNvE21?cluster=devnet)
- [Pool Config](https://explorer.solana.com/address/DRXqHu3XPsgqT16Y7TYSHzgDNp8zEJPitXQTkEb7CSnP?cluster=devnet)
- [slpSOL Token](https://explorer.solana.com/address/HdYGfy1Mk9WNZU8ZocQ1tNKfmGBApMWyFqNPRSya4V6s?cluster=devnet)

---

## Summary

SecureLiquidPool is a complete liquid staking DApp with:

1. **Real Staking Mechanics**: SOL → slpSOL at deterministic exchange rate
2. **MEV Protection**: Commit-reveal pattern hides swap intent
3. **Built-in AMM**: Instant trading without unstake delay
4. **Simulated Rewards**: ~7% APY via `harvest_rewards` instruction
5. **Full Frontend**: Modern UI with wallet integration

The exchange rate increases over time as rewards are harvested, making slpSOL worth more SOL than initially deposited.

