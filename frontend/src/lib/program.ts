import { Program, AnchorProvider, Idl } from "@coral-xyz/anchor";
import { Connection, PublicKey } from "@solana/web3.js";
import { 
  SECURELP_PROGRAM_ID, 
  STAKE_POOL_PROGRAM_ID, 
  AMM_PROGRAM_ID,
  COMMITMENT_SEED_PREFIX,
  POOL_CONFIG_SEED,
  POOL_AUTHORITY_SEED,
  RESERVE_VAULT_SEED,
  AMM_POOL_SEED,
  AMM_AUTHORITY_SEED,
  VAULT_A_SEED,
  VAULT_B_SEED,
} from "./constants";

import securelpIdl from "../idl/securelp.json";
import stakePoolIdl from "../idl/stake_pool.json";
import ammIdl from "../idl/amm.json";

import type { Securelp } from "../types/securelp";
import type { StakePool } from "../types/stake_pool";
import type { Amm } from "../types/amm";

// ============================================================================
// PROGRAM INITIALIZATION
// ============================================================================

/**
 * Get the SecureLiquidPool MEV Protection program instance
 */
export function getSecurelpProgram(provider: AnchorProvider): Program<Securelp> {
  return new Program(securelpIdl as Idl, provider) as unknown as Program<Securelp>;
}

/**
 * Get the Stake Pool program instance
 */
export function getStakePoolProgram(provider: AnchorProvider): Program<StakePool> {
  return new Program(stakePoolIdl as Idl, provider) as unknown as Program<StakePool>;
}

/**
 * Get the AMM program instance
 */
export function getAmmProgram(provider: AnchorProvider): Program<Amm> {
  return new Program(ammIdl as Idl, provider) as unknown as Program<Amm>;
}

/** Legacy alias */
export const getProgram = getSecurelpProgram;

/**
 * Create a read-only program instance (no wallet required)
 */
export function getReadOnlyProgram(connection: Connection): Program<Securelp> {
  const dummyKeypair = {
    publicKey: PublicKey.default,
    signTransaction: async () => { throw new Error("Read-only"); },
    signAllTransactions: async () => { throw new Error("Read-only"); },
  };
  
  const provider = new AnchorProvider(
    connection,
    dummyKeypair as any,
    { commitment: "confirmed" }
  );
  
  return new Program(securelpIdl as Idl, provider) as unknown as Program<Securelp>;
}

/**
 * Create a read-only stake pool program instance
 */
export function getReadOnlyStakePoolProgram(connection: Connection): Program<StakePool> {
  const dummyKeypair = {
    publicKey: PublicKey.default,
    signTransaction: async () => { throw new Error("Read-only"); },
    signAllTransactions: async () => { throw new Error("Read-only"); },
  };
  
  const provider = new AnchorProvider(
    connection,
    dummyKeypair as any,
    { commitment: "confirmed" }
  );
  
  return new Program(stakePoolIdl as Idl, provider) as unknown as Program<StakePool>;
}

/**
 * Create a read-only AMM program instance
 */
export function getReadOnlyAmmProgram(connection: Connection): Program<Amm> {
  const dummyKeypair = {
    publicKey: PublicKey.default,
    signTransaction: async () => { throw new Error("Read-only"); },
    signAllTransactions: async () => { throw new Error("Read-only"); },
  };
  
  const provider = new AnchorProvider(
    connection,
    dummyKeypair as any,
    { commitment: "confirmed" }
  );
  
  return new Program(ammIdl as Idl, provider) as unknown as Program<Amm>;
}

// ============================================================================
// PDA DERIVATION - SECURELP
// ============================================================================

/**
 * Derive the commitment PDA for a user
 * Seeds: ["commit", user_pubkey]
 */
export function getCommitmentPDA(userPubkey: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(COMMITMENT_SEED_PREFIX), userPubkey.toBuffer()],
    SECURELP_PROGRAM_ID
  );
}

// ============================================================================
// PDA DERIVATION - STAKE POOL
// ============================================================================

/**
 * Derive the pool config PDA
 * Seeds: ["pool_config"]
 */
export function getPoolConfigPDA(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(POOL_CONFIG_SEED)],
    STAKE_POOL_PROGRAM_ID
  );
}

/**
 * Derive the pool authority PDA
 * Seeds: ["pool_authority", pool_config]
 */
