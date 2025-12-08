/**
 * Initialize AMM Pool Script
 * 
 * This script:
 * 1. Fetches the slpSOL mint from the stake pool
 * 2. Creates wSOL (wrapped SOL) for the user
 * 3. Stakes some SOL to get slpSOL (if user has none)
 * 4. Initializes the AMM pool with wSOL/slpSOL pair
 * 5. Adds initial liquidity
 * 
 * Usage:
 *   cd securelp
 *   ANCHOR_PROVIDER_URL=https://api.devnet.solana.com \
 *   ANCHOR_WALLET=~/.config/solana/id.json \
 *   bunx ts-node scripts/init-amm.ts
 */

import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider } from "@coral-xyz/anchor";
import BN from "bn.js";
import { 
  PublicKey, 
  Keypair, 
  SystemProgram, 
  LAMPORTS_PER_SOL,
  Transaction,
} from "@solana/web3.js";
import { 
  TOKEN_PROGRAM_ID, 
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  createSyncNativeInstruction,
  NATIVE_MINT,
  getAccount,
} from "@solana/spl-token";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Program IDs
const STAKE_POOL_PROGRAM_ID = new PublicKey("EyWBdqo6J5KEzQSvPYhsGFXjJfC6kkmTMGo8JTEzqhZ7");
const AMM_PROGRAM_ID = new PublicKey("AcaXW2nDrvkpmuZnuiARDRJzmmfT1AZwLm4SMeYwnXKS");

// PDA Seeds
const POOL_CONFIG_SEED = "pool_config";
const POOL_AUTHORITY_SEED = "pool_authority";
const RESERVE_VAULT_SEED = "reserve_vault";
const AMM_POOL_SEED = "amm_pool";
const AMM_AUTHORITY_SEED = "amm_authority";
const VAULT_A_SEED = "vault_a";
const VAULT_B_SEED = "vault_b";

// wSOL mint (Native Mint)
const WSOL_MINT = NATIVE_MINT;

// Initial liquidity amounts (in SOL)
const INITIAL_SOL_AMOUNT = 1; // 1 SOL
const INITIAL_SLP_AMOUNT = 1; // 1 slpSOL (will stake first if needed)

