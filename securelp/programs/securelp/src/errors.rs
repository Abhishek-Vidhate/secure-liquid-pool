use anchor_lang::prelude::*;

/// Custom error codes for SecureLiquidPool program
#[error_code]
pub enum SecureLPError {
    /// Minimum delay between commit and reveal not met (requires ~1 second)
    #[msg("Minimum delay not met. Wait at least 1 second after commit.")]
    DelayNotMet,

    /// Hash computed from provided details doesn't match stored commitment
    #[msg("Hash mismatch. The provided swap details don't match the commitment.")]
    HashMismatch,

    /// Commitment has already been used or doesn't exist
    #[msg("Commitment not found or already used.")]
    CommitmentNotFound,

    /// Invalid mint provided
    #[msg("Invalid token mint provided.")]
    InvalidMint,

    /// Slippage too high (max 10%)
    #[msg("Slippage too high. Maximum allowed is 1000 bps (10%).")]
    SlippageTooHigh,

    /// Amount too small (min 0.001 SOL)
    #[msg("Amount too small. Minimum is 1,000,000 lamports (0.001 SOL).")]
    AmountTooSmall,

    /// Commitment already exists for this user
    #[msg("Commitment already exists. Complete or cancel existing commitment first.")]
    CommitmentAlreadyExists,

    /// Math overflow error
    #[msg("Math overflow occurred.")]
    MathOverflow,

    /// Insufficient balance for the operation
    #[msg("Insufficient balance for this operation.")]
    InsufficientBalance,
}