export function getPoolAuthorityPDA(poolConfig: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(POOL_AUTHORITY_SEED), poolConfig.toBuffer()],
    STAKE_POOL_PROGRAM_ID
  );
}

/**
 * Derive the reserve vault PDA
 * Seeds: ["reserve_vault", pool_config]
 */
export function getReserveVaultPDA(poolConfig: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(RESERVE_VAULT_SEED), poolConfig.toBuffer()],
    STAKE_POOL_PROGRAM_ID
  );
}

// ============================================================================
// PDA DERIVATION - AMM
// ============================================================================

/**
 * Derive the AMM pool PDA
 * Seeds: ["amm_pool", token_a_mint, token_b_mint]
 */
export function getAmmPoolPDA(tokenAMint: PublicKey, tokenBMint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(AMM_POOL_SEED), tokenAMint.toBuffer(), tokenBMint.toBuffer()],
    AMM_PROGRAM_ID
  );
}

/**
 * Derive the AMM authority PDA
 * Seeds: ["amm_authority", pool]
 */
export function getAmmAuthorityPDA(pool: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(AMM_AUTHORITY_SEED), pool.toBuffer()],
    AMM_PROGRAM_ID
  );
}

/**
 * Derive the token A vault PDA
 * Seeds: ["vault_a", pool]
 */
export function getVaultAPDA(pool: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(VAULT_A_SEED), pool.toBuffer()],
    AMM_PROGRAM_ID
  );
}

/**
 * Derive the token B vault PDA
 * Seeds: ["vault_b", pool]
 */
export function getVaultBPDA(pool: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(VAULT_B_SEED), pool.toBuffer()],
    AMM_PROGRAM_ID
  );
}

// ============================================================================
// TYPE EXPORTS
// ============================================================================

export interface SwapDetails {
  amountIn: bigint;
  minOut: bigint;
  slippageBps: number;
  nonce: Uint8Array;
}

export interface Commitment {
  user: PublicKey;
  hash: number[];
  timestamp: bigint;
  bump: number;
  amountLamports: bigint;
  isStake: boolean;
}

export interface PoolConfig {
  admin: PublicKey;
  slpMint: PublicKey;
  totalStakedLamports: bigint;
  totalSlpSupply: bigint;
  reserveLamports: bigint;
  feeBps: number;
  paused: boolean;
  lastHarvestEpoch: bigint;
  validatorCount: number;
  bump: number;
  authorityBump: number;
}

export interface AmmPool {
  authority: PublicKey;
  tokenAMint: PublicKey;
  tokenBMint: PublicKey;
  tokenAVault: PublicKey;
  tokenBVault: PublicKey;
  lpMint: PublicKey;
  reserveA: bigint;
  reserveB: bigint;
  totalLpSupply: bigint;
  feeBps: number;
  paused: boolean;
  cumulativeFeeA: bigint;
  cumulativeFeeB: bigint;
  bump: number;
  authorityBump: number;
}

// ============================================================================
// ACCOUNT FETCHING
// ============================================================================

/**
 * Fetch a commitment account if it exists
 */
export async function fetchCommitment(
  connection: Connection,
  userPubkey: PublicKey
): Promise<Commitment | null> {
  const program = getReadOnlyProgram(connection);
  const [commitmentPda] = getCommitmentPDA(userPubkey);
  
  try {
    const account = await program.account.commitment.fetch(commitmentPda);
    return {
      user: account.user,
      hash: account.hash,
      timestamp: BigInt(account.timestamp.toString()),
      bump: account.bump,
      amountLamports: BigInt(account.amountLamports.toString()),
      isStake: account.isStake,
    };
  } catch (error) {
    return null;
  }
}

/**
 * Fetch the stake pool config
 */
export async function fetchPoolConfig(
  connection: Connection
): Promise<PoolConfig | null> {
  const program = getReadOnlyStakePoolProgram(connection);
  const [poolConfigPda] = getPoolConfigPDA();
  
  try {
    const account = await program.account.poolConfig.fetch(poolConfigPda);
    return {
      admin: account.admin,
      slpMint: account.slpMint,
      totalStakedLamports: BigInt(account.totalStakedLamports.toString()),
      totalSlpSupply: BigInt(account.totalSlpSupply.toString()),
      reserveLamports: BigInt(account.reserveLamports.toString()),
      feeBps: account.feeBps,
      paused: account.paused,
      lastHarvestEpoch: BigInt(account.lastHarvestEpoch.toString()),
      validatorCount: account.validatorCount,
      bump: account.bump,
      authorityBump: account.authorityBump,
    };
  } catch (error) {
    return null;
  }
}

