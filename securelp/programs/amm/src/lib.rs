use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, MintTo, Burn, Transfer, Token, TokenAccount};
use anchor_spl::metadata::{
    create_metadata_accounts_v3,
    CreateMetadataAccountsV3,
    Metadata,
    mpl_token_metadata::types::DataV2,
};

pub mod errors;
pub mod state;

use errors::AmmError;
use state::*;

declare_id!("AcaXW2nDrvkpmuZnuiARDRJzmmfT1AZwLm4SMeYwnXKS");

#[program]
pub mod amm {
    use super::*;

    /// Initialize a new AMM pool for token pair
    pub fn initialize_pool(
        ctx: Context<InitializePool>,
        fee_bps: u16,
    ) -> Result<()> {
        require!(fee_bps <= 1000, AmmError::InvalidFee); // Max 10%

        let pool = &mut ctx.accounts.pool;

        pool.authority = ctx.accounts.authority.key();
        pool.token_a_mint = ctx.accounts.token_a_mint.key();
        pool.token_b_mint = ctx.accounts.token_b_mint.key();
        pool.token_a_vault = ctx.accounts.token_a_vault.key();
        pool.token_b_vault = ctx.accounts.token_b_vault.key();
        pool.lp_mint = ctx.accounts.lp_mint.key();
        pool.reserve_a = 0;
        pool.reserve_b = 0;
        pool.total_lp_supply = 0;
        pool.fee_bps = fee_bps;
        pool.paused = false;
        pool.cumulative_fee_a = 0;
        pool.cumulative_fee_b = 0;
        pool.bump = ctx.bumps.pool;
        pool.authority_bump = ctx.bumps.pool_authority;

        msg!("AMM Pool initialized");
        msg!("Token A: {}", pool.token_a_mint);
        msg!("Token B: {}", pool.token_b_mint);
        msg!("Fee: {} bps", fee_bps);

        emit!(PoolInitialized {
            pool: pool.key(),
            token_a_mint: pool.token_a_mint,
            token_b_mint: pool.token_b_mint,
            fee_bps,
        });

        Ok(())
    }

    /// Add liquidity to the pool
    pub fn add_liquidity(
        ctx: Context<AddLiquidity>,
        amount_a: u64,
        amount_b: u64,
        min_lp_out: u64,
    ) -> Result<()> {
        let pool = &mut ctx.accounts.pool;
        
        require!(!pool.paused, AmmError::PoolPaused);
        require!(amount_a > 0 && amount_b > 0, AmmError::InsufficientInput);

        // Calculate LP tokens to mint
        let lp_to_mint = pool.calculate_lp_tokens_for_liquidity(amount_a, amount_b)?;
        require!(lp_to_mint >= min_lp_out, AmmError::SlippageExceeded);

        // Transfer token A from user to vault
        let cpi_accounts_a = Transfer {
            from: ctx.accounts.user_token_a.to_account_info(),
            to: ctx.accounts.token_a_vault.to_account_info(),
            authority: ctx.accounts.user.to_account_info(),
        };
        token::transfer(
            CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts_a),
            amount_a,
        )?;

