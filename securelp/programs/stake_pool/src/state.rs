use anchor_lang::prelude::*;

/// Maximum number of validators the pool can delegate to
pub const MAX_VALIDATORS: usize = 10;

/// Minimum deposit amount (0.01 SOL = 10_000_000 lamports)
pub const MIN_DEPOSIT_LAMPORTS: u64 = 10_000_000;

/// Reserve ratio in basis points (10% = 1000 bps)
/// Keeps 10% of deposits liquid for instant unstakes
pub const RESERVE_RATIO_BPS: u16 = 1000;

/// Seed for pool config PDA
pub const POOL_CONFIG_SEED: &[u8] = b"pool_config";

/// Seed for pool authority PDA (signs for stake operations)
pub const POOL_AUTHORITY_SEED: &[u8] = b"pool_authority";

/// Seed for reserve vault PDA
pub const RESERVE_VAULT_SEED: &[u8] = b"reserve_vault";

/// Seed for validator stake account PDA
pub const VALIDATOR_STAKE_SEED: &[u8] = b"validator_stake";

/// Main pool configuration account
#[account]
pub struct PoolConfig {
    /// Admin who can update pool settings
    pub admin: Pubkey,

    /// slpSOL token mint
    pub slp_mint: Pubkey,

    /// Total SOL currently staked with validators
    pub total_staked_lamports: u64,

    /// Total slpSOL tokens minted (supply)
    pub total_slp_supply: u64,

    /// SOL held in reserve for instant unstakes
    pub reserve_lamports: u64,

    /// Protocol fee in basis points (e.g., 100 = 1%)
    pub fee_bps: u16,

    /// Whether the pool is paused
    pub paused: bool,

    /// Last epoch when rewards were harvested
    pub last_harvest_epoch: u64,

    /// Number of validators in the pool
    pub validator_count: u8,

    /// Bump seed for this PDA
    pub bump: u8,

    /// Bump seed for pool authority PDA
    pub authority_bump: u8,

    /// Reserved for future use
    pub _reserved: [u8; 32],
}

impl Default for PoolConfig {
    fn default() -> Self {
        Self {
            admin: Pubkey::default(),
            slp_mint: Pubkey::default(),
            total_staked_lamports: 0,
            total_slp_supply: 0,
            reserve_lamports: 0,
            fee_bps: 0,
            paused: false,
            last_harvest_epoch: 0,
            validator_count: 0,
            bump: 0,
            authority_bump: 0,
            _reserved: [0u8; 32],
        }
    }
}

impl PoolConfig {
    pub const LEN: usize = 8 + // discriminator
        32 + // admin
        32 + // slp_mint
        8 +  // total_staked_lamports
        8 +  // total_slp_supply
        8 +  // reserve_lamports
        2 +  // fee_bps
        1 +  // paused
        8 +  // last_harvest_epoch
        1 +  // validator_count
        1 +  // bump
        1 +  // authority_bump
        32;  // reserved

    /// Calculate exchange rate: how much SOL per slpSOL
    /// Returns rate in lamports per slpSOL (with 9 decimal precision)
    pub fn exchange_rate(&self) -> u64 {
        if self.total_slp_supply == 0 {
            // 1:1 rate initially
            1_000_000_000 // 1 SOL in lamports
        } else {
            // Total SOL (staked + reserve) / total slpSOL supply
            // Use u128 to avoid overflow when scaling up
            let total_sol = self.total_staked_lamports
                .checked_add(self.reserve_lamports)
                .unwrap_or(0) as u128;
            
            // Scale up to avoid precision loss
            let rate = total_sol
                .checked_mul(1_000_000_000)
                .unwrap_or(0)
                .checked_div(self.total_slp_supply as u128)
                .unwrap_or(1_000_000_000);
            
            // Safe to unwrap since rate should fit in u64
            u64::try_from(rate).unwrap_or(1_000_000_000)
        }
    }

