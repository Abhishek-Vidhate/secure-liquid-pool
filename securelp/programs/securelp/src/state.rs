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
    
    /// Whether this is a stake (SOL -> slpSOL) or unstake (slpSOL -> SOL)
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
    /// Amount of input tokens (lamports for SOL, smallest unit for slpSOL)
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

/// Configuration constants
pub mod config {
    /// Minimum delay in seconds between commit and reveal
    pub const MIN_DELAY_SECONDS: i64 = 1;
}