        // Transfer token B from user to vault
        let cpi_accounts_b = Transfer {
            from: ctx.accounts.user_token_b.to_account_info(),
            to: ctx.accounts.token_b_vault.to_account_info(),
            authority: ctx.accounts.user.to_account_info(),
        };
        token::transfer(
            CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts_b),
            amount_b,
        )?;

        // Mint LP tokens to user
        let pool_key = pool.key();
        let seeds = &[
            AMM_AUTHORITY_SEED,
            pool_key.as_ref(),
            &[pool.authority_bump],
        ];
        let signer_seeds = &[&seeds[..]];

        let cpi_accounts_mint = MintTo {
            mint: ctx.accounts.lp_mint.to_account_info(),
            to: ctx.accounts.user_lp_account.to_account_info(),
            authority: ctx.accounts.pool_authority.to_account_info(),
        };
        token::mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                cpi_accounts_mint,
                signer_seeds,
            ),
            lp_to_mint,
        )?;

        // If first deposit, lock MINIMUM_LIQUIDITY
        if pool.total_lp_supply == 0 {
            pool.total_lp_supply = MINIMUM_LIQUIDITY;
        }

        // Update pool state
        pool.reserve_a = pool.reserve_a.checked_add(amount_a)
            .ok_or(AmmError::MathOverflow)?;
        pool.reserve_b = pool.reserve_b.checked_add(amount_b)
            .ok_or(AmmError::MathOverflow)?;
        pool.total_lp_supply = pool.total_lp_supply.checked_add(lp_to_mint)
            .ok_or(AmmError::MathOverflow)?;

        msg!(
            "Added liquidity: {} A, {} B, minted {} LP",
            amount_a,
            amount_b,
            lp_to_mint
        );

        emit!(LiquidityAdded {
            user: ctx.accounts.user.key(),
            amount_a,
            amount_b,
            lp_minted: lp_to_mint,
            reserve_a: pool.reserve_a,
            reserve_b: pool.reserve_b,
        });

        Ok(())
    }

    /// Remove liquidity from the pool
    pub fn remove_liquidity(
        ctx: Context<RemoveLiquidity>,
        lp_amount: u64,
        min_a_out: u64,
        min_b_out: u64,
    ) -> Result<()> {
        let pool = &mut ctx.accounts.pool;
        
        require!(!pool.paused, AmmError::PoolPaused);
        require!(lp_amount > 0, AmmError::InvalidLpAmount);

        // Calculate tokens to return
        let (amount_a, amount_b) = pool.calculate_tokens_for_lp(lp_amount)?;
        
        require!(amount_a >= min_a_out, AmmError::SlippageExceeded);
        require!(amount_b >= min_b_out, AmmError::SlippageExceeded);
        require!(amount_a <= pool.reserve_a, AmmError::InsufficientLiquidity);
        require!(amount_b <= pool.reserve_b, AmmError::InsufficientLiquidity);

        // Burn LP tokens from user
        let cpi_accounts_burn = Burn {
            mint: ctx.accounts.lp_mint.to_account_info(),
            from: ctx.accounts.user_lp_account.to_account_info(),
            authority: ctx.accounts.user.to_account_info(),
        };
        token::burn(
            CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts_burn),
            lp_amount,
        )?;

        // Transfer tokens from vaults to user
        let pool_key = pool.key();
        let seeds = &[
            AMM_AUTHORITY_SEED,
            pool_key.as_ref(),
            &[pool.authority_bump],
        ];
        let signer_seeds = &[&seeds[..]];

        // Transfer token A
        let cpi_accounts_a = Transfer {
            from: ctx.accounts.token_a_vault.to_account_info(),
            to: ctx.accounts.user_token_a.to_account_info(),
            authority: ctx.accounts.pool_authority.to_account_info(),
        };
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                cpi_accounts_a,
                signer_seeds,
            ),
            amount_a,
        )?;

        // Transfer token B
        let cpi_accounts_b = Transfer {
            from: ctx.accounts.token_b_vault.to_account_info(),
            to: ctx.accounts.user_token_b.to_account_info(),
            authority: ctx.accounts.pool_authority.to_account_info(),
        };
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                cpi_accounts_b,
                signer_seeds,
            ),
            amount_b,
        )?;

        // Update pool state
        pool.reserve_a = pool.reserve_a.checked_sub(amount_a)
            .ok_or(AmmError::MathOverflow)?;
        pool.reserve_b = pool.reserve_b.checked_sub(amount_b)
            .ok_or(AmmError::MathOverflow)?;
        pool.total_lp_supply = pool.total_lp_supply.checked_sub(lp_amount)
            .ok_or(AmmError::MathOverflow)?;

        msg!(
            "Removed liquidity: burned {} LP, returned {} A, {} B",
            lp_amount,
            amount_a,
            amount_b
        );

        emit!(LiquidityRemoved {
            user: ctx.accounts.user.key(),
            lp_burned: lp_amount,
            amount_a,
            amount_b,
            reserve_a: pool.reserve_a,
            reserve_b: pool.reserve_b,
        });

        Ok(())
    }

    /// Swap tokens using constant product formula
    pub fn swap(
        ctx: Context<Swap>,
        amount_in: u64,
        min_amount_out: u64,
        a_to_b: bool, // true = swap A for B, false = swap B for A
    ) -> Result<()> {
        let pool = &mut ctx.accounts.pool;
        
        require!(!pool.paused, AmmError::PoolPaused);
        require!(amount_in > 0, AmmError::InsufficientInput);

        // Calculate output amount
        let (amount_out, fee_amount) = pool.calculate_swap_output(amount_in, a_to_b)?;
        
        require!(amount_out >= min_amount_out, AmmError::SlippageExceeded);
        require!(amount_out > 0, AmmError::InsufficientOutput);

        // Verify sufficient liquidity
        if a_to_b {
            require!(amount_out <= pool.reserve_b, AmmError::InsufficientLiquidity);
        } else {
            require!(amount_out <= pool.reserve_a, AmmError::InsufficientLiquidity);
        }

        let pool_key = pool.key();
        let seeds = &[
            AMM_AUTHORITY_SEED,
            pool_key.as_ref(),
            &[pool.authority_bump],
        ];
        let signer_seeds = &[&seeds[..]];

        if a_to_b {
            // Transfer token A from user to vault
            let cpi_accounts_in = Transfer {
                from: ctx.accounts.user_token_in.to_account_info(),
                to: ctx.accounts.token_a_vault.to_account_info(),
                authority: ctx.accounts.user.to_account_info(),
            };
            token::transfer(
                CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts_in),
                amount_in,
            )?;

            // Transfer token B from vault to user
            let cpi_accounts_out = Transfer {
                from: ctx.accounts.token_b_vault.to_account_info(),
                to: ctx.accounts.user_token_out.to_account_info(),
                authority: ctx.accounts.pool_authority.to_account_info(),
            };
            token::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    cpi_accounts_out,
                    signer_seeds,
                ),
                amount_out,
            )?;

            // Update reserves
            pool.reserve_a = pool.reserve_a.checked_add(amount_in)
                .ok_or(AmmError::MathOverflow)?;
            pool.reserve_b = pool.reserve_b.checked_sub(amount_out)
                .ok_or(AmmError::MathOverflow)?;
            pool.cumulative_fee_a = pool.cumulative_fee_a.checked_add(fee_amount)
                .ok_or(AmmError::MathOverflow)?;
        } else {
            // Transfer token B from user to vault
            let cpi_accounts_in = Transfer {
                from: ctx.accounts.user_token_in.to_account_info(),
                to: ctx.accounts.token_b_vault.to_account_info(),
                authority: ctx.accounts.user.to_account_info(),
            };
            token::transfer(
                CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts_in),
                amount_in,
            )?;

            // Transfer token A from vault to user
            let cpi_accounts_out = Transfer {
                from: ctx.accounts.token_a_vault.to_account_info(),
                to: ctx.accounts.user_token_out.to_account_info(),
                authority: ctx.accounts.pool_authority.to_account_info(),
            };
            token::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    cpi_accounts_out,
                    signer_seeds,
                ),
                amount_out,
            )?;

            // Update reserves
            pool.reserve_b = pool.reserve_b.checked_add(amount_in)
                .ok_or(AmmError::MathOverflow)?;
            pool.reserve_a = pool.reserve_a.checked_sub(amount_out)
                .ok_or(AmmError::MathOverflow)?;
            pool.cumulative_fee_b = pool.cumulative_fee_b.checked_add(fee_amount)
                .ok_or(AmmError::MathOverflow)?;
        }

        msg!(
            "Swapped {} {} for {} {}",
            amount_in,
            if a_to_b { "A" } else { "B" },
            amount_out,
            if a_to_b { "B" } else { "A" }
        );

        emit!(Swapped {
            user: ctx.accounts.user.key(),
            amount_in,
            amount_out,
            fee: fee_amount,
            a_to_b,
            reserve_a: pool.reserve_a,
            reserve_b: pool.reserve_b,
        });

        Ok(())
    }

    /// Admin: Pause/unpause the pool
    pub fn set_paused(ctx: Context<AdminAction>, paused: bool) -> Result<()> {
        let pool = &mut ctx.accounts.pool;
        pool.paused = paused;
        
        msg!("Pool paused: {}", paused);
        Ok(())
    }

    /// Admin: Update fee
    pub fn update_fee(ctx: Context<AdminAction>, new_fee_bps: u16) -> Result<()> {
        require!(new_fee_bps <= 1000, AmmError::InvalidFee); // Max 10%
        
        let pool = &mut ctx.accounts.pool;
        pool.fee_bps = new_fee_bps;
        
        msg!("Fee updated to {} bps", new_fee_bps);
        Ok(())
    }

    /// Admin: Create LP token metadata
    pub fn create_lp_metadata(
        ctx: Context<CreateLpMetadata>,
        name: String,
        symbol: String,
        uri: String,
    ) -> Result<()> {
        let pool = &ctx.accounts.pool;

        // Create signer seeds for pool authority
        let pool_key = pool.key();
        let seeds = &[
            AMM_AUTHORITY_SEED,
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
            mint: ctx.accounts.lp_mint.to_account_info(),
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

        msg!("LP token metadata created successfully!");
        Ok(())
    }
}

