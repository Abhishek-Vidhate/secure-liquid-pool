use anchor_lang::prelude::*;
use anchor_lang::system_program;
use anchor_lang::solana_program::{program::invoke_signed, system_instruction};
use anchor_spl::token::{self, Mint, MintTo, Burn, Token, TokenAccount};
use anchor_spl::metadata::{
    create_metadata_accounts_v3,
    CreateMetadataAccountsV3,
    Metadata,
    mpl_token_metadata::types::DataV2,
};

pub mod errors;
pub mod state;

use errors::StakePoolError;
use state::*;

declare_id!("EyWBdqo6J5KEzQSvPYhsGFXjJfC6kkmTMGo8JTEzqhZ7");

#[program]
pub mod stake_pool {
    use super::*;

    /// Initialize the staking pool with slpSOL mint
    pub fn initialize_pool(ctx: Context<InitializePool>, fee_bps: u16) -> Result<()> {
        let pool = &mut ctx.accounts.pool_config;

        pool.admin = ctx.accounts.admin.key();
        pool.slp_mint = ctx.accounts.slp_mint.key();
        pool.total_staked_lamports = 0;
        pool.total_slp_supply = 0;
        pool.reserve_lamports = 0;
        pool.fee_bps = fee_bps;
        pool.paused = false;
        pool.last_harvest_epoch = 0;
        pool.validator_count = 0;
        pool.bump = ctx.bumps.pool_config;
        pool.authority_bump = ctx.bumps.pool_authority;

        msg!("Pool initialized with fee: {} bps", fee_bps);
        emit!(PoolInitialized {
            admin: pool.admin,
            slp_mint: pool.slp_mint,
            fee_bps,
        });

        Ok(())
    }

    /// Add a validator to the pool's delegation list
    pub fn add_validator(ctx: Context<AddValidator>) -> Result<()> {
        let pool = &mut ctx.accounts.pool_config;
        
        require!(!pool.paused, StakePoolError::PoolPaused);
        require!(
            pool.validator_count < MAX_VALIDATORS as u8,
            StakePoolError::MaxValidatorsReached
        );

        let validator = &mut ctx.accounts.validator_entry;
        validator.vote_account = ctx.accounts.vote_account.key();
        validator.stake_account = Pubkey::default(); // Set when stake is created
        validator.staked_lamports = 0;
        validator.last_update_epoch = Clock::get()?.epoch;
        validator.active = true;
        validator.index = pool.validator_count;

        pool.validator_count += 1;

        msg!("Validator added: {}", validator.vote_account);
        emit!(ValidatorAdded {
            vote_account: validator.vote_account,
            index: validator.index,
        });

        Ok(())
    }

    /// Deposit SOL and receive slpSOL tokens
    pub fn deposit_sol(ctx: Context<DepositSol>, amount_lamports: u64) -> Result<()> {
        let pool = &mut ctx.accounts.pool_config;
        
        require!(!pool.paused, StakePoolError::PoolPaused);
        require!(
            amount_lamports >= MIN_DEPOSIT_LAMPORTS,
            StakePoolError::BelowMinimumStake
        );

        // Calculate slpSOL to mint
        let slp_to_mint = pool.calculate_slp_for_deposit(amount_lamports)?;
        require!(slp_to_mint > 0, StakePoolError::MathOverflow);

        // Transfer SOL from user to reserve vault
        let cpi_context = CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            system_program::Transfer {
                from: ctx.accounts.user.to_account_info(),
                to: ctx.accounts.reserve_vault.to_account_info(),
            },
        );
        system_program::transfer(cpi_context, amount_lamports)?;

        // Calculate reserve vs stake amounts
        let reserve_amount = pool.calculate_reserve_amount(amount_lamports);
        let stake_amount = amount_lamports.checked_sub(reserve_amount).unwrap_or(0);

        // Update pool state
        pool.reserve_lamports = pool.reserve_lamports
            .checked_add(reserve_amount)
            .ok_or(StakePoolError::MathOverflow)?;
        pool.total_staked_lamports = pool.total_staked_lamports
            .checked_add(stake_amount)
            .ok_or(StakePoolError::MathOverflow)?;
        pool.total_slp_supply = pool.total_slp_supply
            .checked_add(slp_to_mint)
            .ok_or(StakePoolError::MathOverflow)?;

