use anchor_lang::prelude::*;

#[error_code]
pub enum StakePoolError {
    #[msg("Invalid authority")]
    InvalidAuthority,

    #[msg("Insufficient SOL for deposit")]
    InsufficientSol,

    #[msg("Insufficient slpSOL for withdrawal")]
    InsufficientSlpSol,

    #[msg("Pool is paused")]
    PoolPaused,

    #[msg("Invalid validator vote account")]
    InvalidValidator,

    #[msg("Validator already exists in pool")]
    ValidatorAlreadyExists,

    #[msg("Maximum validators reached")]
    MaxValidatorsReached,

    #[msg("Validator not found in pool")]
    ValidatorNotFound,

    #[msg("Arithmetic overflow")]
    MathOverflow,

    #[msg("Insufficient reserve for instant unstake")]
    InsufficientReserve,

    #[msg("Minimum stake amount not met (0.01 SOL)")]
    BelowMinimumStake,

    #[msg("Invalid stake account state")]
    InvalidStakeState,

    #[msg("Epoch has not changed since last harvest")]
    EpochNotChanged,

    #[msg("No rewards to harvest")]
    NoRewardsToHarvest,

    #[msg("Invalid mint authority")]
    InvalidMintAuthority,

    #[msg("Reserve ratio exceeded")]
    ReserveRatioExceeded,
}

