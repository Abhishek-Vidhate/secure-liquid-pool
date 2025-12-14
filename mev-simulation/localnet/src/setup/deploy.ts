import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { Program, AnchorProvider, Wallet, BN } from "@coral-xyz/anchor";
import chalk from "chalk";
import fs from "fs";
import path from "path";
import { PROGRAM_IDS, SEEDS, SimulationConfig, lamportsToSol } from "../config.js";
import { PoolSetup } from "../types.js";

// Load IDLs
const PROJECT_ROOT = path.resolve(import.meta.dirname, "../../../..");
const IDL_DIR = path.join(PROJECT_ROOT, "securelp/target/idl");

function loadIdl(name: string): any {
  const idlPath = path.join(IDL_DIR, `${name}.json`);
  if (!fs.existsSync(idlPath)) {
    throw new Error(`IDL not found: ${idlPath}`);
  }
  return JSON.parse(fs.readFileSync(idlPath, "utf-8"));
}

/**
 * Deploy and initialize all pools for simulation
 */
export async function deployPools(
  connection: Connection,
  payer: Keypair,
  config: SimulationConfig
): Promise<{
  ammPoolSetup: PoolSetup;
  tokenAMint: PublicKey;
  tokenBMint: PublicKey;
}> {
  console.log(chalk.blue("\n══════════════════════════════════════════════"));
  console.log(chalk.blue("  Deploying Pools"));
  console.log(chalk.blue("══════════════════════════════════════════════\n"));

  // Create provider
  const wallet = new Wallet(payer);
  const provider = new AnchorProvider(connection, wallet, { commitment: "confirmed" });

  // 1. Create token mints
  console.log(chalk.gray("Creating token mints..."));
  const { tokenAMint, tokenBMint } = await createTokenMints(connection, payer);

  // 2. Initialize AMM pool (skip stake pool - not needed for MEV simulation)
  console.log(chalk.gray("Initializing AMM pool..."));
  const ammPoolSetup = await initializeAmmPool(
    provider,
    payer,
    tokenAMint,
    tokenBMint,
    config.feeBps
  );

  // 3. Add initial liquidity
  console.log(chalk.gray("Adding initial liquidity..."));
  await addInitialLiquidity(
    provider,
    payer,
    ammPoolSetup,
    tokenAMint,
    tokenBMint,
    config.initialPoolLiquidity
  );

  console.log(chalk.green("\n✓ Pools deployed and initialized"));
  console.log(chalk.gray(`  Token A (wSOL): ${tokenAMint.toString()}`));
  console.log(chalk.gray(`  Token B (secuSOL): ${tokenBMint.toString()}`));
  console.log(chalk.gray(`  AMM Pool: ${ammPoolSetup.poolAddress.toString()}`));
  console.log(chalk.gray(`  Initial Liquidity: ${lamportsToSol(config.initialPoolLiquidity)} SOL each side`));

  return { ammPoolSetup, tokenAMint, tokenBMint };
}

/**
 * Create wSOL and secuSOL token mints
 */
async function createTokenMints(
  connection: Connection,
  payer: Keypair
): Promise<{ tokenAMint: PublicKey; tokenBMint: PublicKey }> {
  // Token A - wSOL wrapper
  const tokenAMint = await createMint(
    connection,
    payer,
    payer.publicKey, // mint authority
    payer.publicKey, // freeze authority
    9 // decimals
  );
  console.log(chalk.green(`  ✓ Token A (wSOL) mint: ${tokenAMint.toString()}`));

  // Token B - secuSOL
  const tokenBMint = await createMint(
    connection,
    payer,
    payer.publicKey,
    payer.publicKey,
    9
  );
  console.log(chalk.green(`  ✓ Token B (secuSOL) mint: ${tokenBMint.toString()}`));

  return { tokenAMint, tokenBMint };
}

/**
 * Initialize AMM pool
 */