        // Mint slpSOL to user
        let pool_key = pool.key();
        let seeds = &[
            POOL_AUTHORITY_SEED,
            pool_key.as_ref(),
            &[pool.authority_bump],
        ];
        let signer_seeds = &[&seeds[..]];

        let cpi_accounts = MintTo {
            mint: ctx.accounts.slp_mint.to_account_info(),
            to: ctx.accounts.user_slp_account.to_account_info(),
            authority: ctx.accounts.pool_authority.to_account_info(),
        };
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            cpi_accounts,
            signer_seeds,
        );
        token::mint_to(cpi_ctx, slp_to_mint)?;

        msg!(
            "Deposited {} lamports, minted {} slpSOL",
            amount_lamports,
            slp_to_mint
        );
        emit!(Deposited {
            user: ctx.accounts.user.key(),
            sol_amount: amount_lamports,
            slp_minted: slp_to_mint,
            exchange_rate: pool.exchange_rate(),
        });

        Ok(())
    }

    /// Withdraw SOL by burning slpSOL tokens
    pub fn withdraw_sol(ctx: Context<WithdrawSol>, slp_amount: u64) -> Result<()> {
        let pool = &mut ctx.accounts.pool_config;
        
        require!(!pool.paused, StakePoolError::PoolPaused);
        require!(slp_amount > 0, StakePoolError::InsufficientSlpSol);

        // Calculate SOL to return
        let sol_to_return = pool.calculate_sol_for_withdrawal(slp_amount)?;
        require!(sol_to_return > 0, StakePoolError::MathOverflow);

        // Check if we have enough in reserve for instant unstake
        require!(
            pool.reserve_lamports >= sol_to_return,
            StakePoolError::InsufficientReserve
        );

        // Burn slpSOL from user
        let cpi_accounts = Burn {
            mint: ctx.accounts.slp_mint.to_account_info(),
            from: ctx.accounts.user_slp_account.to_account_info(),
            authority: ctx.accounts.user.to_account_info(),
        };
        let cpi_ctx = CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            cpi_accounts,
        );
        token::burn(cpi_ctx, slp_amount)?;

        // Transfer SOL from reserve vault PDA to user using invoke_signed
        // This is required because the reserve vault is owned by the system program
        let pool_key = pool.key();
        let bump = ctx.bumps.reserve_vault;
        let seeds: &[&[u8]] = &[
            RESERVE_VAULT_SEED,
            pool_key.as_ref(),
            &[bump],
        ];
        let signer_seeds = &[seeds];

        invoke_signed(
            &system_instruction::transfer(
                &ctx.accounts.reserve_vault.key(),
                &ctx.accounts.user.key(),
                sol_to_return,
            ),
            &[
                ctx.accounts.reserve_vault.to_account_info(),
                ctx.accounts.user.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
            signer_seeds,
        )?;

        // Update pool state
        pool.reserve_lamports = pool.reserve_lamports
            .checked_sub(sol_to_return)
            .ok_or(StakePoolError::MathOverflow)?;
        pool.total_slp_supply = pool.total_slp_supply
            .checked_sub(slp_amount)
            .ok_or(StakePoolError::MathOverflow)?;

        msg!(
            "Withdrew {} lamports, burned {} slpSOL",
            sol_to_return,
            slp_amount
        );
        emit!(Withdrawn {
            user: ctx.accounts.user.key(),
            sol_amount: sol_to_return,
            slp_burned: slp_amount,
            exchange_rate: pool.exchange_rate(),
        });

        Ok(())
    }

    /// Crank: Move SOL from reserve to validators
    /// This is called periodically to actually stake the deposited SOL
    pub fn delegate_stake(ctx: Context<DelegateStake>, amount_lamports: u64) -> Result<()> {
        let pool = &mut ctx.accounts.pool_config;
        
        require!(!pool.paused, StakePoolError::PoolPaused);
        require!(pool.validator_count > 0, StakePoolError::ValidatorNotFound);

        // For devnet simplicity, we just track the amount as "staked"
        // without actually creating stake accounts (which requires rent-exempt minimum)
        // In production, this would create actual stake accounts
        
        let validator = &mut ctx.accounts.validator_entry;
        require!(validator.active, StakePoolError::InvalidValidator);

        // Move from reserve to staked tracking
        // Note: In a full implementation, we'd create stake accounts here
        let transfer_amount = amount_lamports.min(pool.reserve_lamports);
        
        pool.reserve_lamports = pool.reserve_lamports
            .checked_sub(transfer_amount)
            .ok_or(StakePoolError::MathOverflow)?;
        pool.total_staked_lamports = pool.total_staked_lamports
            .checked_add(transfer_amount)
            .ok_or(StakePoolError::MathOverflow)?;
        
        validator.staked_lamports = validator.staked_lamports
            .checked_add(transfer_amount)
            .ok_or(StakePoolError::MathOverflow)?;
        validator.last_update_epoch = Clock::get()?.epoch;

        msg!(
            "Delegated {} lamports to validator {}",
            transfer_amount,
            validator.vote_account
        );
        emit!(StakeDelegated {
            validator: validator.vote_account,
            amount: transfer_amount,
            epoch: validator.last_update_epoch,
        });

        Ok(())
    }

    /// Crank: Simulate harvesting epoch rewards
    /// On devnet, we simulate rewards based on ~7% APY
    pub fn harvest_rewards(ctx: Context<HarvestRewards>) -> Result<()> {
        let pool = &mut ctx.accounts.pool_config;
        let clock = Clock::get()?;

        require!(!pool.paused, StakePoolError::PoolPaused);
        require!(
            clock.epoch > pool.last_harvest_epoch,
            StakePoolError::EpochNotChanged
        );

        // Calculate simulated rewards
        // ~7% APY = ~0.019% per epoch (assuming ~365 epochs/year)
        // rewards = total_staked * 0.00019 per epoch
        let epochs_passed = clock.epoch
            .checked_sub(pool.last_harvest_epoch)
            .unwrap_or(1)
            .max(1);

        // 19 basis points per epoch (0.019%)
        let reward_rate_per_epoch: u64 = 19;
        let rewards_lamports = pool.total_staked_lamports
            .checked_mul(reward_rate_per_epoch)
            .ok_or(StakePoolError::MathOverflow)?
            .checked_mul(epochs_passed)
            .ok_or(StakePoolError::MathOverflow)?
            .checked_div(100_000) // Divide by 100_000 to get the rate
            .ok_or(StakePoolError::MathOverflow)?;

        if rewards_lamports == 0 {
            msg!("No rewards to harvest");
            return Ok(());
        }

        // Deduct protocol fee
        let protocol_fee = rewards_lamports
            .checked_mul(pool.fee_bps as u64)
            .ok_or(StakePoolError::MathOverflow)?
            .checked_div(10_000)
            .ok_or(StakePoolError::MathOverflow)?;

        let net_rewards = rewards_lamports
            .checked_sub(protocol_fee)
            .ok_or(StakePoolError::MathOverflow)?;

        // Add net rewards to total staked (increases exchange rate)
        pool.total_staked_lamports = pool.total_staked_lamports
            .checked_add(net_rewards)
            .ok_or(StakePoolError::MathOverflow)?;

        pool.last_harvest_epoch = clock.epoch;

        msg!(
            "Harvested {} lamports ({} net after {} fee) over {} epochs",
            rewards_lamports,
            net_rewards,
            protocol_fee,
            epochs_passed
        );
        emit!(RewardsHarvested {
            gross_rewards: rewards_lamports,
            protocol_fee,
            net_rewards,
            new_exchange_rate: pool.exchange_rate(),
            epoch: clock.epoch,
        });

        Ok(())
    }

    /// Admin: Pause/unpause the pool
    pub fn set_paused(ctx: Context<AdminAction>, paused: bool) -> Result<()> {
        let pool = &mut ctx.accounts.pool_config;
        pool.paused = paused;
        
        msg!("Pool paused: {}", paused);
        Ok(())
    }

    /// Admin: Update fee
    pub fn update_fee(ctx: Context<AdminAction>, new_fee_bps: u16) -> Result<()> {
        let pool = &mut ctx.accounts.pool_config;
        
        require!(new_fee_bps <= 1000, StakePoolError::InvalidAuthority); // Max 10%
        pool.fee_bps = new_fee_bps;
        
        msg!("Fee updated to {} bps", new_fee_bps);
        Ok(())
    }

    /// Admin: Create token metadata for secuSOL
    pub fn create_token_metadata(
        ctx: Context<CreateTokenMetadata>,
        name: String,
        symbol: String,
        uri: String,
    ) -> Result<()> {
        let pool = &ctx.accounts.pool_config;

        // Create signer seeds for pool authority
        let pool_key = pool.key();
        let seeds = &[
            POOL_AUTHORITY_SEED,
            pool_key.as_ref(),
            &[pool.authority_bump],
        ];
        let signer_seeds = &[&seeds[..]];

        // Create metadata
        let data_v2 = DataV2 {
            name,
            symbol,
            uri,
            seller_fee_basis_points: 0,
            creators: None,
            collection: None,
            uses: None,
        };

        let cpi_accounts = CreateMetadataAccountsV3 {
            metadata: ctx.accounts.metadata.to_account_info(),
            mint: ctx.accounts.slp_mint.to_account_info(),
            mint_authority: ctx.accounts.pool_authority.to_account_info(),
            payer: ctx.accounts.admin.to_account_info(),
            update_authority: ctx.accounts.pool_authority.to_account_info(),
            system_program: ctx.accounts.system_program.to_account_info(),
            rent: ctx.accounts.rent.to_account_info(),
        };

        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_metadata_program.to_account_info(),
            cpi_accounts,
            signer_seeds,
        );

        create_metadata_accounts_v3(cpi_ctx, data_v2, true, true, None)?;

        msg!("Token metadata created successfully!");
        Ok(())
    }
}

