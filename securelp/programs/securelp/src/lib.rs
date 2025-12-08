use anchor_lang::prelude::*;
use anchor_spl::token::{Token, TokenAccount, Mint};
use sha2::{Sha256, Digest};

pub mod errors;
pub mod state;

use errors::SecureLPError;
use state::{config, Commitment, SwapDetails};

// Import CPI modules from stake_pool and amm
use stake_pool::cpi::accounts::{DepositSol, WithdrawSol};
use stake_pool::cpi::{deposit_sol, withdraw_sol};
use stake_pool::program::StakePool;
use stake_pool::state::{PoolConfig, POOL_CONFIG_SEED, POOL_AUTHORITY_SEED, RESERVE_VAULT_SEED};

use amm::cpi::accounts::Swap as AmmSwapAccounts;
use amm::cpi::swap as amm_swap;
use amm::program::Amm;
use amm::state::{AmmPool, AMM_AUTHORITY_SEED};

declare_id!("BMxQAdqNJE3Zn6iJedc6A6XbsSTmNBQi6UzFdfrNvE21");

#[program]
pub mod securelp {
    use super::*;

    /// Commit Phase: Store a blinded hash of swap intent
    /// 
    /// This instruction creates a commitment PDA that stores the SHA-256 hash
    /// of the user's swap details. The actual parameters remain hidden from
    /// MEV bots observing the mempool.
    /// 
    /// # Arguments
    /// * `hash` - SHA-256 hash of serialized SwapDetails
    /// * `amount_lamports` - Amount being staked (for display/tracking)
    /// * `is_stake` - true for SOL->slpSOL, false for slpSOL->SOL
    pub fn commit(
        ctx: Context<Commit>,
        hash: [u8; 32],
        amount_lamports: u64,
        is_stake: bool,
    ) -> Result<()> {
        // Validate minimum amount
        require!(
            amount_lamports >= SwapDetails::MIN_AMOUNT,
            SecureLPError::AmountTooSmall
        );

        let commitment = &mut ctx.accounts.commitment;
        commitment.user = ctx.accounts.user.key();
        commitment.hash = hash;
        commitment.timestamp = Clock::get()?.unix_timestamp;
        commitment.bump = ctx.bumps.commitment;
        commitment.amount_lamports = amount_lamports;
        commitment.is_stake = is_stake;

        msg!(
            "Commitment created: user={}, amount={}, is_stake={}",
            ctx.accounts.user.key(),
            amount_lamports,
            is_stake
        );

        Ok(())
    }

    /// Reveal and Stake: Verify commitment and execute SOL -> slpSOL deposit
    /// 
    /// This instruction:
    /// 1. Verifies the minimum delay has passed since commit
    /// 2. Verifies the hash matches the provided SwapDetails
    /// 3. Executes stake_pool deposit via CPI
    /// 4. Closes the commitment PDA (returns rent to user)
    pub fn reveal_and_stake(
        ctx: Context<RevealAndStake>,
        details: SwapDetails,
    ) -> Result<()> {
        let commitment = &ctx.accounts.commitment;
        let clock = Clock::get()?;

        // Step 1: Verify minimum delay has passed
        require!(
            clock.unix_timestamp >= commitment.timestamp + config::MIN_DELAY_SECONDS,
            SecureLPError::DelayNotMet
        );

        // Step 2: Verify hash matches
        let serialized = details.try_to_vec().map_err(|_| SecureLPError::HashMismatch)?;
        let mut hasher = Sha256::new();
        hasher.update(&serialized);
        let computed_hash: [u8; 32] = hasher.finalize().into();
        require!(
            computed_hash == commitment.hash,
            SecureLPError::HashMismatch
        );

        // Step 3: Validate slippage
        require!(
            details.slippage_bps <= SwapDetails::MAX_SLIPPAGE_BPS,
            SecureLPError::SlippageTooHigh
        );

        // Step 4: Execute stake_pool deposit via CPI
        let cpi_program = ctx.accounts.stake_pool_program.to_account_info();
        let cpi_accounts = DepositSol {
            user: ctx.accounts.user.to_account_info(),
            pool_config: ctx.accounts.pool_config.to_account_info(),
            pool_authority: ctx.accounts.pool_authority.to_account_info(),
            reserve_vault: ctx.accounts.reserve_vault.to_account_info(),
            slp_mint: ctx.accounts.slp_mint.to_account_info(),
            user_slp_account: ctx.accounts.user_slp_account.to_account_info(),
            token_program: ctx.accounts.token_program.to_account_info(),
            system_program: ctx.accounts.system_program.to_account_info(),
        };
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
        deposit_sol(cpi_ctx, details.amount_in)?;

        msg!(
            "Stake complete: user={}, amount={} lamports",
            ctx.accounts.user.key(),
            details.amount_in
        );

        // Emit event for indexing
        emit!(StakeEvent {
            user: ctx.accounts.user.key(),
            amount_in: details.amount_in,
            min_out: details.min_out,
            timestamp: clock.unix_timestamp,
        });

        Ok(())
    }

