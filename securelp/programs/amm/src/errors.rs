use anchor_lang::prelude::*;

#[error_code]
pub enum AmmError {
    #[msg("Invalid authority")]
    InvalidAuthority,

    #[msg("Pool is paused")]
    PoolPaused,

    #[msg("Insufficient input amount")]
    InsufficientInput,

    #[msg("Insufficient output amount")]
    InsufficientOutput,

    #[msg("Slippage tolerance exceeded")]
    SlippageExceeded,

    #[msg("Arithmetic overflow")]
    MathOverflow,

    #[msg("Invalid token mint")]
    InvalidMint,

    #[msg("Pool already initialized")]
    PoolAlreadyInitialized,

    #[msg("Pool not initialized")]
    PoolNotInitialized,

    #[msg("Zero liquidity")]
    ZeroLiquidity,

    #[msg("Insufficient liquidity")]
    InsufficientLiquidity,

    #[msg("Invalid LP amount")]
    InvalidLpAmount,

    #[msg("Minimum liquidity not met")]
    MinimumLiquidityNotMet,

    #[msg("Invalid fee")]
    InvalidFee,

    #[msg("Same token swap not allowed")]
    SameTokenSwap,
}