// ============================================================================
// Account Contexts
// ============================================================================

#[derive(Accounts)]
pub struct InitializePool<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        init,
        payer = admin,
        space = PoolConfig::LEN,
        seeds = [POOL_CONFIG_SEED],
        bump
    )]
    pub pool_config: Account<'info, PoolConfig>,

    /// CHECK: PDA used as mint/stake authority
    #[account(
        seeds = [POOL_AUTHORITY_SEED, pool_config.key().as_ref()],
        bump
    )]
    pub pool_authority: UncheckedAccount<'info>,

    /// CHECK: PDA used as reserve vault
    #[account(
        mut,
        seeds = [RESERVE_VAULT_SEED, pool_config.key().as_ref()],
        bump
    )]
    pub reserve_vault: UncheckedAccount<'info>,

    #[account(
        init,
        payer = admin,
        mint::decimals = 9,
        mint::authority = pool_authority,
        mint::freeze_authority = pool_authority,
    )]
    pub slp_mint: Account<'info, Mint>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct AddValidator<'info> {
    #[account(
        mut,
        constraint = admin.key() == pool_config.admin @ StakePoolError::InvalidAuthority
    )]
    pub admin: Signer<'info>,

    #[account(
        mut,
        seeds = [POOL_CONFIG_SEED],
        bump = pool_config.bump
    )]
    pub pool_config: Account<'info, PoolConfig>,

    /// CHECK: Validated by checking it's a valid vote account
    pub vote_account: UncheckedAccount<'info>,

    #[account(
        init,
        payer = admin,
        space = ValidatorEntry::LEN,
        seeds = [VALIDATOR_STAKE_SEED, pool_config.key().as_ref(), vote_account.key().as_ref()],
        bump
    )]
    pub validator_entry: Account<'info, ValidatorEntry>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct DepositSol<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        mut,
        seeds = [POOL_CONFIG_SEED],
        bump = pool_config.bump
    )]
    pub pool_config: Account<'info, PoolConfig>,

    /// CHECK: PDA authority for minting
    #[account(
        seeds = [POOL_AUTHORITY_SEED, pool_config.key().as_ref()],
        bump = pool_config.authority_bump
    )]
    pub pool_authority: UncheckedAccount<'info>,

    /// CHECK: PDA vault for SOL reserve
    #[account(
        mut,
        seeds = [RESERVE_VAULT_SEED, pool_config.key().as_ref()],
        bump
    )]
    pub reserve_vault: UncheckedAccount<'info>,

    #[account(
        mut,
        constraint = slp_mint.key() == pool_config.slp_mint @ StakePoolError::InvalidMintAuthority
    )]
    pub slp_mint: Account<'info, Mint>,

    #[account(
        mut,
        constraint = user_slp_account.mint == slp_mint.key(),
        constraint = user_slp_account.owner == user.key()
    )]
    pub user_slp_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct WithdrawSol<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        mut,
        seeds = [POOL_CONFIG_SEED],
        bump = pool_config.bump
    )]
    pub pool_config: Account<'info, PoolConfig>,

    /// CHECK: PDA vault for SOL reserve
    #[account(
        mut,
        seeds = [RESERVE_VAULT_SEED, pool_config.key().as_ref()],
        bump
    )]
    pub reserve_vault: UncheckedAccount<'info>,

    #[account(
        mut,
        constraint = slp_mint.key() == pool_config.slp_mint @ StakePoolError::InvalidMintAuthority
    )]
    pub slp_mint: Account<'info, Mint>,

    #[account(
        mut,
        constraint = user_slp_account.mint == slp_mint.key(),
        constraint = user_slp_account.owner == user.key()
    )]
    pub user_slp_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct DelegateStake<'info> {
    pub cranker: Signer<'info>,

    #[account(
        mut,
        seeds = [POOL_CONFIG_SEED],
        bump = pool_config.bump
    )]
    pub pool_config: Account<'info, PoolConfig>,

    #[account(
        mut,
        seeds = [VALIDATOR_STAKE_SEED, pool_config.key().as_ref(), validator_entry.vote_account.as_ref()],
        bump
    )]
    pub validator_entry: Account<'info, ValidatorEntry>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct HarvestRewards<'info> {
    pub cranker: Signer<'info>,

    #[account(
        mut,
        seeds = [POOL_CONFIG_SEED],
        bump = pool_config.bump
    )]
    pub pool_config: Account<'info, PoolConfig>,
}