    /// Reveal and Unstake: Verify commitment and execute slpSOL -> SOL withdrawal
    /// 
    /// This instruction:
    /// 1. Verifies the minimum delay has passed since commit
    /// 2. Verifies the hash matches the provided SwapDetails
    /// 3. Executes stake_pool withdrawal via CPI
    /// 4. Closes the commitment PDA (returns rent to user)
    pub fn reveal_and_unstake(
        ctx: Context<RevealAndUnstake>,
        details: SwapDetails,
    ) -> Result<()> {
        let commitment = &ctx.accounts.commitment;
        let clock = Clock::get()?;

        // Step 1: Verify minimum delay has passed
        require!(
            clock.unix_timestamp >= commitment.timestamp + config::MIN_DELAY_SECONDS,
            SecureLPError::DelayNotMet
        );

        // Step 2: Verify hash matches
        let serialized = details.try_to_vec().map_err(|_| SecureLPError::HashMismatch)?;
        let mut hasher = Sha256::new();
        hasher.update(&serialized);
        let computed_hash: [u8; 32] = hasher.finalize().into();
        require!(
            computed_hash == commitment.hash,
            SecureLPError::HashMismatch
        );

        // Step 3: Validate slippage
        require!(
            details.slippage_bps <= SwapDetails::MAX_SLIPPAGE_BPS,
            SecureLPError::SlippageTooHigh
        );

        // Step 4: Execute stake_pool withdrawal via CPI
        let cpi_program = ctx.accounts.stake_pool_program.to_account_info();
        let cpi_accounts = WithdrawSol {
            user: ctx.accounts.user.to_account_info(),
            pool_config: ctx.accounts.pool_config.to_account_info(),
            reserve_vault: ctx.accounts.reserve_vault.to_account_info(),
            slp_mint: ctx.accounts.slp_mint.to_account_info(),
            user_slp_account: ctx.accounts.user_slp_account.to_account_info(),
            token_program: ctx.accounts.token_program.to_account_info(),
            system_program: ctx.accounts.system_program.to_account_info(),
        };
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
        withdraw_sol(cpi_ctx, details.amount_in)?;

        msg!(
            "Unstake complete: user={}, slp_amount={}",
            ctx.accounts.user.key(),
            details.amount_in
        );

        // Emit event for indexing
        emit!(UnstakeEvent {
            user: ctx.accounts.user.key(),
            amount_in: details.amount_in,
            min_out: details.min_out,
            timestamp: clock.unix_timestamp,
        });

        Ok(())
    }

    /// Reveal and Swap: Verify commitment and execute AMM swap
    /// 
    /// This instruction:
    /// 1. Verifies the minimum delay has passed since commit
    /// 2. Verifies the hash matches the provided SwapDetails
    /// 3. Executes AMM swap via CPI
    /// 4. Closes the commitment PDA (returns rent to user)
    pub fn reveal_and_swap(
        ctx: Context<RevealAndSwap>,
        details: SwapDetails,
        a_to_b: bool,
    ) -> Result<()> {
        let commitment = &ctx.accounts.commitment;
        let clock = Clock::get()?;

        // Step 1: Verify minimum delay has passed
        require!(
            clock.unix_timestamp >= commitment.timestamp + config::MIN_DELAY_SECONDS,
            SecureLPError::DelayNotMet
        );

        // Step 2: Verify hash matches
        let serialized = details.try_to_vec().map_err(|_| SecureLPError::HashMismatch)?;
        let mut hasher = Sha256::new();
        hasher.update(&serialized);
        let computed_hash: [u8; 32] = hasher.finalize().into();
        require!(
            computed_hash == commitment.hash,
            SecureLPError::HashMismatch
        );

        // Step 3: Validate slippage
        require!(
            details.slippage_bps <= SwapDetails::MAX_SLIPPAGE_BPS,
            SecureLPError::SlippageTooHigh
        );

        // Step 4: Execute AMM swap via CPI
        let cpi_program = ctx.accounts.amm_program.to_account_info();
        let cpi_accounts = AmmSwapAccounts {
            user: ctx.accounts.user.to_account_info(),
            pool: ctx.accounts.amm_pool.to_account_info(),
            pool_authority: ctx.accounts.amm_authority.to_account_info(),
            token_a_vault: ctx.accounts.token_a_vault.to_account_info(),
            token_b_vault: ctx.accounts.token_b_vault.to_account_info(),
            user_token_in: ctx.accounts.user_token_in.to_account_info(),
            user_token_out: ctx.accounts.user_token_out.to_account_info(),
            token_program: ctx.accounts.token_program.to_account_info(),
        };
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
        amm_swap(cpi_ctx, details.amount_in, details.min_out, a_to_b)?;

        msg!(
            "AMM Swap complete: user={}, amount_in={}, min_out={}, a_to_b={}",
            ctx.accounts.user.key(),
            details.amount_in,
            details.min_out,
            a_to_b
        );

        // Emit event for indexing
        emit!(SwapEvent {
            user: ctx.accounts.user.key(),
            amount_in: details.amount_in,
            min_out: details.min_out,
            a_to_b,
            timestamp: clock.unix_timestamp,
        });

        Ok(())
    }