// ============================================================================
// Account Contexts
// ============================================================================

#[derive(Accounts)]
pub struct InitializePool<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    /// Token A mint (e.g., wSOL)
    pub token_a_mint: Account<'info, Mint>,

    /// Token B mint (e.g., slpSOL)
    pub token_b_mint: Account<'info, Mint>,

    #[account(
        init,
        payer = authority,
        space = AmmPool::LEN,
        seeds = [AMM_POOL_SEED, token_a_mint.key().as_ref(), token_b_mint.key().as_ref()],
        bump
    )]
    pub pool: Account<'info, AmmPool>,

    /// CHECK: PDA used as pool authority for signing
    #[account(
        seeds = [AMM_AUTHORITY_SEED, pool.key().as_ref()],
        bump
    )]
    pub pool_authority: UncheckedAccount<'info>,

    #[account(
        init,
        payer = authority,
        token::mint = token_a_mint,
        token::authority = pool_authority,
        seeds = [VAULT_A_SEED, pool.key().as_ref()],
        bump
    )]
    pub token_a_vault: Account<'info, TokenAccount>,

    #[account(
        init,
        payer = authority,
        token::mint = token_b_mint,
        token::authority = pool_authority,
        seeds = [VAULT_B_SEED, pool.key().as_ref()],
        bump
    )]
    pub token_b_vault: Account<'info, TokenAccount>,

    #[account(
        init,
        payer = authority,
        mint::decimals = 9,
        mint::authority = pool_authority,
        mint::freeze_authority = pool_authority,
    )]
    pub lp_mint: Account<'info, Mint>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct AddLiquidity<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        mut,
        seeds = [AMM_POOL_SEED, pool.token_a_mint.as_ref(), pool.token_b_mint.as_ref()],
        bump = pool.bump
    )]
    pub pool: Account<'info, AmmPool>,

    /// CHECK: PDA authority
    #[account(
        seeds = [AMM_AUTHORITY_SEED, pool.key().as_ref()],
        bump = pool.authority_bump
    )]
    pub pool_authority: UncheckedAccount<'info>,

    #[account(
        mut,
        constraint = token_a_vault.key() == pool.token_a_vault @ AmmError::InvalidMint
    )]
    pub token_a_vault: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = token_b_vault.key() == pool.token_b_vault @ AmmError::InvalidMint
    )]
    pub token_b_vault: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = lp_mint.key() == pool.lp_mint @ AmmError::InvalidMint
    )]
    pub lp_mint: Account<'info, Mint>,

    #[account(
        mut,
        constraint = user_token_a.mint == pool.token_a_mint,
        constraint = user_token_a.owner == user.key()
    )]
    pub user_token_a: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = user_token_b.mint == pool.token_b_mint,
        constraint = user_token_b.owner == user.key()
    )]
    pub user_token_b: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = user_lp_account.mint == lp_mint.key(),
        constraint = user_lp_account.owner == user.key()
    )]
    pub user_lp_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct RemoveLiquidity<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        mut,
        seeds = [AMM_POOL_SEED, pool.token_a_mint.as_ref(), pool.token_b_mint.as_ref()],
        bump = pool.bump
    )]
    pub pool: Account<'info, AmmPool>,

    /// CHECK: PDA authority
    #[account(
        seeds = [AMM_AUTHORITY_SEED, pool.key().as_ref()],
        bump = pool.authority_bump
    )]
    pub pool_authority: UncheckedAccount<'info>,

    #[account(
        mut,
        constraint = token_a_vault.key() == pool.token_a_vault @ AmmError::InvalidMint
    )]
    pub token_a_vault: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = token_b_vault.key() == pool.token_b_vault @ AmmError::InvalidMint
    )]
    pub token_b_vault: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = lp_mint.key() == pool.lp_mint @ AmmError::InvalidMint
    )]
    pub lp_mint: Account<'info, Mint>,

    #[account(
        mut,
        constraint = user_token_a.mint == pool.token_a_mint,
        constraint = user_token_a.owner == user.key()
    )]
    pub user_token_a: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = user_token_b.mint == pool.token_b_mint,
        constraint = user_token_b.owner == user.key()
    )]
    pub user_token_b: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = user_lp_account.mint == lp_mint.key(),
        constraint = user_lp_account.owner == user.key()
    )]
    pub user_lp_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct Swap<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        mut,
        seeds = [AMM_POOL_SEED, pool.token_a_mint.as_ref(), pool.token_b_mint.as_ref()],
        bump = pool.bump
    )]
    pub pool: Account<'info, AmmPool>,

    /// CHECK: PDA authority
    #[account(
        seeds = [AMM_AUTHORITY_SEED, pool.key().as_ref()],
        bump = pool.authority_bump
    )]
    pub pool_authority: UncheckedAccount<'info>,

    #[account(
        mut,
        constraint = token_a_vault.key() == pool.token_a_vault @ AmmError::InvalidMint
    )]
    pub token_a_vault: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = token_b_vault.key() == pool.token_b_vault @ AmmError::InvalidMint
    )]
    pub token_b_vault: Account<'info, TokenAccount>,

    /// User's input token account (A if a_to_b, B otherwise)
    #[account(mut)]
    pub user_token_in: Account<'info, TokenAccount>,

    /// User's output token account (B if a_to_b, A otherwise)
    #[account(mut)]
    pub user_token_out: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct AdminAction<'info> {
    #[account(
        constraint = authority.key() == pool.authority @ AmmError::InvalidAuthority
    )]
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [AMM_POOL_SEED, pool.token_a_mint.as_ref(), pool.token_b_mint.as_ref()],
        bump = pool.bump
    )]
    pub pool: Account<'info, AmmPool>,
}