async function initializeAmmPool(
  provider: AnchorProvider,
  payer: Keypair,
  tokenAMint: PublicKey,
  tokenBMint: PublicKey,
  feeBps: number
): Promise<PoolSetup> {
  const idl = loadIdl("amm");
  const program = new Program(idl, provider);

  // Derive pool PDA
  const [poolAddress] = PublicKey.findProgramAddressSync(
    [SEEDS.AMM_POOL, tokenAMint.toBuffer(), tokenBMint.toBuffer()],
    PROGRAM_IDS.AMM
  );

  // Derive pool authority
  const [poolAuthority] = PublicKey.findProgramAddressSync(
    [SEEDS.AMM_AUTHORITY, poolAddress.toBuffer()],
    PROGRAM_IDS.AMM
  );

  // Derive vaults
  const [tokenAVault] = PublicKey.findProgramAddressSync(
    [SEEDS.VAULT_A, poolAddress.toBuffer()],
    PROGRAM_IDS.AMM
  );

  const [tokenBVault] = PublicKey.findProgramAddressSync(
    [SEEDS.VAULT_B, poolAddress.toBuffer()],
    PROGRAM_IDS.AMM
  );

  // Create LP mint keypair
  const lpMintKeypair = Keypair.generate();

  // Check if already initialized
  try {
    const account = await provider.connection.getAccountInfo(poolAddress);
    if (account) {
      console.log(chalk.yellow("  ⚠ AMM pool already initialized"));
      // Try to fetch the LP mint from pool data
      const poolData = await (program.account as any).ammPool.fetch(poolAddress);
      return {
        poolAddress,
        poolAuthority,
        tokenAMint,
        tokenBMint,
        tokenAVault,
        tokenBVault,
        lpMint: poolData.lpMint as PublicKey,
      };
    }
  } catch {
    // Not initialized yet
  }

  try {
    // Use SYSVAR_RENT_PUBKEY for rent
    const SYSVAR_RENT_PUBKEY = new PublicKey("SysvarRent111111111111111111111111111111111");
    
    await (program.methods as any)
      .initializePool(feeBps)
      .accounts({
        authority: payer.publicKey,
        tokenAMint: tokenAMint,
        tokenBMint: tokenBMint,
        pool: poolAddress,
        poolAuthority: poolAuthority,
        tokenAVault: tokenAVault,
        tokenBVault: tokenBVault,
        lpMint: lpMintKeypair.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .signers([payer, lpMintKeypair])
      .rpc();

    console.log(chalk.green(`  ✓ AMM pool initialized: ${poolAddress.toString()}`));
  } catch (error: any) {
    if (!error.message?.includes("already in use")) {
      console.error("AMM init error:", error);
      throw error;
    }
    console.log(chalk.yellow("  ⚠ AMM pool already exists"));
  }

  return {
    poolAddress,
    poolAuthority,
    tokenAMint,
    tokenBMint,
    tokenAVault,
    tokenBVault,
    lpMint: lpMintKeypair.publicKey,
  };
}

/**
 * Add initial liquidity to AMM pool
 */
async function addInitialLiquidity(
  provider: AnchorProvider,
  payer: Keypair,
  poolSetup: PoolSetup,
  tokenAMint: PublicKey,
  tokenBMint: PublicKey,
  liquidityAmount: bigint
): Promise<void> {
  const idl = loadIdl("amm");
  const program = new Program(idl, provider);

  // Create token accounts for payer
  const payerTokenA = await getOrCreateAssociatedTokenAccount(
    provider.connection,
    payer,
    tokenAMint,
    payer.publicKey
  );

  const payerTokenB = await getOrCreateAssociatedTokenAccount(
    provider.connection,
    payer,
    tokenBMint,
    payer.publicKey
  );

  const payerLpAccount = await getOrCreateAssociatedTokenAccount(
    provider.connection,
    payer,
    poolSetup.lpMint,
    payer.publicKey
  );

  // Mint tokens to payer for liquidity
  const mintAmount = liquidityAmount * 2n; // Extra for trading

  await mintTo(
    provider.connection,
    payer,
    tokenAMint,
    payerTokenA.address,
    payer,
    mintAmount
  );

  await mintTo(
    provider.connection,
    payer,
    tokenBMint,
    payerTokenB.address,
    payer,
    mintAmount
  );

  console.log(chalk.gray(`  Minted ${lamportsToSol(mintAmount)} of each token to payer`));

  // Add liquidity
  const amountBN = new BN(liquidityAmount.toString());
  
  try {
    await (program.methods as any)
      .addLiquidity(amountBN, amountBN, new BN(0))
      .accounts({
        user: payer.publicKey,
        pool: poolSetup.poolAddress,
        poolAuthority: poolSetup.poolAuthority,
        tokenAVault: poolSetup.tokenAVault,
        tokenBVault: poolSetup.tokenBVault,
        lpMint: poolSetup.lpMint,
        userTokenA: payerTokenA.address,
        userTokenB: payerTokenB.address,
        userLpAccount: payerLpAccount.address,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([payer])
      .rpc();

    console.log(chalk.green(`  ✓ Added ${lamportsToSol(liquidityAmount)} liquidity to each side`));
  } catch (error: any) {
    console.error("Add liquidity error:", error);
    throw error;
  }
}

/**
 * Get current pool state
 */
export async function getPoolState(
  connection: Connection,
  poolAddress: PublicKey
): Promise<{ reserveA: bigint; reserveB: bigint; feeBps: number; lpSupply: bigint }> {
  const idl = loadIdl("amm");
  const dummyKeypair = Keypair.generate();
  const wallet = new Wallet(dummyKeypair);
  const provider = new AnchorProvider(connection, wallet, { commitment: "confirmed" });
  const program = new Program(idl, provider);

  const poolData = await (program.account as any).ammPool.fetch(poolAddress);
  
  return {
    reserveA: BigInt(poolData.reserveA.toString()),
    reserveB: BigInt(poolData.reserveB.toString()),
    feeBps: poolData.feeBps,
    lpSupply: BigInt(poolData.totalLpSupply.toString()),
  };
}

