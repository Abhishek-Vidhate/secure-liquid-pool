use anchor_lang::prelude::*;

/// Commitment PDA - stores the blinded swap intent
/// Seeds: ["commit", user_pubkey]
#[account]
#[derive(InitSpace)]
pub struct Commitment {
    /// The user who created this commitment
    pub user: Pubkey,
    
    /// SHA-256 hash of the SwapDetails
    pub hash: [u8; 32],
    
    /// Unix timestamp when commitment was created
    pub timestamp: i64,
    
    /// PDA bump seed for derivation
    pub bump: u8,
    
    /// Amount of lamports being staked (for display purposes)
    pub amount_lamports: u64,
    
    /// Whether this is a stake (SOL -> JitoSOL) or unstake (JitoSOL -> SOL)
    pub is_stake: bool,
}

impl Commitment {
    /// Seed prefix for stake commitments
    pub const SEED_PREFIX: &'static [u8] = b"commit";
    
    /// Calculate space needed for the account
    /// 8 (discriminator) + 32 (user) + 32 (hash) + 8 (timestamp) + 1 (bump) + 8 (amount) + 1 (is_stake)
    pub const SPACE: usize = 8 + 32 + 32 + 8 + 1 + 8 + 1;
}

/// Swap details that get hashed for the commitment
/// This struct is serialized and hashed to create the commitment
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct SwapDetails {
    /// Amount of input tokens (lamports for SOL, smallest unit for JitoSOL)
    pub amount_in: u64,
    
    /// Minimum output amount (protects against slippage)
    pub min_out: u64,
    
    /// Slippage tolerance in basis points (e.g., 50 = 0.5%)
    pub slippage_bps: u16,
    
    /// Random nonce to prevent replay attacks
    pub nonce: [u8; 32],
}

impl SwapDetails {
    /// Maximum allowed slippage (10% = 1000 bps)
    pub const MAX_SLIPPAGE_BPS: u16 = 1000;
    
    /// Minimum amount (0.001 SOL = 1,000,000 lamports)
    pub const MIN_AMOUNT: u64 = 1_000_000;
}

/// Constants for key addresses
pub mod addresses {
    use anchor_lang::prelude::*;
    
    /// Jito Stake Pool (Devnet)
    pub const JITO_STAKE_POOL: &str = "JitoY5pcAxWX6iyP2QdFwTznGb8A99PRCUCVVxB46WZ";
    
    /// JitoSOL Mint (Devnet)
    pub const JITO_SOL_MINT: &str = "J1tos8mqbhdGcF3pgj4PCKyVjzWSURcpLZU7pPGHxSYi";
    
    /// SPL Stake Pool Program (Devnet)
    pub const SPL_STAKE_POOL_PROGRAM: &str = "DPoo15wWDqpPJJtS2MUZ49aRxqz5ZaaJCJP4z8bLuib";
    
    /// Pyth SOL/USD Price Feed (Devnet)
    pub const PYTH_SOL_USD_FEED: &str = "H6ARHf6YXhGYeQfUzQNGk6rDNnLBQKrenN712K4AQJEG";
    
    /// Jupiter Program V6 (Mainnet/Devnet)
    pub const JUPITER_PROGRAM: &str = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";
    
    /// Pyth SOL/USD Feed ID (hex) for the receiver SDK
    /// This is the Hermes feed ID for SOL/USD
    pub const PYTH_SOL_USD_FEED_ID: &str = "0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d";
    
    /// Get Jito stake pool pubkey
    pub fn jito_stake_pool() -> Pubkey {
        JITO_STAKE_POOL.parse().unwrap()
    }
    
    /// Get JitoSOL mint pubkey
    pub fn jito_sol_mint() -> Pubkey {
        JITO_SOL_MINT.parse().unwrap()
    }
    
    /// Get SPL stake pool program pubkey
    pub fn spl_stake_pool_program() -> Pubkey {
        SPL_STAKE_POOL_PROGRAM.parse().unwrap()
    }
    
    /// Get Jupiter program pubkey
    pub fn jupiter_program() -> Pubkey {
        JUPITER_PROGRAM.parse().unwrap()
    }
}

/// Configuration constants
pub mod config {
    /// Minimum delay in seconds between commit and reveal
    pub const MIN_DELAY_SECONDS: i64 = 1;
    
    /// Maximum age of Pyth price feed in seconds
    pub const MAX_PRICE_AGE_SECONDS: u64 = 60;
    
    /// Maximum acceptable price deviation from oracle (5% = 500 bps)
    pub const MAX_PRICE_DEVIATION_BPS: u64 = 500;
}