/**
 * Fetch an AMM pool
 */
export async function fetchAmmPool(
  connection: Connection,
  tokenAMint: PublicKey,
  tokenBMint: PublicKey
): Promise<AmmPool | null> {
  const program = getReadOnlyAmmProgram(connection);
  const [poolPda] = getAmmPoolPDA(tokenAMint, tokenBMint);
  
  try {
    const account = await program.account.ammPool.fetch(poolPda);
    return {
      authority: account.authority,
      tokenAMint: account.tokenAMint,
      tokenBMint: account.tokenBMint,
      tokenAVault: account.tokenAVault,
      tokenBVault: account.tokenBVault,
      lpMint: account.lpMint,
      reserveA: BigInt(account.reserveA.toString()),
      reserveB: BigInt(account.reserveB.toString()),
      totalLpSupply: BigInt(account.totalLpSupply.toString()),
      feeBps: account.feeBps,
      paused: account.paused,
      cumulativeFeeA: BigInt(account.cumulativeFeeA.toString()),
      cumulativeFeeB: BigInt(account.cumulativeFeeB.toString()),
      bump: account.bump,
      authorityBump: account.authorityBump,
    };
  } catch (error) {
    return null;
  }
}

/**
 * Check if a commitment exists for a user
 */
export async function hasCommitment(
  connection: Connection,
  userPubkey: PublicKey
): Promise<boolean> {
  const [commitmentPda] = getCommitmentPDA(userPubkey);
  const accountInfo = await connection.getAccountInfo(commitmentPda);
  return accountInfo !== null;
}

/**
 * Calculate exchange rate: SOL per slpSOL
 */
export function calculateExchangeRate(poolConfig: PoolConfig): number {
  if (poolConfig.totalSlpSupply === BigInt(0)) {
    return 1.0; // 1:1 initial rate
  }
  const totalSol = poolConfig.totalStakedLamports + poolConfig.reserveLamports;
  return Number(totalSol) / Number(poolConfig.totalSlpSupply);
}

/**
 * Calculate slpSOL to mint for a given SOL deposit
 */
export function calculateSlpForDeposit(poolConfig: PoolConfig, solLamports: bigint): bigint {
  if (poolConfig.totalSlpSupply === BigInt(0)) {
    return solLamports; // 1:1 for first deposit
  }
  const totalSol = poolConfig.totalStakedLamports + poolConfig.reserveLamports;
  return (solLamports * poolConfig.totalSlpSupply) / totalSol;
}

/**
 * Calculate SOL to return for a given slpSOL burn
 */
export function calculateSolForWithdrawal(poolConfig: PoolConfig, slpAmount: bigint): bigint {
  if (poolConfig.totalSlpSupply === BigInt(0)) {
    return BigInt(0);
  }
  const totalSol = poolConfig.totalStakedLamports + poolConfig.reserveLamports;
  return (slpAmount * totalSol) / poolConfig.totalSlpSupply;
}

/**
 * Calculate AMM swap output
 */
export function calculateAmmSwapOutput(
  pool: AmmPool,
  amountIn: bigint,
  aToB: boolean
): { amountOut: bigint; fee: bigint } {
  const [inputReserve, outputReserve] = aToB 
    ? [pool.reserveA, pool.reserveB]
    : [pool.reserveB, pool.reserveA];

  if (inputReserve === BigInt(0) || outputReserve === BigInt(0)) {
    return { amountOut: BigInt(0), fee: BigInt(0) };
  }

  // Apply fee
  const feeMultiplier = BigInt(10000) - BigInt(pool.feeBps);
  const inputAfterFee = (amountIn * feeMultiplier) / BigInt(10000);
  const fee = amountIn - inputAfterFee;

  // Constant product formula
  const numerator = outputReserve * inputAfterFee;
  const denominator = inputReserve + inputAfterFee;
  const amountOut = numerator / denominator;

  return { amountOut, fee };
}