    /// Cancel Commitment: Allow user to cancel their commitment and reclaim rent
    /// 
    /// This can only be called by the original user who created the commitment.
    pub fn cancel_commitment(ctx: Context<CancelCommitment>) -> Result<()> {
        msg!(
            "Commitment cancelled: user={}",
            ctx.accounts.user.key()
        );
        Ok(())
    }
}

// ============================================================================
// ACCOUNT STRUCTS
// ============================================================================

/// Accounts for the commit instruction
#[derive(Accounts)]
pub struct Commit<'info> {
    /// The commitment PDA to create
    #[account(
        init,
        payer = user,
        space = Commitment::SPACE,
        seeds = [Commitment::SEED_PREFIX, user.key().as_ref()],
        bump
    )]
    pub commitment: Account<'info, Commitment>,

    /// The user creating the commitment (pays for PDA rent)
    #[account(mut)]
    pub user: Signer<'info>,

    /// System program for PDA creation
    pub system_program: Program<'info, System>,
}

/// Accounts for the reveal_and_stake instruction
#[derive(Accounts)]
pub struct RevealAndStake<'info> {
    /// The commitment PDA to verify and close
    #[account(
        mut,
        seeds = [Commitment::SEED_PREFIX, user.key().as_ref()],
        bump = commitment.bump,
        constraint = commitment.user == user.key() @ SecureLPError::CommitmentNotFound,
        constraint = commitment.is_stake @ SecureLPError::CommitmentNotFound,
        close = user
    )]
    pub commitment: Account<'info, Commitment>,

    /// The user executing the reveal (must match commitment creator)
    #[account(mut)]
    pub user: Signer<'info>,

    // === Stake Pool accounts ===
    
    /// Stake pool program
    pub stake_pool_program: Program<'info, StakePool>,

    /// Pool config PDA
    #[account(
        mut,
        seeds = [POOL_CONFIG_SEED],
        bump,
        seeds::program = stake_pool_program.key()
    )]
    pub pool_config: Account<'info, PoolConfig>,

    /// CHECK: Pool authority PDA
    #[account(
        seeds = [POOL_AUTHORITY_SEED, pool_config.key().as_ref()],
        bump,
        seeds::program = stake_pool_program.key()
    )]
    pub pool_authority: UncheckedAccount<'info>,

    /// CHECK: Reserve vault PDA
    #[account(
        mut,
        seeds = [RESERVE_VAULT_SEED, pool_config.key().as_ref()],
        bump,
        seeds::program = stake_pool_program.key()
    )]
    pub reserve_vault: UncheckedAccount<'info>,

    /// slpSOL mint
    #[account(
        mut,
        constraint = slp_mint.key() == pool_config.slp_mint @ SecureLPError::InvalidMint
    )]
    pub slp_mint: Account<'info, Mint>,

    /// User's slpSOL token account
    #[account(
        mut,
        constraint = user_slp_account.mint == slp_mint.key(),
        constraint = user_slp_account.owner == user.key()
    )]
    pub user_slp_account: Account<'info, TokenAccount>,

    /// Token program
    pub token_program: Program<'info, Token>,

    /// System program
    pub system_program: Program<'info, System>,
}