    /// Calculate slpSOL to mint for given SOL deposit
    pub fn calculate_slp_for_deposit(&self, sol_lamports: u64) -> Result<u64> {
        if self.total_slp_supply == 0 {
            // First deposit: 1:1 ratio
            Ok(sol_lamports)
        } else {
            // slp_to_mint = sol_deposited * total_slp_supply / total_sol
            // Use u128 for intermediate calculation to avoid overflow
            let total_sol = self.total_staked_lamports
                .checked_add(self.reserve_lamports)
                .ok_or(error!(super::errors::StakePoolError::MathOverflow))?;
            
            let result = (sol_lamports as u128)
                .checked_mul(self.total_slp_supply as u128)
                .ok_or(error!(super::errors::StakePoolError::MathOverflow))?
                .checked_div(total_sol as u128)
                .ok_or(error!(super::errors::StakePoolError::MathOverflow))?;
            
            // Convert back to u64, should fit since result <= sol_lamports
            u64::try_from(result)
                .map_err(|_| error!(super::errors::StakePoolError::MathOverflow))
        }
    }

    /// Calculate SOL to return for given slpSOL burn
    pub fn calculate_sol_for_withdrawal(&self, slp_amount: u64) -> Result<u64> {
        if self.total_slp_supply == 0 {
            return Ok(0);
        }

        // sol_to_return = slp_burned * total_sol / total_slp_supply
        // Use u128 for intermediate calculation to avoid overflow
        let total_sol = self.total_staked_lamports
            .checked_add(self.reserve_lamports)
            .ok_or(error!(super::errors::StakePoolError::MathOverflow))?;

        let result = (slp_amount as u128)
            .checked_mul(total_sol as u128)
            .ok_or(error!(super::errors::StakePoolError::MathOverflow))?
            .checked_div(self.total_slp_supply as u128)
            .ok_or(error!(super::errors::StakePoolError::MathOverflow))?;
        
        u64::try_from(result)
            .map_err(|_| error!(super::errors::StakePoolError::MathOverflow))
    }

    /// Calculate how much to keep in reserve vs stake
    pub fn calculate_reserve_amount(&self, deposit: u64) -> u64 {
        // Keep RESERVE_RATIO_BPS of deposit in reserve
        deposit
            .checked_mul(RESERVE_RATIO_BPS as u64)
            .unwrap_or(0)
            .checked_div(10000)
            .unwrap_or(0)
    }
}

/// Validator entry in the pool
#[account]
pub struct ValidatorEntry {
    /// The validator's vote account
    pub vote_account: Pubkey,

    /// The stake account delegated to this validator
    pub stake_account: Pubkey,

    /// Amount of lamports staked with this validator
    pub staked_lamports: u64,

    /// Last epoch this validator's stake was updated
    pub last_update_epoch: u64,

    /// Whether this validator is active
    pub active: bool,

    /// Bump seed for stake account PDA
    pub stake_bump: u8,

    /// Index in validator list
    pub index: u8,

    /// Reserved for future use
    pub _reserved: [u8; 16],
}

impl Default for ValidatorEntry {
    fn default() -> Self {
        Self {
            vote_account: Pubkey::default(),
            stake_account: Pubkey::default(),
            staked_lamports: 0,
            last_update_epoch: 0,
            active: false,
            stake_bump: 0,
            index: 0,
            _reserved: [0u8; 16],
        }
    }
}

impl ValidatorEntry {
    pub const LEN: usize = 8 + // discriminator
        32 + // vote_account
        32 + // stake_account
        8 +  // staked_lamports
        8 +  // last_update_epoch
        1 +  // active
        1 +  // stake_bump
        1 +  // index
        16;  // reserved
}

/// User's staking position (optional, for tracking)
#[account]
pub struct UserStake {
    /// User's wallet
    pub owner: Pubkey,

    /// Total slpSOL the user has received from this pool
    pub total_slp_received: u64,

    /// Total SOL the user has deposited
    pub total_sol_deposited: u64,

    /// Timestamp of first deposit
    pub first_deposit_ts: i64,

    /// Timestamp of last action
    pub last_action_ts: i64,

    /// Bump seed
    pub bump: u8,

    /// Reserved
    pub _reserved: [u8; 16],
}

impl Default for UserStake {
    fn default() -> Self {
        Self {
            owner: Pubkey::default(),
            total_slp_received: 0,
            total_sol_deposited: 0,
            first_deposit_ts: 0,
            last_action_ts: 0,
            bump: 0,
            _reserved: [0u8; 16],
        }
    }
}

impl UserStake {
    pub const LEN: usize = 8 + // discriminator
        32 + // owner
        8 +  // total_slp_received
        8 +  // total_sol_deposited
        8 +  // first_deposit_ts
        8 +  // last_action_ts
        1 +  // bump
        16;  // reserved
}

