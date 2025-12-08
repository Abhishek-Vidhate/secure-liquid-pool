use anchor_lang::prelude::*;

/// Seed for AMM pool config PDA
pub const AMM_POOL_SEED: &[u8] = b"amm_pool";

/// Seed for AMM authority PDA
pub const AMM_AUTHORITY_SEED: &[u8] = b"amm_authority";

/// Seed for token vault A (SOL/wSOL)
pub const VAULT_A_SEED: &[u8] = b"vault_a";

/// Seed for token vault B (slpSOL)
pub const VAULT_B_SEED: &[u8] = b"vault_b";

/// Minimum liquidity locked forever to prevent manipulation
pub const MINIMUM_LIQUIDITY: u64 = 1000;

/// Default swap fee (0.3% = 30 bps)
pub const DEFAULT_FEE_BPS: u16 = 30;

/// AMM Pool configuration
#[account]
pub struct AmmPool {
    /// Pool authority (admin)
    pub authority: Pubkey,

    /// Token A mint (typically wSOL for native SOL)
    pub token_a_mint: Pubkey,

    /// Token B mint (slpSOL)
    pub token_b_mint: Pubkey,

    /// Token A vault (PDA-owned)
    pub token_a_vault: Pubkey,

    /// Token B vault (PDA-owned)
    pub token_b_vault: Pubkey,

    /// LP token mint
    pub lp_mint: Pubkey,

    /// Current reserve of token A
    pub reserve_a: u64,

    /// Current reserve of token B
    pub reserve_b: u64,

    /// Total LP tokens minted
    pub total_lp_supply: u64,

    /// Swap fee in basis points (e.g., 30 = 0.3%)
    pub fee_bps: u16,

    /// Whether pool is paused
    pub paused: bool,

    /// Cumulative fees collected for token A
    pub cumulative_fee_a: u64,

    /// Cumulative fees collected for token B
    pub cumulative_fee_b: u64,

    /// Bump for this PDA
    pub bump: u8,

    /// Bump for authority PDA
    pub authority_bump: u8,

    /// Reserved for future use
    pub _reserved: [u8; 32],
}

impl Default for AmmPool {
    fn default() -> Self {
        Self {
            authority: Pubkey::default(),
            token_a_mint: Pubkey::default(),
            token_b_mint: Pubkey::default(),
            token_a_vault: Pubkey::default(),
            token_b_vault: Pubkey::default(),
            lp_mint: Pubkey::default(),
            reserve_a: 0,
            reserve_b: 0,
            total_lp_supply: 0,
            fee_bps: DEFAULT_FEE_BPS,
            paused: false,
            cumulative_fee_a: 0,
            cumulative_fee_b: 0,
            bump: 0,
            authority_bump: 0,
            _reserved: [0u8; 32],
        }
    }
}

impl AmmPool {
    pub const LEN: usize = 8 + // discriminator
        32 + // authority
        32 + // token_a_mint
        32 + // token_b_mint
        32 + // token_a_vault
        32 + // token_b_vault
        32 + // lp_mint
        8 +  // reserve_a
        8 +  // reserve_b
        8 +  // total_lp_supply
        2 +  // fee_bps
        1 +  // paused
        8 +  // cumulative_fee_a
        8 +  // cumulative_fee_b
        1 +  // bump
        1 +  // authority_bump
        32;  // reserved

    /// Calculate the constant product K
    pub fn k(&self) -> u128 {
        (self.reserve_a as u128)
            .checked_mul(self.reserve_b as u128)
            .unwrap_or(0)
    }

    /// Calculate output amount for a swap using constant product formula
    /// x * y = k
    /// (x + dx) * (y - dy) = k
    /// dy = y - k / (x + dx)
    /// dy = y * dx / (x + dx) (simplified)
    pub fn calculate_swap_output(
        &self,
        input_amount: u64,
        input_is_a: bool,
    ) -> Result<(u64, u64)> {
        let (input_reserve, output_reserve) = if input_is_a {
            (self.reserve_a, self.reserve_b)
        } else {
            (self.reserve_b, self.reserve_a)
        };

        require!(input_reserve > 0 && output_reserve > 0, super::errors::AmmError::ZeroLiquidity);

        // Apply fee: input_after_fee = input * (10000 - fee_bps) / 10000
        let fee_multiplier = 10000u64.checked_sub(self.fee_bps as u64)
            .ok_or(error!(super::errors::AmmError::MathOverflow))?;
        
        let input_after_fee = (input_amount as u128)
            .checked_mul(fee_multiplier as u128)
            .ok_or(error!(super::errors::AmmError::MathOverflow))?
            .checked_div(10000)
            .ok_or(error!(super::errors::AmmError::MathOverflow))? as u64;

        let fee_amount = input_amount.checked_sub(input_after_fee)
            .ok_or(error!(super::errors::AmmError::MathOverflow))?;

        // Calculate output: output = output_reserve * input_after_fee / (input_reserve + input_after_fee)
        let numerator = (output_reserve as u128)
            .checked_mul(input_after_fee as u128)
            .ok_or(error!(super::errors::AmmError::MathOverflow))?;

        let denominator = (input_reserve as u128)
            .checked_add(input_after_fee as u128)
            .ok_or(error!(super::errors::AmmError::MathOverflow))?;

        let output_amount = numerator
            .checked_div(denominator)
            .ok_or(error!(super::errors::AmmError::MathOverflow))? as u64;

        Ok((output_amount, fee_amount))
    }