async function main() {
  console.log("=".repeat(60));
  console.log("SecureLiquidPool - AMM Pool Initialization");
  console.log("=".repeat(60));

  // Setup provider
  const provider = AnchorProvider.env();
  anchor.setProvider(provider);
  
  const wallet = provider.wallet.publicKey;
  console.log("\nWallet:", wallet.toString());
  console.log("Cluster:", provider.connection.rpcEndpoint);

  // Check wallet balance
  const balance = await provider.connection.getBalance(wallet);
  console.log("Balance:", (balance / LAMPORTS_PER_SOL).toFixed(4), "SOL");

  if (balance < 3 * LAMPORTS_PER_SOL) {
    console.log("\n⚠️  Warning: Low balance. Recommend at least 3 SOL for initialization.");
    console.log("   Run: solana airdrop 2");
  }

  // Load IDLs
  const stakePoolIdl = JSON.parse(
    fs.readFileSync(path.join(__dirname, "../target/idl/stake_pool.json"), "utf8")
  );
  const ammIdl = JSON.parse(
    fs.readFileSync(path.join(__dirname, "../target/idl/amm.json"), "utf8")
  );

  // Create program instances
  const stakePoolProgram = new Program(stakePoolIdl, provider);
  const ammProgram = new Program(ammIdl, provider);

  // =========================================================================
  // Step 1: Get Stake Pool Info
  // =========================================================================
  console.log("\n" + "-".repeat(60));
  console.log("Step 1: Fetching Stake Pool Info");
  console.log("-".repeat(60));

  const [poolConfig] = PublicKey.findProgramAddressSync(
    [Buffer.from(POOL_CONFIG_SEED)],
    STAKE_POOL_PROGRAM_ID
  );
  const [poolAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from(POOL_AUTHORITY_SEED), poolConfig.toBuffer()],
    STAKE_POOL_PROGRAM_ID
  );
  const [reserveVault] = PublicKey.findProgramAddressSync(
    [Buffer.from(RESERVE_VAULT_SEED), poolConfig.toBuffer()],
    STAKE_POOL_PROGRAM_ID
  );

  let poolData;
  try {
    poolData = await stakePoolProgram.account.poolConfig.fetch(poolConfig);
    console.log("✓ Stake pool found");
    console.log("  slpSOL Mint:", poolData.slpMint.toString());
  } catch (e) {
    console.error("✗ Stake pool not initialized! Run initialize.ts first.");
    process.exit(1);
  }

  const slpMint = poolData.slpMint;

  // =========================================================================
  // Step 2: Get or Create User Token Accounts
  // =========================================================================
  console.log("\n" + "-".repeat(60));
  console.log("Step 2: Setting Up Token Accounts");
  console.log("-".repeat(60));

  // wSOL account
  const userWsolAccount = await getAssociatedTokenAddress(WSOL_MINT, wallet);
  // slpSOL account
  const userSlpAccount = await getAssociatedTokenAddress(slpMint, wallet);

  console.log("User wSOL ATA:", userWsolAccount.toString());
  console.log("User slpSOL ATA:", userSlpAccount.toString());

  // Check if accounts exist
  let wsolExists = false;
  let slpExists = false;
  let slpBalance = BigInt(0);

  try {
    const wsolInfo = await getAccount(provider.connection, userWsolAccount);
    wsolExists = true;
    console.log("✓ wSOL account exists, balance:", Number(wsolInfo.amount) / LAMPORTS_PER_SOL);
  } catch {
    console.log("- wSOL account does not exist (will create)");
  }

  try {
    const slpInfo = await getAccount(provider.connection, userSlpAccount);
    slpExists = true;
    slpBalance = slpInfo.amount;
    console.log("✓ slpSOL account exists, balance:", Number(slpInfo.amount) / LAMPORTS_PER_SOL);
  } catch {
    console.log("- slpSOL account does not exist (will create)");
  }

  // =========================================================================
  // Step 3: Stake SOL to Get slpSOL (if needed)
  // =========================================================================
  console.log("\n" + "-".repeat(60));
  console.log("Step 3: Getting slpSOL (if needed)");
  console.log("-".repeat(60));

  const neededSlp = BigInt(INITIAL_SLP_AMOUNT * LAMPORTS_PER_SOL);
  
  if (slpBalance < neededSlp) {
    const stakeAmount = INITIAL_SLP_AMOUNT + 0.5; // Stake a bit extra
    console.log(`Staking ${stakeAmount} SOL to get slpSOL...`);

    // Create slpSOL account if it doesn't exist
    const preInstructions: any[] = [];
    if (!slpExists) {
      preInstructions.push(
        createAssociatedTokenAccountInstruction(
          wallet,
          userSlpAccount,
          wallet,
          slpMint
        )
      );
    }

    // Deposit SOL to stake pool
    const depositTx = await stakePoolProgram.methods
      .depositSol(new BN(stakeAmount * LAMPORTS_PER_SOL))
      .accounts({
        user: wallet,
        poolConfig: poolConfig,
        poolAuthority: poolAuthority,
        reserveVault: reserveVault,
        slpMint: slpMint,
        userSlpAccount: userSlpAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .preInstructions(preInstructions)
      .rpc();

    console.log("✓ Staked SOL, tx:", depositTx);

    // Wait for confirmation
    await new Promise(r => setTimeout(r, 2000));

    // Check new balance
    const newSlpInfo = await getAccount(provider.connection, userSlpAccount);
    slpBalance = newSlpInfo.amount;
    console.log("  New slpSOL balance:", Number(slpBalance) / LAMPORTS_PER_SOL);
  } else {
    console.log("✓ Already have enough slpSOL:", Number(slpBalance) / LAMPORTS_PER_SOL);
  }

  // =========================================================================
  // Step 4: Check if AMM Pool Already Exists
  // =========================================================================
  console.log("\n" + "-".repeat(60));
  console.log("Step 4: Checking AMM Pool Status");
  console.log("-".repeat(60));

  const [ammPool] = PublicKey.findProgramAddressSync(
    [Buffer.from(AMM_POOL_SEED), WSOL_MINT.toBuffer(), slpMint.toBuffer()],
    AMM_PROGRAM_ID
  );
  const [ammAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from(AMM_AUTHORITY_SEED), ammPool.toBuffer()],
    AMM_PROGRAM_ID
  );
  const [vaultA] = PublicKey.findProgramAddressSync(
    [Buffer.from(VAULT_A_SEED), ammPool.toBuffer()],
    AMM_PROGRAM_ID
  );
  const [vaultB] = PublicKey.findProgramAddressSync(
    [Buffer.from(VAULT_B_SEED), ammPool.toBuffer()],
    AMM_PROGRAM_ID
  );

  console.log("AMM Pool PDA:", ammPool.toString());
  console.log("AMM Authority:", ammAuthority.toString());
  console.log("Vault A (wSOL):", vaultA.toString());
  console.log("Vault B (slpSOL):", vaultB.toString());

  let ammExists = false;
  try {
    const ammData = await ammProgram.account.ammPool.fetch(ammPool);
    ammExists = true;
    console.log("\n✓ AMM pool already exists!");
    console.log("  Reserve A (wSOL):", Number(ammData.reserveA) / LAMPORTS_PER_SOL);
    console.log("  Reserve B (slpSOL):", Number(ammData.reserveB) / LAMPORTS_PER_SOL);
    console.log("  Total LP:", Number(ammData.totalLpSupply) / LAMPORTS_PER_SOL);
    console.log("  Fee:", ammData.feeBps, "bps");
  } catch {
    console.log("AMM pool does not exist yet, will initialize...");
  }

  // =========================================================================
  // Step 5: Initialize AMM Pool (if needed)
  // =========================================================================
  if (!ammExists) {
    console.log("\n" + "-".repeat(60));
    console.log("Step 5: Initializing AMM Pool");
    console.log("-".repeat(60));

    // Generate LP mint keypair
    const lpMintKeypair = Keypair.generate();
    console.log("LP Mint:", lpMintKeypair.publicKey.toString());

    try {
      const initTx = await ammProgram.methods
        .initializePool(30) // 0.3% fee
        .accounts({
          authority: wallet,
          tokenAMint: WSOL_MINT,
          tokenBMint: slpMint,
          pool: ammPool,
          poolAuthority: ammAuthority,
          tokenAVault: vaultA,
          tokenBVault: vaultB,
          lpMint: lpMintKeypair.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        })
        .signers([lpMintKeypair])
        .rpc();

      console.log("✓ AMM pool initialized, tx:", initTx);

      // Wait for confirmation
      await new Promise(r => setTimeout(r, 2000));
    } catch (e: any) {
      console.error("Error initializing AMM:", e.message);
      throw e;
    }
  }

  // =========================================================================
  // Step 6: Add Initial Liquidity
  // =========================================================================
  console.log("\n" + "-".repeat(60));
  console.log("Step 6: Adding Initial Liquidity");
  console.log("-".repeat(60));

  // Re-fetch AMM pool data
  const ammData = await ammProgram.account.ammPool.fetch(ammPool);
  
  if (Number(ammData.reserveA) === 0 && Number(ammData.reserveB) === 0) {
    console.log("Adding initial liquidity...");

    const solAmount = INITIAL_SOL_AMOUNT * LAMPORTS_PER_SOL;
    const slpAmount = INITIAL_SLP_AMOUNT * LAMPORTS_PER_SOL;

    // We need to:
    // 1. Create/wrap wSOL
    // 2. Transfer wSOL and slpSOL to the pool
    // 3. Get LP tokens

    // Get user's LP account
    const userLpAccount = await getAssociatedTokenAddress(ammData.lpMint, wallet);

    // Build transaction with multiple instructions
    const tx = new Transaction();

    // Create wSOL ATA if needed
    if (!wsolExists) {
      tx.add(
        createAssociatedTokenAccountInstruction(
          wallet,
          userWsolAccount,
          wallet,
          WSOL_MINT
        )
      );
    }

    // Create LP token ATA
    tx.add(
      createAssociatedTokenAccountInstruction(
        wallet,
        userLpAccount,
        wallet,
        ammData.lpMint
      )
    );

    // Transfer SOL to wSOL account (wrapping)
    tx.add(
      SystemProgram.transfer({
        fromPubkey: wallet,
        toPubkey: userWsolAccount,
        lamports: solAmount,
      })
    );

    // Sync native (update wSOL balance)
    tx.add(createSyncNativeInstruction(userWsolAccount));

    // Send the setup transaction
    const { blockhash } = await provider.connection.getLatestBlockhash();
    tx.recentBlockhash = blockhash;
    tx.feePayer = wallet;
    
    const setupSig = await provider.sendAndConfirm(tx);
    console.log("✓ wSOL wrapped, tx:", setupSig);

    // Wait for confirmation
    await new Promise(r => setTimeout(r, 2000));

    // Now add liquidity
    const addLiqTx = await ammProgram.methods
      .addLiquidity(
        new BN(solAmount),
        new BN(slpAmount),
        new BN(0) // min LP out (0 for first deposit)
      )
      .accounts({
        user: wallet,
        pool: ammPool,
        poolAuthority: ammAuthority,
        tokenAVault: vaultA,
        tokenBVault: vaultB,
        lpMint: ammData.lpMint,
        userTokenA: userWsolAccount,
        userTokenB: userSlpAccount,
        userLpAccount: userLpAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    console.log("✓ Liquidity added, tx:", addLiqTx);

    // Wait and check
    await new Promise(r => setTimeout(r, 2000));

    const finalAmmData = await ammProgram.account.ammPool.fetch(ammPool);
    console.log("\n📊 Final AMM Pool State:");
    console.log("  Reserve A (wSOL):", Number(finalAmmData.reserveA) / LAMPORTS_PER_SOL);
    console.log("  Reserve B (slpSOL):", Number(finalAmmData.reserveB) / LAMPORTS_PER_SOL);
    console.log("  Total LP:", Number(finalAmmData.totalLpSupply) / LAMPORTS_PER_SOL);
  } else {
    console.log("✓ AMM pool already has liquidity");
    console.log("  Reserve A (wSOL):", Number(ammData.reserveA) / LAMPORTS_PER_SOL);
    console.log("  Reserve B (slpSOL):", Number(ammData.reserveB) / LAMPORTS_PER_SOL);
  }

  // =========================================================================
  // Summary
  // =========================================================================
  console.log("\n" + "=".repeat(60));
  console.log("Initialization Complete!");
  console.log("=".repeat(60));
  console.log("\nAddresses to update in frontend/.env.local:");
  console.log(`  NEXT_PUBLIC_SLP_SOL_MINT=${slpMint.toString()}`);
  console.log(`  NEXT_PUBLIC_AMM_POOL=${ammPool.toString()}`);
  console.log(`  NEXT_PUBLIC_LP_MINT=${ammData.lpMint.toString()}`);
  console.log("\nYou can now use the Swap and Liquidity features in the frontend!");
}

main().catch((err) => {
  console.error("\nError:", err);
  process.exit(1);
});

