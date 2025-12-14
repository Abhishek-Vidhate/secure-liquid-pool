import { PublicKey } from "@solana/web3.js";

// ============================================================================
// PROGRAM IDS
// ============================================================================

/** SecureLiquidPool MEV Protection Program ID */
export const SECURELP_PROGRAM_ID = new PublicKey(
  process.env.NEXT_PUBLIC_SECURELP_ID || "BMxQAdqNJE3Zn6iJedc6A6XbsSTmNBQi6UzFdfrNvE21"
);

/** Stake Pool Program ID */
export const STAKE_POOL_PROGRAM_ID = new PublicKey(
  process.env.NEXT_PUBLIC_STAKE_POOL_ID || "EyWBdqo6J5KEzQSvPYhsGFXjJfC6kkmTMGo8JTEzqhZ7"
);

/** AMM Program ID */
export const AMM_PROGRAM_ID = new PublicKey(
  process.env.NEXT_PUBLIC_AMM_ID || "AcaXW2nDrvkpmuZnuiARDRJzmmfT1AZwLm4SMeYwnXKS"
);

/** Legacy alias for backwards compatibility */
export const PROGRAM_ID = SECURELP_PROGRAM_ID;

/** SPL Token Program ID */
export const TOKEN_PROGRAM_ID = new PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
);

/** Associated Token Program ID */
export const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
);

/** System Program ID */
export const SYSTEM_PROGRAM_ID = new PublicKey(
  "11111111111111111111111111111111"
);

// ============================================================================
// TOKEN MINTS (will be set after pool initialization)
// ============================================================================

/** Wrapped SOL Mint */
export const WSOL_MINT = new PublicKey(
  "So11111111111111111111111111111111111111112"
);

/** slpSOL Mint - This will be set after stake pool is initialized */
// The mint address will be derived from the stake pool initialization
// For now, we'll use a placeholder that will be updated dynamically
export let SLP_SOL_MINT: PublicKey | null = null;

/** Set slpSOL mint after pool initialization */
export function setSlpSolMint(mint: PublicKey) {
  SLP_SOL_MINT = mint;
}

// ============================================================================
// PDA SEEDS
// ============================================================================

/** Pool config seed */
export const POOL_CONFIG_SEED = "pool_config";

/** Pool authority seed */
export const POOL_AUTHORITY_SEED = "pool_authority";

/** Reserve vault seed */
export const RESERVE_VAULT_SEED = "reserve_vault";

/** Validator stake seed */
export const VALIDATOR_STAKE_SEED = "validator_stake";

/** AMM pool seed */
export const AMM_POOL_SEED = "amm_pool";

/** AMM authority seed */
export const AMM_AUTHORITY_SEED = "amm_authority";

/** Vault A seed (SOL) */
export const VAULT_A_SEED = "vault_a";

/** Vault B seed (slpSOL) */
export const VAULT_B_SEED = "vault_b";

/** Commitment seed */
export const COMMITMENT_SEED_PREFIX = "commit";

// ============================================================================
// API ENDPOINTS
// ============================================================================

/** RPC Endpoint - Using Helius for faster transaction indexing and better rate limits */
export const RPC_ENDPOINT = 
  process.env.NEXT_PUBLIC_RPC_URL || "https://devnet.helius-rpc.com/?api-key=387cb3e9-0527-4194-98e1-b2acb4791c57";

/** Check if we're on devnet */
export const IS_DEVNET = RPC_ENDPOINT.includes("devnet");

// ============================================================================
// CONFIGURATION
// ============================================================================

/** Minimum delay between commit and reveal (in seconds) */
export const MIN_DELAY_SECONDS = 1;

/** Minimum stake amount (0.01 SOL in lamports) */
export const MIN_AMOUNT_LAMPORTS = 10_000_000;

/** Default slippage in basis points (0.5%) */
export const DEFAULT_SLIPPAGE_BPS = 50;

/** Maximum slippage in basis points (10%) */
export const MAX_SLIPPAGE_BPS = 1000;

/** Default AMM swap fee in basis points (0.3%) */
export const DEFAULT_AMM_FEE_BPS = 30;

/** Default stake pool fee in basis points (1%) */
export const DEFAULT_STAKE_POOL_FEE_BPS = 100;

/** Reserve ratio in basis points (10% kept liquid) */
export const RESERVE_RATIO_BPS = 1000;

/** SOL decimals */
export const SOL_DECIMALS = 9;

/** slpSOL decimals (same as SOL) */
export const SLP_SOL_DECIMALS = 9;

// ============================================================================
// EXPLORER LINKS
// ============================================================================

/** Solana Explorer base URL */
export const EXPLORER_URL = "https://explorer.solana.com";

/** Get transaction URL for explorer */
export function getExplorerTxUrl(signature: string): string {
  const cluster = IS_DEVNET ? "devnet" : "mainnet-beta";
  return `${EXPLORER_URL}/tx/${signature}?cluster=${cluster}`;
}

/** Get address URL for explorer */
export function getExplorerAddressUrl(address: string): string {
  const cluster = IS_DEVNET ? "devnet" : "mainnet-beta";
  return `${EXPLORER_URL}/address/${address}?cluster=${cluster}`;
}
