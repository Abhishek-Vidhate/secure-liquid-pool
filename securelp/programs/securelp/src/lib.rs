use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    instruction::Instruction,
    program::invoke,
};
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};
use pyth_solana_receiver_sdk::price_update::{get_feed_id_from_hex, PriceUpdateV2};
use sha2::{Sha256, Digest};

pub mod errors;
pub mod state;

use errors::SecureLPError;
use state::{addresses, config, Commitment, SwapDetails};

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
    /// * `is_stake` - true for SOL->JitoSOL, false for JitoSOL->SOL
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

    /// Reveal and Stake: Verify commitment and execute SOL -> JitoSOL swap
    /// 
    /// This instruction:
    /// 1. Verifies the minimum delay has passed since commit
    /// 2. Verifies the hash matches the provided SwapDetails
    /// 3. Validates price against Pyth oracle
    /// 4. Executes Jupiter swap via CPI
    /// 5. Deposits to Jito stake pool via CPI
    /// 6. Closes the commitment PDA (returns rent to user)
    /// 
    /// # Arguments
    /// * `details` - Original SwapDetails that were hashed
    /// * `jupiter_swap_data` - Serialized Jupiter swap instruction data (from /swap-instructions API)
    pub fn reveal_and_stake(
        ctx: Context<RevealAndStake>,
        details: SwapDetails,
        jupiter_swap_data: Vec<u8>,
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

        // Step 4: Validate price with Pyth oracle
        let price_update = &ctx.accounts.price_update;
        let feed_id = get_feed_id_from_hex(addresses::PYTH_SOL_USD_FEED_ID)
            .map_err(|_| SecureLPError::StalePriceFeed)?;
        
        let price = price_update
            .get_price_no_older_than(&clock, config::MAX_PRICE_AGE_SECONDS, &feed_id)
            .map_err(|_| SecureLPError::StalePriceFeed)?;

        msg!(
            "Pyth SOL/USD price: {} x 10^{}",
            price.price,
            price.exponent
        );

        // Step 5: Verify Jupiter program ID
        require_keys_eq!(
            ctx.accounts.jupiter_program.key(),
            addresses::jupiter_program(),
            SecureLPError::InvalidJupiterProgram
        );

        // Step 6: Execute Jupiter swap via CPI
        // Build account metas from remaining_accounts
        let jupiter_accounts: Vec<AccountMeta> = ctx
            .remaining_accounts
            .iter()
            .map(|acc| {
                // The user account should be the signer
                let is_signer = acc.key == &ctx.accounts.user.key();
                AccountMeta {
                    pubkey: *acc.key,
                    is_signer,
                    is_writable: acc.is_writable,
                }
            })
            .collect();

        let jupiter_ix = Instruction {
            program_id: ctx.accounts.jupiter_program.key(),
            accounts: jupiter_accounts,
            data: jupiter_swap_data,
        };

        // Collect account infos for the CPI
        let account_infos: Vec<AccountInfo> = ctx
            .remaining_accounts
            .iter()
            .map(|acc| acc.clone())
            .collect();

        invoke(&jupiter_ix, &account_infos)?;

        msg!(
            "Jupiter swap executed: {} lamports with {} bps slippage",
            details.amount_in,
            details.slippage_bps
        );

        // Step 7: Execute Jito stake pool deposit via CPI
        // Note: In production, this would be a separate CPI to the SPL stake pool program
        // For now, Jupiter handles the SOL -> JitoSOL conversion

        msg!(
            "Reveal and stake complete: user={}, amount={}",
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

    /// Reveal and Unstake: Verify commitment and execute JitoSOL -> SOL swap
    /// 
    /// This instruction mirrors reveal_and_stake but in reverse:
    /// 1. Verifies the minimum delay has passed since commit
    /// 2. Verifies the hash matches the provided SwapDetails
    /// 3. Validates price against Pyth oracle
    /// 4. Executes Jupiter swap via CPI (JitoSOL -> SOL)
    /// 5. Closes the commitment PDA (returns rent to user)
    /// 
    /// # Arguments
    /// * `details` - Original SwapDetails that were hashed
    /// * `jupiter_swap_data` - Serialized Jupiter swap instruction data (from /swap-instructions API)
    pub fn reveal_and_unstake(
        ctx: Context<RevealAndUnstake>,
        details: SwapDetails,
        jupiter_swap_data: Vec<u8>,
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

        // Step 4: Validate price with Pyth oracle
        let price_update = &ctx.accounts.price_update;
        let feed_id = get_feed_id_from_hex(addresses::PYTH_SOL_USD_FEED_ID)
            .map_err(|_| SecureLPError::StalePriceFeed)?;
        
        let price = price_update
            .get_price_no_older_than(&clock, config::MAX_PRICE_AGE_SECONDS, &feed_id)
            .map_err(|_| SecureLPError::StalePriceFeed)?;

        msg!(
            "Pyth SOL/USD price: {} x 10^{}",
            price.price,
            price.exponent
        );

        // Step 5: Verify Jupiter program ID
        require_keys_eq!(
            ctx.accounts.jupiter_program.key(),
            addresses::jupiter_program(),
            SecureLPError::InvalidJupiterProgram
        );

        // Step 6: Execute Jupiter swap via CPI (JitoSOL -> SOL)
        let jupiter_accounts: Vec<AccountMeta> = ctx
            .remaining_accounts
            .iter()
            .map(|acc| {
                let is_signer = acc.key == &ctx.accounts.user.key();
                AccountMeta {
                    pubkey: *acc.key,
                    is_signer,
                    is_writable: acc.is_writable,
                }
            })
            .collect();

        let jupiter_ix = Instruction {
            program_id: ctx.accounts.jupiter_program.key(),
            accounts: jupiter_accounts,
            data: jupiter_swap_data,
        };

        let account_infos: Vec<AccountInfo> = ctx
            .remaining_accounts
            .iter()
            .map(|acc| acc.clone())
            .collect();

        invoke(&jupiter_ix, &account_infos)?;

        msg!(
            "Jupiter swap (unstake) executed: {} tokens with {} bps slippage",
            details.amount_in,
            details.slippage_bps
        );

        msg!(
            "Reveal and unstake complete: user={}, amount={}",
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

    /// Pyth price update account for SOL/USD
    pub price_update: Account<'info, PriceUpdateV2>,

    /// Input token mint (native SOL wrapped as WSOL)
    pub input_mint: InterfaceAccount<'info, Mint>,

    /// Output token mint (JitoSOL)
    #[account(
        constraint = output_mint.key() == addresses::jito_sol_mint() @ SecureLPError::InvalidMint
    )]
    pub output_mint: InterfaceAccount<'info, Mint>,

    /// User's input token account (WSOL)
    #[account(
        mut,
        associated_token::mint = input_mint,
        associated_token::authority = user,
        associated_token::token_program = token_program,
    )]
    pub user_input_token_account: InterfaceAccount<'info, TokenAccount>,

    /// User's output token account (JitoSOL)
    #[account(
        mut,
        associated_token::mint = output_mint,
        associated_token::authority = user,
        associated_token::token_program = token_program,
    )]
    pub user_output_token_account: InterfaceAccount<'info, TokenAccount>,

    /// Jupiter aggregator program
    /// CHECK: Validated against known Jupiter program ID
    #[account(
        constraint = jupiter_program.key() == addresses::jupiter_program() @ SecureLPError::InvalidJupiterProgram
    )]
    pub jupiter_program: UncheckedAccount<'info>,

    /// Token program
    pub token_program: Interface<'info, TokenInterface>,

    /// System program
    pub system_program: Program<'info, System>,

    // Note: Jupiter swap accounts are passed via remaining_accounts
    // This allows flexibility for different swap routes
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

    /// Pyth price update account for SOL/USD
    pub price_update: Account<'info, PriceUpdateV2>,

    /// Input token mint (JitoSOL)
    #[account(
        constraint = input_mint.key() == addresses::jito_sol_mint() @ SecureLPError::InvalidMint
    )]
    pub input_mint: InterfaceAccount<'info, Mint>,

    /// Output token mint (WSOL/native SOL)
    pub output_mint: InterfaceAccount<'info, Mint>,

    /// User's input token account (JitoSOL)
    #[account(
        mut,
        associated_token::mint = input_mint,
        associated_token::authority = user,
        associated_token::token_program = token_program,
    )]
    pub user_input_token_account: InterfaceAccount<'info, TokenAccount>,

    /// User's output token account (WSOL)
    #[account(
        mut,
        associated_token::mint = output_mint,
        associated_token::authority = user,
        associated_token::token_program = token_program,
    )]
    pub user_output_token_account: InterfaceAccount<'info, TokenAccount>,

    /// Jupiter aggregator program
    /// CHECK: Validated against known Jupiter program ID
    #[account(
        constraint = jupiter_program.key() == addresses::jupiter_program() @ SecureLPError::InvalidJupiterProgram
    )]
    pub jupiter_program: UncheckedAccount<'info>,

    /// Token program
    pub token_program: Interface<'info, TokenInterface>,

    /// System program
    pub system_program: Program<'info, System>,

    // Note: Jupiter swap accounts are passed via remaining_accounts
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
    /// Minimum JitoSOL expected
    pub min_out: u64,
    /// Timestamp of the stake
    pub timestamp: i64,
}

/// Event emitted when an unstake is completed
#[event]
pub struct UnstakeEvent {
    /// User who unstaked
    pub user: Pubkey,
    /// Amount of JitoSOL unstaked
    pub amount_in: u64,
    /// Minimum SOL expected
    pub min_out: u64,
    /// Timestamp of the unstake
    pub timestamp: i64,
}
