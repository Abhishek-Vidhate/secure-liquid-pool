import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";

// Trade direction
export type SwapDirection = "AtoB" | "BtoA";

// Pending swap visible in mempool
export interface PendingSwap {
  trader: PublicKey;
  amountIn: bigint;
  minOut: bigint;
  direction: SwapDirection;
}

// Result of a trade
export interface TradeResult {
  signature: string;
  trader: string;
  amountIn: bigint;
  expectedOut: bigint;
  actualOut: bigint;
  slippageLoss: bigint;
  direction: SwapDirection;
  wasAttacked: boolean;
  feePaid: bigint;
  timestamp: number;
}

// Result of a sandwich attack
export interface SandwichResult {
  success: boolean;
  frontRunSignature?: string;
  backRunSignature?: string;
  victimSignature?: string;
  frontRunAmount: bigint;
  backRunAmount: bigint;
  profitLamports: bigint;
  victimLossLamports: bigint;
  reason?: string;
}

// Commit-reveal commitment info
export interface CommitmentInfo {
  hash: Uint8Array;
  amountLamports: bigint;
  isStake: boolean;
  timestamp: number;
  canSandwich: boolean;
}

// Pool state snapshot
export interface PoolState {
  reserveA: bigint;
  reserveB: bigint;
  feeBps: number;
  lpSupply: bigint;
}

// Sandwich calculation parameters
export interface SandwichParams {
  frontRunAmount: bigint;
  expectedProfit: bigint;
  victimExpectedLoss: bigint;
  isProfitable: boolean;
}

// Swap details for commit-reveal
export interface SwapDetails {
  amountIn: BN;
  minOut: BN;
  slippageBps: number;
  nonce: number[];
}

// Simulation results
export interface SimulationResults {
  config: {
    transactions: number;
    attackProbability: number;
    minSwapLamports: string;
    maxSwapLamports: string;
    initialPoolLiquidity: string;
    feeBps: number;
  };
  normalTrades: TradeResult[];
  protectedTrades: TradeResult[];
  sandwichResults: SandwichResult[];
  summary: SimulationSummary;
  poolHistory: PoolStateRecord[];
}

export interface SimulationSummary {
  totalTransactions: number;
  attackAttempts: number;
  successfulAttacks: number;
  attackSuccessRate: number;
  normalTransactions: number;
  normalAttacked: number;
  protectedTransactions: number;
  protectedAttacked: number;
  totalMevExtracted: bigint;
  totalVictimLosses: bigint;
  avgLossPerAttack: number;
  totalProtectedSavings: bigint;
  avgTradeAmount: number;
  totalVolume: bigint;
}

export interface PoolStateRecord {
  transactionId: number;
  reserveA: bigint;
  reserveB: bigint;
  priceAInB: number;
  scenario: "normal" | "protected";
}

// Account setup result
export interface AccountSetup {
  publicKey: PublicKey;
  tokenAAccount: PublicKey;
  tokenBAccount: PublicKey;
  solBalance: bigint;
  tokenABalance: bigint;
  tokenBBalance: bigint;
}

// Pool setup result
export interface PoolSetup {
  poolAddress: PublicKey;
  poolAuthority: PublicKey;
  tokenAMint: PublicKey;
  tokenBMint: PublicKey;
  tokenAVault: PublicKey;
  tokenBVault: PublicKey;
  lpMint: PublicKey;
}