/// Accounts for the reveal_and_unstake instruction
#[derive(Accounts)]
pub struct RevealAndUnstake<'info> {
    /// The commitment PDA to verify and close
    #[account(
        mut,
        seeds = [Commitment::SEED_PREFIX, user.key().as_ref()],
        bump = commitment.bump,
        constraint = commitment.user == user.key() @ SecureLPError::CommitmentNotFound,
        constraint = !commitment.is_stake @ SecureLPError::CommitmentNotFound,
        close = user
    )]
    pub commitment: Account<'info, Commitment>,

    /// The user executing the reveal (must match commitment creator)
    #[account(mut)]
    pub user: Signer<'info>,

    // === Stake Pool accounts ===
    
    /// Stake pool program
    pub stake_pool_program: Program<'info, StakePool>,

    /// Pool config PDA
    #[account(
        mut,
        seeds = [POOL_CONFIG_SEED],
        bump,
        seeds::program = stake_pool_program.key()
    )]
    pub pool_config: Account<'info, PoolConfig>,

    /// CHECK: Reserve vault PDA
    #[account(
        mut,
        seeds = [RESERVE_VAULT_SEED, pool_config.key().as_ref()],
        bump,
        seeds::program = stake_pool_program.key()
    )]
    pub reserve_vault: UncheckedAccount<'info>,

    /// slpSOL mint
    #[account(
        mut,
        constraint = slp_mint.key() == pool_config.slp_mint @ SecureLPError::InvalidMint
    )]
    pub slp_mint: Account<'info, Mint>,

    /// User's slpSOL token account
    #[account(
        mut,
        constraint = user_slp_account.mint == slp_mint.key(),
        constraint = user_slp_account.owner == user.key()
    )]
    pub user_slp_account: Account<'info, TokenAccount>,

    /// Token program
    pub token_program: Program<'info, Token>,

    /// System program
    pub system_program: Program<'info, System>,
}

/// Accounts for the reveal_and_swap instruction (AMM)
#[derive(Accounts)]
pub struct RevealAndSwap<'info> {
    /// The commitment PDA to verify and close
    #[account(
        mut,
        seeds = [Commitment::SEED_PREFIX, user.key().as_ref()],
        bump = commitment.bump,
        constraint = commitment.user == user.key() @ SecureLPError::CommitmentNotFound,
        close = user
    )]
    pub commitment: Account<'info, Commitment>,

    /// The user executing the reveal
    #[account(mut)]
    pub user: Signer<'info>,

    // === AMM accounts ===
    
    /// AMM program
    pub amm_program: Program<'info, Amm>,

    /// AMM pool
    #[account(mut)]
    pub amm_pool: Account<'info, AmmPool>,

    /// CHECK: AMM authority PDA
    #[account(
        seeds = [AMM_AUTHORITY_SEED, amm_pool.key().as_ref()],
        bump,
        seeds::program = amm_program.key()
    )]
    pub amm_authority: UncheckedAccount<'info>,

    /// Token A vault
    #[account(
        mut,
        constraint = token_a_vault.key() == amm_pool.token_a_vault @ SecureLPError::InvalidMint
    )]
    pub token_a_vault: Account<'info, TokenAccount>,

    /// Token B vault
    #[account(
        mut,
        constraint = token_b_vault.key() == amm_pool.token_b_vault @ SecureLPError::InvalidMint
    )]
    pub token_b_vault: Account<'info, TokenAccount>,

    /// User's input token account
    #[account(mut)]
    pub user_token_in: Account<'info, TokenAccount>,

    /// User's output token account
    #[account(mut)]
    pub user_token_out: Account<'info, TokenAccount>,

    /// Token program
    pub token_program: Program<'info, Token>,

    /// System program
    pub system_program: Program<'info, System>,
}

/// Accounts for cancelling a commitment
#[derive(Accounts)]
pub struct CancelCommitment<'info> {
    /// The commitment PDA to close
    #[account(
        mut,
        seeds = [Commitment::SEED_PREFIX, user.key().as_ref()],
        bump = commitment.bump,
        constraint = commitment.user == user.key() @ SecureLPError::CommitmentNotFound,
        close = user
    )]
    pub commitment: Account<'info, Commitment>,

    /// The user who created the commitment
    #[account(mut)]
    pub user: Signer<'info>,
}

// ============================================================================
// EVENTS
// ============================================================================

/// Event emitted when a stake is completed
#[event]
pub struct StakeEvent {
    /// User who staked
    pub user: Pubkey,
    /// Amount of SOL staked (in lamports)
    pub amount_in: u64,
    /// Minimum slpSOL expected
    pub min_out: u64,
    /// Timestamp of the stake
    pub timestamp: i64,
}

/// Event emitted when an unstake is completed
#[event]
pub struct UnstakeEvent {
    /// User who unstaked
    pub user: Pubkey,
    /// Amount of slpSOL unstaked
    pub amount_in: u64,
    /// Minimum SOL expected
    pub min_out: u64,
    /// Timestamp of the unstake
    pub timestamp: i64,
}

/// Event emitted when an AMM swap is completed
#[event]
pub struct SwapEvent {
    /// User who swapped
    pub user: Pubkey,
    /// Amount in
    pub amount_in: u64,
    /// Minimum out
    pub min_out: u64,
    /// Direction (true = A to B, false = B to A)
    pub a_to_b: bool,
    /// Timestamp
    pub timestamp: i64,
}