#[derive(Accounts)]
pub struct CreateLpMetadata<'info> {
    #[account(
        mut,
        constraint = admin.key() == pool.authority @ AmmError::InvalidAuthority
    )]
    pub admin: Signer<'info>,

    #[account(
        seeds = [AMM_POOL_SEED, pool.token_a_mint.as_ref(), pool.token_b_mint.as_ref()],
        bump = pool.bump
    )]
    pub pool: Account<'info, AmmPool>,

    /// CHECK: Pool authority PDA - mint authority for lp_mint
    #[account(
        seeds = [AMM_AUTHORITY_SEED, pool.key().as_ref()],
        bump = pool.authority_bump
    )]
    pub pool_authority: UncheckedAccount<'info>,

    #[account(
        constraint = lp_mint.key() == pool.lp_mint @ AmmError::InvalidMint
    )]
    pub lp_mint: Account<'info, Mint>,

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
    pub pool: Pubkey,
    pub token_a_mint: Pubkey,
    pub token_b_mint: Pubkey,
    pub fee_bps: u16,
}

#[event]
pub struct LiquidityAdded {
    pub user: Pubkey,
    pub amount_a: u64,
    pub amount_b: u64,
    pub lp_minted: u64,
    pub reserve_a: u64,
    pub reserve_b: u64,
}

#[event]
pub struct LiquidityRemoved {
    pub user: Pubkey,
    pub lp_burned: u64,
    pub amount_a: u64,
    pub amount_b: u64,
    pub reserve_a: u64,
    pub reserve_b: u64,
}

#[event]
pub struct Swapped {
    pub user: Pubkey,
    pub amount_in: u64,
    pub amount_out: u64,
    pub fee: u64,
    pub a_to_b: bool,
    pub reserve_a: u64,
    pub reserve_b: u64,
}

