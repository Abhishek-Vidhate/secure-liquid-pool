import { PublicKey } from "@solana/web3.js";

// Program IDs (same as deployed on devnet/localnet)
export const PROGRAM_IDS = {
  STAKE_POOL: new PublicKey("EyWBdqo6J5KEzQSvPYhsGFXjJfC6kkmTMGo8JTEzqhZ7"),
  AMM: new PublicKey("AcaXW2nDrvkpmuZnuiARDRJzmmfT1AZwLm4SMeYwnXKS"),
  SECURELP: new PublicKey("BMxQAdqNJE3Zn6iJedc6A6XbsSTmNBQi6UzFdfrNvE21"),
  TOKEN_METADATA: new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"),
};

// PDA Seeds
export const SEEDS = {
  // Stake Pool
  POOL_CONFIG: Buffer.from("pool_config"),
  POOL_AUTHORITY: Buffer.from("pool_authority"),
  RESERVE_VAULT: Buffer.from("reserve_vault"),
  
  // AMM
  AMM_POOL: Buffer.from("amm_pool"),
  AMM_AUTHORITY: Buffer.from("amm_authority"),
  VAULT_A: Buffer.from("vault_a"),
  VAULT_B: Buffer.from("vault_b"),
  
  // SecureLP
  COMMITMENT: Buffer.from("commit"),
};

// Simulation configuration
export interface SimulationConfig {
  // Number of trades to simulate
  transactions: number;
  
  // Probability of MEV attack (0-1)
  attackProbability: number;
  
  // Swap amount range (in lamports)
  minSwapLamports: bigint;
  maxSwapLamports: bigint;
  
  // Pool configuration
  initialPoolLiquidity: bigint; // SOL in each side
  feeBps: number;
  
  // Trader counts
  numNormalTraders: number;
  numProtectedTraders: number;
  
  // Attacker capital
  attackerCapital: bigint;
  
  // Output
  outputDir: string;
  generateReport: boolean;
}

// Default configuration
export const DEFAULT_CONFIG: SimulationConfig = {
  transactions: 100,
  attackProbability: 0.8,
  minSwapLamports: BigInt(100_000_000), // 0.1 SOL
  maxSwapLamports: BigInt(5_000_000_000), // 5 SOL
  initialPoolLiquidity: BigInt(1000_000_000_000), // 1000 SOL
  feeBps: 30, // 0.3%
  numNormalTraders: 10,
  numProtectedTraders: 10,
  attackerCapital: BigInt(500_000_000_000), // 500 SOL
  outputDir: "output",
  generateReport: true,
};

// RPC URLs
export const RPC_URL = "http://127.0.0.1:8899";
export const WS_URL = "ws://127.0.0.1:8900";

// Timing constants
export const LAMPORTS_PER_SOL = 1_000_000_000n;
export const SLOT_DURATION_MS = 400;
export const MIN_DELAY_SLOTS = 3; // For commit-reveal delay (mainnet/devnet)

// Localnet-specific: Reduced delay for faster testing
// On mainnet, the actual delay would be MIN_DELAY_SLOTS * SLOT_DURATION_MS
// For localnet testing, we use a shorter delay since we're just proving the concept
export const MIN_DELAY_MS_LOCALNET = 500; // 0.5 seconds (was 1.7s)

// Conversion helpers
export function solToLamports(sol: number): bigint {
  return BigInt(Math.floor(sol * 1_000_000_000));
}

export function lamportsToSol(lamports: bigint): number {
  return Number(lamports) / 1_000_000_000;
}

export function formatSol(lamports: bigint, decimals: number = 4): string {
  return lamportsToSol(lamports).toFixed(decimals);
}