    /// Calculate LP tokens to mint for initial liquidity
    pub fn calculate_initial_lp(&self, amount_a: u64, amount_b: u64) -> Result<u64> {
        // Initial LP = sqrt(amount_a * amount_b) - MINIMUM_LIQUIDITY
        let product = (amount_a as u128)
            .checked_mul(amount_b as u128)
            .ok_or(error!(super::errors::AmmError::MathOverflow))?;

        let sqrt = integer_sqrt(product);
        
        if sqrt <= MINIMUM_LIQUIDITY as u128 {
            return Err(error!(super::errors::AmmError::MinimumLiquidityNotMet));
        }

        Ok((sqrt - MINIMUM_LIQUIDITY as u128) as u64)
    }

    /// Calculate LP tokens to mint for adding liquidity
    pub fn calculate_lp_tokens_for_liquidity(
        &self,
        amount_a: u64,
        amount_b: u64,
    ) -> Result<u64> {
        if self.total_lp_supply == 0 {
            return self.calculate_initial_lp(amount_a, amount_b);
        }

        // LP tokens = min(amount_a * total_lp / reserve_a, amount_b * total_lp / reserve_b)
        let lp_from_a = (amount_a as u128)
            .checked_mul(self.total_lp_supply as u128)
            .ok_or(error!(super::errors::AmmError::MathOverflow))?
            .checked_div(self.reserve_a as u128)
            .ok_or(error!(super::errors::AmmError::MathOverflow))? as u64;

        let lp_from_b = (amount_b as u128)
            .checked_mul(self.total_lp_supply as u128)
            .ok_or(error!(super::errors::AmmError::MathOverflow))?
            .checked_div(self.reserve_b as u128)
            .ok_or(error!(super::errors::AmmError::MathOverflow))? as u64;

        Ok(lp_from_a.min(lp_from_b))
    }

    /// Calculate tokens to return when removing liquidity
    pub fn calculate_tokens_for_lp(&self, lp_amount: u64) -> Result<(u64, u64)> {
        require!(self.total_lp_supply > 0, super::errors::AmmError::ZeroLiquidity);

        let amount_a = (lp_amount as u128)
            .checked_mul(self.reserve_a as u128)
            .ok_or(error!(super::errors::AmmError::MathOverflow))?
            .checked_div(self.total_lp_supply as u128)
            .ok_or(error!(super::errors::AmmError::MathOverflow))? as u64;

        let amount_b = (lp_amount as u128)
            .checked_mul(self.reserve_b as u128)
            .ok_or(error!(super::errors::AmmError::MathOverflow))?
            .checked_div(self.total_lp_supply as u128)
            .ok_or(error!(super::errors::AmmError::MathOverflow))? as u64;

        Ok((amount_a, amount_b))
    }

    /// Get current price of token A in terms of token B
    pub fn price_a_in_b(&self) -> u64 {
        if self.reserve_a == 0 {
            return 0;
        }
        // Price = reserve_b / reserve_a (scaled by 1e9 for precision)
        (self.reserve_b as u128)
            .checked_mul(1_000_000_000)
            .unwrap_or(0)
            .checked_div(self.reserve_a as u128)
            .unwrap_or(0) as u64
    }

    /// Get current price of token B in terms of token A
    pub fn price_b_in_a(&self) -> u64 {
        if self.reserve_b == 0 {
            return 0;
        }
        // Price = reserve_a / reserve_b (scaled by 1e9 for precision)
        (self.reserve_a as u128)
            .checked_mul(1_000_000_000)
            .unwrap_or(0)
            .checked_div(self.reserve_b as u128)
            .unwrap_or(0) as u64
    }
}

/// Integer square root using Newton's method
fn integer_sqrt(n: u128) -> u128 {
    if n == 0 {
        return 0;
    }
    
    let mut x = n;
    let mut y = (x + 1) / 2;
    
    while y < x {
        x = y;
        y = (x + n / x) / 2;
    }
    
    x
}

/// User's LP position (optional tracking)
#[account]
pub struct UserLpPosition {
    /// User's wallet
    pub owner: Pubkey,

    /// Pool this position is for
    pub pool: Pubkey,

    /// LP tokens owned
    pub lp_tokens: u64,

    /// Timestamp of first deposit
    pub first_deposit_ts: i64,

    /// Timestamp of last action
    pub last_action_ts: i64,

    /// Bump seed
    pub bump: u8,

    /// Reserved
    pub _reserved: [u8; 16],
}

impl Default for UserLpPosition {
    fn default() -> Self {
        Self {
            owner: Pubkey::default(),
            pool: Pubkey::default(),
            lp_tokens: 0,
            first_deposit_ts: 0,
            last_action_ts: 0,
            bump: 0,
            _reserved: [0u8; 16],
        }
    }
}

impl UserLpPosition {
    pub const LEN: usize = 8 + // discriminator
        32 + // owner
        32 + // pool
        8 +  // lp_tokens
        8 +  // first_deposit_ts
        8 +  // last_action_ts
        1 +  // bump
        16;  // reserved
}