#[derive(Accounts)]
pub struct AdminAction<'info> {
    #[account(
        constraint = admin.key() == pool_config.admin @ StakePoolError::InvalidAuthority
    )]
    pub admin: Signer<'info>,

    #[account(
        mut,
        seeds = [POOL_CONFIG_SEED],
        bump = pool_config.bump
    )]
    pub pool_config: Account<'info, PoolConfig>,
}

#[derive(Accounts)]
pub struct CreateTokenMetadata<'info> {
    #[account(
        mut,
        constraint = admin.key() == pool_config.admin @ StakePoolError::InvalidAuthority
    )]
    pub admin: Signer<'info>,

    #[account(
        seeds = [POOL_CONFIG_SEED],
        bump = pool_config.bump
    )]
    pub pool_config: Account<'info, PoolConfig>,

    /// CHECK: Pool authority PDA - mint authority for slp_mint
    #[account(
        seeds = [POOL_AUTHORITY_SEED, pool_config.key().as_ref()],
        bump = pool_config.authority_bump
    )]
    pub pool_authority: UncheckedAccount<'info>,

    #[account(
        constraint = slp_mint.key() == pool_config.slp_mint @ StakePoolError::InvalidMintAuthority
    )]
    pub slp_mint: Account<'info, Mint>,

    /// CHECK: Metadata account to be created
    #[account(mut)]
    pub metadata: UncheckedAccount<'info>,

    pub token_metadata_program: Program<'info, Metadata>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

// ============================================================================
// Events
// ============================================================================

#[event]
pub struct PoolInitialized {
    pub admin: Pubkey,
    pub slp_mint: Pubkey,
    pub fee_bps: u16,
}

#[event]
pub struct ValidatorAdded {
    pub vote_account: Pubkey,
    pub index: u8,
}

#[event]
pub struct Deposited {
    pub user: Pubkey,
    pub sol_amount: u64,
    pub slp_minted: u64,
    pub exchange_rate: u64,
}

#[event]
pub struct Withdrawn {
    pub user: Pubkey,
    pub sol_amount: u64,
    pub slp_burned: u64,
    pub exchange_rate: u64,
}

#[event]
pub struct StakeDelegated {
    pub validator: Pubkey,
    pub amount: u64,
    pub epoch: u64,
}

#[event]
pub struct RewardsHarvested {
    pub gross_rewards: u64,
    pub protocol_fee: u64,
    pub net_rewards: u64,
    pub new_exchange_rate: u64,
    pub epoch: u64,
}

