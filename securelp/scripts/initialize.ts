import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider } from "@coral-xyz/anchor";
import { PublicKey, Keypair, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { 
  TOKEN_PROGRAM_ID, 
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
} from "@solana/spl-token";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Program IDs
const STAKE_POOL_PROGRAM_ID = new PublicKey("EyWBdqo6J5KEzQSvPYhsGFXjJfC6kkmTMGo8JTEzqhZ7");
const AMM_PROGRAM_ID = new PublicKey("AcaXW2nDrvkpmuZnuiARDRJzmmfT1AZwLm4SMeYwnXKS");
const SECURELP_PROGRAM_ID = new PublicKey("BMxQAdqNJE3Zn6iJedc6A6XbsSTmNBQi6UzFdfrNvE21");

// PDA Seeds
const POOL_CONFIG_SEED = "pool_config";
const POOL_AUTHORITY_SEED = "pool_authority";
const RESERVE_VAULT_SEED = "reserve_vault";
const AMM_POOL_SEED = "amm_pool";
const AMM_AUTHORITY_SEED = "amm_authority";
const VAULT_A_SEED = "vault_a";
const VAULT_B_SEED = "vault_b";

// wSOL mint
const WSOL_MINT = new PublicKey("So11111111111111111111111111111111111111112");

async function main() {
  console.log("=".repeat(60));
  console.log("SecureLiquidPool - Pool Initialization Script");
  console.log("=".repeat(60));

  // Setup provider
  const provider = AnchorProvider.env();
  anchor.setProvider(provider);
  
  console.log("\nWallet:", provider.wallet.publicKey.toString());
  console.log("Cluster:", provider.connection.rpcEndpoint);

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
  // Step 1: Initialize Stake Pool
  // =========================================================================
  console.log("\n" + "=".repeat(60));
  console.log("Step 1: Initialize Stake Pool");
  console.log("=".repeat(60));

  // Derive PDAs
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

  console.log("Pool Config PDA:", poolConfig.toString());
  console.log("Pool Authority PDA:", poolAuthority.toString());
  console.log("Reserve Vault PDA:", reserveVault.toString());

  // Check if pool already initialized
  const existingPool = await provider.connection.getAccountInfo(poolConfig);
  
  if (existingPool) {
    console.log("\n✓ Stake pool already initialized!");
    
    // Fetch pool data
    const poolData = await stakePoolProgram.account.poolConfig.fetch(poolConfig);
    console.log("  slpSOL Mint:", poolData.slpMint.toString());
    console.log("  Total Staked:", (Number(poolData.totalStakedLamports) / LAMPORTS_PER_SOL).toFixed(4), "SOL");
    console.log("  Total slpSOL:", (Number(poolData.totalSlpSupply) / LAMPORTS_PER_SOL).toFixed(4));
    console.log("  Reserve:", (Number(poolData.reserveLamports) / LAMPORTS_PER_SOL).toFixed(4), "SOL");
    console.log("  Fee:", poolData.feeBps, "bps");
    
    // Store slpSOL mint for AMM
    var slpMint = poolData.slpMint;
  } else {
    console.log("\nInitializing stake pool...");

    // Generate new mint keypair
    const slpMintKeypair = Keypair.generate();
    var slpMint = slpMintKeypair.publicKey;

    // Initialize pool with 1% fee (100 bps)
    const tx = await stakePoolProgram.methods
      .initializePool(100)
      .accounts({
        admin: provider.wallet.publicKey,
        poolConfig: poolConfig,
        poolAuthority: poolAuthority,
        reserveVault: reserveVault,
        slpMint: slpMint,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([slpMintKeypair])
      .rpc();

    console.log("✓ Stake pool initialized!");
    console.log("  Transaction:", tx);
    console.log("  slpSOL Mint:", slpMint.toString());
  }

  // =========================================================================
  // Step 2: Add a Devnet Validator (Optional)
  // =========================================================================
  console.log("\n" + "=".repeat(60));
  console.log("Step 2: Add Devnet Validator (Optional)");
  console.log("=".repeat(60));

  // Find a devnet validator to add
  // For now, we'll skip this as it requires finding valid vote accounts
  console.log("Skipping validator addition for now.");
  console.log("(Stake pool simulates rewards without actual validator delegation on devnet)");

  // =========================================================================
  // Step 3: Initialize AMM Pool (Optional)
  // =========================================================================
  console.log("\n" + "=".repeat(60));
  console.log("Step 3: Initialize AMM Pool (wSOL/slpSOL)");
  console.log("=".repeat(60));

  // Derive AMM PDAs
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
  console.log("AMM Authority PDA:", ammAuthority.toString());
  console.log("Token A (wSOL) Vault:", vaultA.toString());
  console.log("Token B (slpSOL) Vault:", vaultB.toString());

  // Check if AMM pool already initialized
  const existingAmm = await provider.connection.getAccountInfo(ammPool);

  if (existingAmm) {
    console.log("\n✓ AMM pool already initialized!");
    
    const ammData = await ammProgram.account.ammPool.fetch(ammPool);
    console.log("  Reserve A (wSOL):", (Number(ammData.reserveA) / LAMPORTS_PER_SOL).toFixed(4));
    console.log("  Reserve B (slpSOL):", (Number(ammData.reserveB) / LAMPORTS_PER_SOL).toFixed(4));
    console.log("  Total LP:", (Number(ammData.totalLpSupply) / LAMPORTS_PER_SOL).toFixed(4));
    console.log("  Fee:", ammData.feeBps, "bps");
  } else {
    console.log("\nAMM pool not initialized yet.");
    console.log("To initialize, you need to:");
    console.log("1. First stake some SOL to get slpSOL");
    console.log("2. Then add liquidity to the AMM pool");
    console.log("\nThis can be done via the frontend or a separate script.");
  }

  // =========================================================================
  // Summary
  // =========================================================================
  console.log("\n" + "=".repeat(60));
  console.log("Summary");
  console.log("=".repeat(60));
  console.log("\nProgram IDs:");
  console.log("  SecureLP:", SECURELP_PROGRAM_ID.toString());
  console.log("  Stake Pool:", STAKE_POOL_PROGRAM_ID.toString());
  console.log("  AMM:", AMM_PROGRAM_ID.toString());
  console.log("\nPool Addresses:");
  console.log("  Pool Config:", poolConfig.toString());
  console.log("  slpSOL Mint:", slpMint.toString());
  console.log("\nExplorer Links:");
  console.log("  Stake Pool:", `https://explorer.solana.com/address/${STAKE_POOL_PROGRAM_ID}?cluster=devnet`);
  console.log("  AMM:", `https://explorer.solana.com/address/${AMM_PROGRAM_ID}?cluster=devnet`);
  console.log("  SecureLP:", `https://explorer.solana.com/address/${SECURELP_PROGRAM_ID}?cluster=devnet`);
  
  console.log("\n" + "=".repeat(60));
  console.log("Done! You can now use the frontend to stake SOL.");
  console.log("=".repeat(60));
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});

