use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    instruction::{AccountMeta, Instruction},
    program::{invoke, invoke_signed},
};
use ephemeral_rollups_sdk::anchor::{commit, delegate, ephemeral};
use ephemeral_rollups_sdk::cpi::DelegateConfig;
use ephemeral_rollups_sdk::ephem::{FoldableIntentBuilder, MagicIntentBundleBuilder};

declare_id!("4gFd61LGkcfMzK6i7dB96EfxHPgWRZRw8Q3q1rWCiqu7");

pub const CONFIG_SEED: &[u8] = b"rwa_config";
pub const INTENT_SEED: &[u8] = b"rwa_intent";
pub const MARKET_SEED: &[u8] = b"rwa_market";
pub const VAULT_AUTHORITY_SEED: &[u8] = b"rwa_vault_authority";
pub const MAX_QUOTE_TTL_SECONDS: i64 = 15 * 60;
pub const MIN_QUOTE_TTL_SECONDS: i64 = 5;
pub const TOKEN_PROGRAM_ID: Pubkey = pubkey!("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
pub const SPL_TOKEN_TRANSFER_INSTRUCTION: u8 = 3;

#[ephemeral]
#[program]
pub mod offpay_rwa_delegate {
    use super::*;

    pub fn initialize_config(
        ctx: Context<InitializeConfig>,
        emergency_admin: Pubkey,
        executor: Pubkey,
        settlement_mint: Pubkey,
        max_quote_ttl_seconds: i64,
    ) -> Result<()> {
        require!(
            max_quote_ttl_seconds >= MIN_QUOTE_TTL_SECONDS
                && max_quote_ttl_seconds <= MAX_QUOTE_TTL_SECONDS,
            RwaDelegateError::InvalidQuoteTtl
        );

        let clock = Clock::get()?;
        let config = &mut ctx.accounts.config;
        config.bump = ctx.bumps.config;
        config.admin = ctx.accounts.admin.key();
        config.emergency_admin = emergency_admin;
        config.executor = executor;
        config.settlement_mint = settlement_mint;
        config.paused = false;
        config.max_quote_ttl_seconds = max_quote_ttl_seconds;
        config.created_at = clock.unix_timestamp;
        config.updated_at = clock.unix_timestamp;
        Ok(())
    }

    pub fn set_paused(ctx: Context<SetPaused>, paused: bool) -> Result<()> {
        let authority = ctx.accounts.authority.key();
        require!(
            authority == ctx.accounts.config.admin
                || authority == ctx.accounts.config.emergency_admin,
            RwaDelegateError::Unauthorized
        );

        let config = &mut ctx.accounts.config;
        config.paused = paused;
        config.updated_at = Clock::get()?.unix_timestamp;
        Ok(())
    }

    pub fn update_executor(ctx: Context<UpdateExecutor>, executor: Pubkey) -> Result<()> {
        let config = &mut ctx.accounts.config;
        config.executor = executor;
        config.updated_at = Clock::get()?.unix_timestamp;
        Ok(())
    }

    pub fn initialize_market(ctx: Context<InitializeMarket>, price_ttl_seconds: i64) -> Result<()> {
        require!(price_ttl_seconds > 0, RwaDelegateError::InvalidPriceTtl);
        require!(
            ctx.accounts.token_program.key() == TOKEN_PROGRAM_ID,
            RwaDelegateError::InvalidTokenProgram
        );
        require!(
            ctx.accounts.asset_mint.to_account_info().owner == &TOKEN_PROGRAM_ID,
            RwaDelegateError::InvalidTokenProgram
        );
        require!(
            ctx.accounts.settlement_mint.to_account_info().owner == &TOKEN_PROGRAM_ID,
            RwaDelegateError::InvalidTokenProgram
        );
        require!(
            ctx.accounts.asset_mint.key() != ctx.accounts.settlement_mint.key(),
            RwaDelegateError::InvalidAssetMint
        );
        require!(
            ctx.accounts.settlement_mint.key() == ctx.accounts.config.settlement_mint,
            RwaDelegateError::InvalidSettlementMint
        );
        require_token_account(
            &ctx.accounts.asset_vault,
            &ctx.accounts.token_program,
            &ctx.accounts.asset_mint.key(),
            &ctx.accounts.vault_authority.key(),
        )?;
        require_token_account(
            &ctx.accounts.settlement_vault,
            &ctx.accounts.token_program,
            &ctx.accounts.settlement_mint.key(),
            &ctx.accounts.vault_authority.key(),
        )?;

        let clock = Clock::get()?;
        let market = &mut ctx.accounts.market;
        market.bump = ctx.bumps.market;
        market.asset_mint = ctx.accounts.asset_mint.key();
        market.settlement_mint = ctx.accounts.settlement_mint.key();
        market.asset_vault = ctx.accounts.asset_vault.key();
        market.settlement_vault = ctx.accounts.settlement_vault.key();
        market.vault_authority_bump = ctx.bumps.vault_authority;
        market.price_ttl_seconds = price_ttl_seconds;
        market.paused = false;
        market.created_at = clock.unix_timestamp;
        market.updated_at = clock.unix_timestamp;
        Ok(())
    }

    pub fn set_market_paused(ctx: Context<SetMarketPaused>, paused: bool) -> Result<()> {
        let market = &mut ctx.accounts.market;
        market.paused = paused;
        market.updated_at = Clock::get()?.unix_timestamp;
        Ok(())
    }

    pub fn create_intent(ctx: Context<CreateIntent>, args: CreateIntentArgs) -> Result<()> {
        let clock = Clock::get()?;
        let config = &ctx.accounts.config;
        require!(!config.paused, RwaDelegateError::ProtocolPaused);
        require!(
            args.settlement_mint == config.settlement_mint,
            RwaDelegateError::InvalidSettlementMint
        );
        require!(
            args.asset_mint != args.settlement_mint,
            RwaDelegateError::InvalidAssetMint
        );
        require!(args.nonce != [0; 16], RwaDelegateError::InvalidNonce);
        require!(args.quote_hash != [0; 32], RwaDelegateError::InvalidQuoteHash);
        require!(
            args.quote_expires_at > clock.unix_timestamp,
            RwaDelegateError::QuoteExpired
        );
        let quote_ttl_seconds = args
            .quote_expires_at
            .checked_sub(clock.unix_timestamp)
            .ok_or_else(|| error!(RwaDelegateError::MathOverflow))?;
        require!(
            quote_ttl_seconds <= config.max_quote_ttl_seconds,
            RwaDelegateError::InvalidQuoteTtl
        );

        match args.side {
            TradeSide::Buy => {
                require!(args.cash_atoms > 0, RwaDelegateError::InvalidAmount);
            }
            TradeSide::Sell => {
                require!(args.quantity_atoms > 0, RwaDelegateError::InvalidAmount);
            }
        }

        let intent = &mut ctx.accounts.intent;
        intent.bump = ctx.bumps.intent;
        intent.owner = ctx.accounts.owner.key();
        intent.asset_mint = args.asset_mint;
        intent.settlement_mint = args.settlement_mint;
        intent.nonce = args.nonce;
        intent.side = args.side;
        intent.quantity_atoms = args.quantity_atoms;
        intent.cash_atoms = args.cash_atoms;
        intent.quote_hash = args.quote_hash;
        intent.quote_expires_at = args.quote_expires_at;
        intent.created_at = clock.unix_timestamp;
        intent.approved_at = 0;
        intent.submitted_at = 0;
        intent.settled_at = 0;
        intent.cancelled_at = 0;
        intent.last_updated_slot = clock.slot;
        intent.settlement_signature = [0; 64];
        intent.status = IntentStatus::Open;
        Ok(())
    }

    pub fn approve_intent(
        ctx: Context<MutateIntent>,
        _owner_key: Pubkey,
        _nonce: [u8; 16],
    ) -> Result<()> {
        approve_intent_state(&ctx.accounts.config, &mut ctx.accounts.intent)
    }

    pub fn approve_and_commit(
        ctx: Context<CommitIntent>,
        _owner_key: Pubkey,
        _nonce: [u8; 16],
    ) -> Result<()> {
        approve_intent_state(&ctx.accounts.config, &mut ctx.accounts.intent)?;
        ctx.accounts.intent.exit(&crate::ID)?;
        commit_intent_accounts(&ctx)
    }

    pub fn submit_settlement(
        ctx: Context<ExecutorIntent>,
        _owner_key: Pubkey,
        _nonce: [u8; 16],
        settlement_signature: [u8; 64],
    ) -> Result<()> {
        let clock = Clock::get()?;
        let intent = &mut ctx.accounts.intent;
        require!(
            intent.status == IntentStatus::Approved,
            RwaDelegateError::InvalidIntentStatus
        );
        require!(
            settlement_signature != [0; 64],
            RwaDelegateError::InvalidSettlementSignature
        );

        intent.status = IntentStatus::Submitted;
        intent.submitted_at = clock.unix_timestamp;
        intent.last_updated_slot = clock.slot;
        intent.settlement_signature = settlement_signature;
        Ok(())
    }

    pub fn settle_intent(
        ctx: Context<ExecutorIntent>,
        _owner_key: Pubkey,
        _nonce: [u8; 16],
        settlement_signature: [u8; 64],
    ) -> Result<()> {
        let clock = Clock::get()?;
        let intent = &mut ctx.accounts.intent;
        require!(
            intent.status == IntentStatus::Approved || intent.status == IntentStatus::Submitted,
            RwaDelegateError::InvalidIntentStatus
        );
        require!(
            settlement_signature != [0; 64],
            RwaDelegateError::InvalidSettlementSignature
        );

        intent.status = IntentStatus::Settled;
        intent.settled_at = clock.unix_timestamp;
        intent.last_updated_slot = clock.slot;
        intent.settlement_signature = settlement_signature;
        Ok(())
    }

    pub fn settle_sandbox(
        ctx: Context<SettleSandbox>,
        _owner_key: Pubkey,
        _nonce: [u8; 16],
    ) -> Result<()> {
        let clock = Clock::get()?;
        require!(!ctx.accounts.config.paused, RwaDelegateError::ProtocolPaused);
        require!(!ctx.accounts.market.paused, RwaDelegateError::MarketPaused);
        require!(
            ctx.accounts.intent.status == IntentStatus::Open
                || ctx.accounts.intent.status == IntentStatus::Approved,
            RwaDelegateError::InvalidIntentStatus
        );
        require!(
            ctx.accounts.intent.quote_expires_at > clock.unix_timestamp,
            RwaDelegateError::QuoteExpired
        );
        require!(
            ctx.accounts.intent.asset_mint == ctx.accounts.market.asset_mint,
            RwaDelegateError::InvalidAssetMint
        );
        require!(
            ctx.accounts.intent.settlement_mint == ctx.accounts.market.settlement_mint,
            RwaDelegateError::InvalidSettlementMint
        );
        require!(
            ctx.accounts.market.asset_vault == ctx.accounts.asset_vault.key(),
            RwaDelegateError::InvalidVault
        );
        require!(
            ctx.accounts.market.settlement_vault == ctx.accounts.settlement_vault.key(),
            RwaDelegateError::InvalidVault
        );
        require_token_account(
            &ctx.accounts.user_asset_account,
            &ctx.accounts.token_program,
            &ctx.accounts.market.asset_mint,
            &ctx.accounts.owner.key(),
        )?;
        require_token_account(
            &ctx.accounts.user_settlement_account,
            &ctx.accounts.token_program,
            &ctx.accounts.market.settlement_mint,
            &ctx.accounts.owner.key(),
        )?;
        require_token_account(
            &ctx.accounts.asset_vault,
            &ctx.accounts.token_program,
            &ctx.accounts.market.asset_mint,
            &ctx.accounts.vault_authority.key(),
        )?;
        require_token_account(
            &ctx.accounts.settlement_vault,
            &ctx.accounts.token_program,
            &ctx.accounts.market.settlement_mint,
            &ctx.accounts.vault_authority.key(),
        )?;
        require!(
            ctx.accounts.market.price_ttl_seconds > 0,
            RwaDelegateError::InvalidPriceTtl
        );
        let quote_age_seconds = ctx
            .accounts
            .intent
            .quote_expires_at
            .checked_sub(clock.unix_timestamp)
            .ok_or_else(|| error!(RwaDelegateError::MathOverflow))?;
        require!(
            quote_age_seconds <= ctx.accounts.config.max_quote_ttl_seconds,
            RwaDelegateError::InvalidQuoteTtl
        );

        match ctx.accounts.intent.side {
            TradeSide::Buy => {
                require!(ctx.accounts.intent.cash_atoms > 0, RwaDelegateError::InvalidAmount);
                require!(
                    ctx.accounts.intent.quantity_atoms > 0,
                    RwaDelegateError::InvalidAmount
                );
                transfer_from_user(
                    &ctx.accounts.token_program,
                    &ctx.accounts.user_settlement_account,
                    &ctx.accounts.settlement_vault,
                    &ctx.accounts.owner,
                    ctx.accounts.intent.cash_atoms,
                )?;
                transfer_from_vault(
                    &ctx.accounts.token_program,
                    &ctx.accounts.asset_vault,
                    &ctx.accounts.user_asset_account,
                    &ctx.accounts.vault_authority,
                    ctx.accounts.market.vault_authority_bump,
                    ctx.accounts.intent.quantity_atoms,
                )?;
            }
            TradeSide::Sell => {
                require!(
                    ctx.accounts.intent.quantity_atoms > 0,
                    RwaDelegateError::InvalidAmount
                );
                require!(ctx.accounts.intent.cash_atoms > 0, RwaDelegateError::InvalidAmount);
                transfer_from_user(
                    &ctx.accounts.token_program,
                    &ctx.accounts.user_asset_account,
                    &ctx.accounts.asset_vault,
                    &ctx.accounts.owner,
                    ctx.accounts.intent.quantity_atoms,
                )?;
                transfer_from_vault(
                    &ctx.accounts.token_program,
                    &ctx.accounts.settlement_vault,
                    &ctx.accounts.user_settlement_account,
                    &ctx.accounts.vault_authority,
                    ctx.accounts.market.vault_authority_bump,
                    ctx.accounts.intent.cash_atoms,
                )?;
            }
        }

        let intent = &mut ctx.accounts.intent;
        intent.status = IntentStatus::Settled;
        intent.settled_at = clock.unix_timestamp;
        intent.last_updated_slot = clock.slot;
        Ok(())
    }

    pub fn cancel_intent(
        ctx: Context<CancelIntent>,
        _owner_key: Pubkey,
        _nonce: [u8; 16],
    ) -> Result<()> {
        let authority = ctx.accounts.authority.key();
        require!(
            authority == ctx.accounts.intent.owner || authority == ctx.accounts.config.admin,
            RwaDelegateError::Unauthorized
        );
        require!(
            ctx.accounts.intent.status == IntentStatus::Open
                || ctx.accounts.intent.status == IntentStatus::Approved,
            RwaDelegateError::InvalidIntentStatus
        );

        let clock = Clock::get()?;
        let intent = &mut ctx.accounts.intent;
        intent.status = IntentStatus::Cancelled;
        intent.cancelled_at = clock.unix_timestamp;
        intent.last_updated_slot = clock.slot;
        Ok(())
    }

    pub fn expire_intent(
        ctx: Context<ExpireIntent>,
        _owner_key: Pubkey,
        _nonce: [u8; 16],
    ) -> Result<()> {
        let clock = Clock::get()?;
        let intent = &mut ctx.accounts.intent;
        require!(
            intent.status == IntentStatus::Open || intent.status == IntentStatus::Approved,
            RwaDelegateError::InvalidIntentStatus
        );
        require!(
            intent.quote_expires_at <= clock.unix_timestamp,
            RwaDelegateError::QuoteStillValid
        );

        intent.status = IntentStatus::Expired;
        intent.last_updated_slot = clock.slot;
        Ok(())
    }

    pub fn delegate_intent(
        ctx: Context<DelegateIntent>,
        owner_key: Pubkey,
        nonce: [u8; 16],
    ) -> Result<()> {
        let seeds: &[&[u8]] = &[INTENT_SEED, owner_key.as_ref(), nonce.as_ref()];
        ctx.accounts.delegate_pda(
            &ctx.accounts.payer,
            seeds,
            DelegateConfig {
                validator: ctx.remaining_accounts.first().map(|acc| acc.key()),
                ..Default::default()
            },
        )?;
        Ok(())
    }

    pub fn commit_intent(
        ctx: Context<CommitIntent>,
        _owner_key: Pubkey,
        _nonce: [u8; 16],
    ) -> Result<()> {
        commit_intent_accounts(&ctx)
    }

    pub fn undelegate_intent(
        ctx: Context<CommitIntent>,
        _owner_key: Pubkey,
        _nonce: [u8; 16],
    ) -> Result<()> {
        MagicIntentBundleBuilder::new(
            ctx.accounts.payer.to_account_info(),
            ctx.accounts.magic_context.to_account_info(),
            ctx.accounts.magic_program.to_account_info(),
        )
        .commit_and_undelegate(&[ctx.accounts.intent.to_account_info()])
        .build_and_invoke()?;
        Ok(())
    }
}

fn transfer_from_user<'info>(
    token_program: &UncheckedAccount<'info>,
    from: &UncheckedAccount<'info>,
    to: &UncheckedAccount<'info>,
    authority: &Signer<'info>,
    amount: u64,
) -> Result<()> {
    require!(
        token_program.key() == TOKEN_PROGRAM_ID,
        RwaDelegateError::InvalidTokenProgram
    );
    let mut data = Vec::with_capacity(9);
    data.push(SPL_TOKEN_TRANSFER_INSTRUCTION);
    data.extend_from_slice(&amount.to_le_bytes());
    let ix = Instruction {
        program_id: TOKEN_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new(from.key(), false),
            AccountMeta::new(to.key(), false),
            AccountMeta::new_readonly(authority.key(), true),
        ],
        data,
    };
    invoke(
        &ix,
        &[
            from.to_account_info(),
            to.to_account_info(),
            authority.to_account_info(),
            token_program.to_account_info(),
        ],
    )?;
    Ok(())
}

fn transfer_from_vault<'info>(
    token_program: &UncheckedAccount<'info>,
    from: &UncheckedAccount<'info>,
    to: &UncheckedAccount<'info>,
    authority: &UncheckedAccount<'info>,
    bump: u8,
    amount: u64,
) -> Result<()> {
    require!(
        token_program.key() == TOKEN_PROGRAM_ID,
        RwaDelegateError::InvalidTokenProgram
    );
    let seeds: &[&[u8]] = &[VAULT_AUTHORITY_SEED, &[bump]];
    let signer_seeds: &[&[&[u8]]] = &[seeds];
    let mut data = Vec::with_capacity(9);
    data.push(SPL_TOKEN_TRANSFER_INSTRUCTION);
    data.extend_from_slice(&amount.to_le_bytes());
    let ix = Instruction {
        program_id: TOKEN_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new(from.key(), false),
            AccountMeta::new(to.key(), false),
            AccountMeta::new_readonly(authority.key(), true),
        ],
        data,
    };
    invoke_signed(
        &ix,
        &[
            from.to_account_info(),
            to.to_account_info(),
            authority.to_account_info(),
            token_program.to_account_info(),
        ],
        signer_seeds,
    )?;
    Ok(())
}

fn require_token_account<'info>(
    account: &UncheckedAccount<'info>,
    token_program: &UncheckedAccount<'info>,
    expected_mint: &Pubkey,
    expected_owner: &Pubkey,
) -> Result<()> {
    require!(
        token_program.key() == TOKEN_PROGRAM_ID,
        RwaDelegateError::InvalidTokenProgram
    );
    require!(
        account.to_account_info().owner == &TOKEN_PROGRAM_ID,
        RwaDelegateError::WrongTokenOwner
    );
    let data = account.try_borrow_data()?;
    require!(data.len() >= 64, RwaDelegateError::InvalidVault);
    let mint = Pubkey::new_from_array(
        data[0..32]
            .try_into()
            .map_err(|_| error!(RwaDelegateError::WrongTokenMint))?,
    );
    let owner = Pubkey::new_from_array(
        data[32..64]
            .try_into()
            .map_err(|_| error!(RwaDelegateError::WrongTokenOwner))?,
    );
    require!(mint == *expected_mint, RwaDelegateError::WrongTokenMint);
    require!(owner == *expected_owner, RwaDelegateError::WrongTokenOwner);
    Ok(())
}

fn approve_intent_state(config: &RwaConfig, intent: &mut Account<'_, RwaIntent>) -> Result<()> {
    let clock = Clock::get()?;
    require!(!config.paused, RwaDelegateError::ProtocolPaused);
    require!(
        intent.status == IntentStatus::Open,
        RwaDelegateError::InvalidIntentStatus
    );
    require!(
        intent.quote_expires_at > clock.unix_timestamp,
        RwaDelegateError::QuoteExpired
    );

    intent.status = IntentStatus::Approved;
    intent.approved_at = clock.unix_timestamp;
    intent.last_updated_slot = clock.slot;
    Ok(())
}

fn commit_intent_accounts(ctx: &Context<CommitIntent>) -> Result<()> {
    MagicIntentBundleBuilder::new(
        ctx.accounts.payer.to_account_info(),
        ctx.accounts.magic_context.to_account_info(),
        ctx.accounts.magic_program.to_account_info(),
    )
    .commit(&[ctx.accounts.intent.to_account_info()])
    .build_and_invoke()?;
    Ok(())
}

#[derive(Accounts)]
pub struct InitializeConfig<'info> {
    #[account(
        init,
        payer = admin,
        space = RwaConfig::SPACE,
        seeds = [CONFIG_SEED],
        bump
    )]
    pub config: Account<'info, RwaConfig>,
    #[account(mut)]
    pub admin: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SetPaused<'info> {
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, RwaConfig>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct UpdateExecutor<'info> {
    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = admin @ RwaDelegateError::Unauthorized
    )]
    pub config: Account<'info, RwaConfig>,
    pub admin: Signer<'info>,
}

#[derive(Accounts)]
pub struct InitializeMarket<'info> {
    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = admin @ RwaDelegateError::Unauthorized
    )]
    pub config: Account<'info, RwaConfig>,
    #[account(
        init,
        payer = admin,
        space = RwaMarket::SPACE,
        seeds = [MARKET_SEED, asset_mint.key().as_ref()],
        bump
    )]
    pub market: Account<'info, RwaMarket>,
    #[account(mut)]
    pub admin: Signer<'info>,
    /// CHECK: SPL mint account validated in the handler.
    pub asset_mint: UncheckedAccount<'info>,
    /// CHECK: SPL mint account validated in the handler.
    pub settlement_mint: UncheckedAccount<'info>,
    /// CHECK: SPL token account validated in the handler.
    pub asset_vault: UncheckedAccount<'info>,
    /// CHECK: SPL token account validated in the handler.
    pub settlement_vault: UncheckedAccount<'info>,
    /// CHECK: PDA signer for sandbox settlement vaults.
    #[account(seeds = [VAULT_AUTHORITY_SEED], bump)]
    pub vault_authority: UncheckedAccount<'info>,
    /// CHECK: SPL Token program id validated in the handler.
    pub token_program: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SetMarketPaused<'info> {
    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = admin @ RwaDelegateError::Unauthorized
    )]
    pub config: Account<'info, RwaConfig>,
    #[account(mut, seeds = [MARKET_SEED, market.asset_mint.as_ref()], bump = market.bump)]
    pub market: Account<'info, RwaMarket>,
    pub admin: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(args: CreateIntentArgs)]
pub struct CreateIntent<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, RwaConfig>,
    #[account(
        init,
        payer = owner,
        space = RwaIntent::SPACE,
        seeds = [INTENT_SEED, owner.key().as_ref(), args.nonce.as_ref()],
        bump
    )]
    pub intent: Account<'info, RwaIntent>,
    #[account(mut)]
    pub owner: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(owner_key: Pubkey, nonce: [u8; 16])]
pub struct MutateIntent<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, RwaConfig>,
    #[account(
        mut,
        seeds = [INTENT_SEED, owner_key.as_ref(), nonce.as_ref()],
        bump = intent.bump,
        has_one = owner @ RwaDelegateError::Unauthorized
    )]
    pub intent: Account<'info, RwaIntent>,
    pub owner: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(owner_key: Pubkey, nonce: [u8; 16])]
pub struct ExecutorIntent<'info> {
    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = executor @ RwaDelegateError::Unauthorized
    )]
    pub config: Account<'info, RwaConfig>,
    #[account(
        mut,
        seeds = [INTENT_SEED, owner_key.as_ref(), nonce.as_ref()],
        bump = intent.bump
    )]
    pub intent: Account<'info, RwaIntent>,
    pub executor: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(owner_key: Pubkey, nonce: [u8; 16])]
pub struct SettleSandbox<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, RwaConfig>,
    #[account(
        mut,
        seeds = [MARKET_SEED, market.asset_mint.as_ref()],
        bump = market.bump
    )]
    pub market: Account<'info, RwaMarket>,
    #[account(
        mut,
        seeds = [INTENT_SEED, owner_key.as_ref(), nonce.as_ref()],
        bump = intent.bump,
        has_one = owner @ RwaDelegateError::Unauthorized
    )]
    pub intent: Account<'info, RwaIntent>,
    #[account(mut)]
    pub owner: Signer<'info>,
    /// CHECK: SPL token account validated in the handler to reduce generated stack usage.
    #[account(mut)]
    pub user_asset_account: UncheckedAccount<'info>,
    /// CHECK: SPL token account validated in the handler to reduce generated stack usage.
    #[account(mut)]
    pub user_settlement_account: UncheckedAccount<'info>,
    /// CHECK: SPL token account validated in the handler to reduce generated stack usage.
    #[account(mut)]
    pub asset_vault: UncheckedAccount<'info>,
    /// CHECK: SPL token account validated in the handler to reduce generated stack usage.
    #[account(mut)]
    pub settlement_vault: UncheckedAccount<'info>,
    /// CHECK: PDA signer for sandbox settlement vaults.
    #[account(seeds = [VAULT_AUTHORITY_SEED], bump = market.vault_authority_bump)]
    pub vault_authority: UncheckedAccount<'info>,
    /// CHECK: SPL Token program id validated by token-account helpers.
    pub token_program: UncheckedAccount<'info>,
}

#[derive(Accounts)]
#[instruction(owner_key: Pubkey, nonce: [u8; 16])]
pub struct CancelIntent<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, RwaConfig>,
    #[account(
        mut,
        seeds = [INTENT_SEED, owner_key.as_ref(), nonce.as_ref()],
        bump = intent.bump
    )]
    pub intent: Account<'info, RwaIntent>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(owner_key: Pubkey, nonce: [u8; 16])]
pub struct ExpireIntent<'info> {
    #[account(
        mut,
        seeds = [INTENT_SEED, owner_key.as_ref(), nonce.as_ref()],
        bump = intent.bump
    )]
    pub intent: Account<'info, RwaIntent>,
}

#[delegate]
#[derive(Accounts)]
#[instruction(owner_key: Pubkey, nonce: [u8; 16])]
pub struct DelegateIntent<'info> {
    pub payer: Signer<'info>,
    /// CHECK: The PDA address is constrained by seeds and delegated by MagicBlock.
    #[account(
        mut,
        del,
        seeds = [INTENT_SEED, owner_key.as_ref(), nonce.as_ref()],
        bump
    )]
    pub pda: UncheckedAccount<'info>,
}

#[commit]
#[derive(Accounts)]
#[instruction(owner_key: Pubkey, nonce: [u8; 16])]
pub struct CommitIntent<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, RwaConfig>,
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        mut,
        seeds = [INTENT_SEED, owner_key.as_ref(), nonce.as_ref()],
        bump = intent.bump
    )]
    pub intent: Account<'info, RwaIntent>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum TradeSide {
    Buy,
    Sell,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum IntentStatus {
    Open,
    Approved,
    Submitted,
    Settled,
    Cancelled,
    Expired,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy)]
pub struct CreateIntentArgs {
    pub nonce: [u8; 16],
    pub asset_mint: Pubkey,
    pub settlement_mint: Pubkey,
    pub side: TradeSide,
    pub quantity_atoms: u64,
    pub cash_atoms: u64,
    pub quote_hash: [u8; 32],
    pub quote_expires_at: i64,
}

#[account]
pub struct RwaConfig {
    pub bump: u8,
    pub admin: Pubkey,
    pub emergency_admin: Pubkey,
    pub executor: Pubkey,
    pub settlement_mint: Pubkey,
    pub paused: bool,
    pub max_quote_ttl_seconds: i64,
    pub created_at: i64,
    pub updated_at: i64,
}

impl RwaConfig {
    pub const SPACE: usize = 8 + 1 + 32 + 32 + 32 + 32 + 1 + 8 + 8 + 8;
}

#[account]
pub struct RwaMarket {
    pub bump: u8,
    pub asset_mint: Pubkey,
    pub settlement_mint: Pubkey,
    pub asset_vault: Pubkey,
    pub settlement_vault: Pubkey,
    pub vault_authority_bump: u8,
    pub price_ttl_seconds: i64,
    pub paused: bool,
    pub created_at: i64,
    pub updated_at: i64,
}

impl RwaMarket {
    pub const SPACE: usize = 8 + 1 + 32 + 32 + 32 + 32 + 1 + 8 + 1 + 8 + 8;
}

#[account]
pub struct RwaIntent {
    pub bump: u8,
    pub owner: Pubkey,
    pub asset_mint: Pubkey,
    pub settlement_mint: Pubkey,
    pub nonce: [u8; 16],
    pub side: TradeSide,
    pub quantity_atoms: u64,
    pub cash_atoms: u64,
    pub quote_hash: [u8; 32],
    pub quote_expires_at: i64,
    pub created_at: i64,
    pub approved_at: i64,
    pub submitted_at: i64,
    pub settled_at: i64,
    pub cancelled_at: i64,
    pub last_updated_slot: u64,
    pub settlement_signature: [u8; 64],
    pub status: IntentStatus,
}

impl RwaIntent {
    pub const SPACE: usize =
        8 + 1 + 32 + 32 + 32 + 16 + 1 + 8 + 8 + 32 + 8 + 8 + 8 + 8 + 8 + 8 + 8 + 64 + 1;
}

#[error_code]
pub enum RwaDelegateError {
    #[msg("The caller is not authorized for this RWA intent action.")]
    Unauthorized,
    #[msg("The delegated RWA intent program is paused.")]
    ProtocolPaused,
    #[msg("The RWA sandbox market is paused.")]
    MarketPaused,
    #[msg("The requested RWA intent status transition is invalid.")]
    InvalidIntentStatus,
    #[msg("The RWA intent quote has expired.")]
    QuoteExpired,
    #[msg("The RWA intent quote is still valid.")]
    QuoteStillValid,
    #[msg("The RWA quote TTL is outside the configured bounds.")]
    InvalidQuoteTtl,
    #[msg("The RWA price TTL is invalid.")]
    InvalidPriceTtl,
    #[msg("The RWA settlement mint does not match the configured settlement mint.")]
    InvalidSettlementMint,
    #[msg("The RWA asset mint is invalid for this intent.")]
    InvalidAssetMint,
    #[msg("The RWA intent amount is invalid.")]
    InvalidAmount,
    #[msg("The RWA intent nonce is invalid.")]
    InvalidNonce,
    #[msg("The RWA quote hash is invalid.")]
    InvalidQuoteHash,
    #[msg("The settlement signature is invalid.")]
    InvalidSettlementSignature,
    #[msg("The RWA settlement vault is invalid.")]
    InvalidVault,
    #[msg("The token account mint is invalid.")]
    WrongTokenMint,
    #[msg("The token account owner is invalid.")]
    WrongTokenOwner,
    #[msg("The token program is invalid.")]
    InvalidTokenProgram,
    #[msg("The RWA vault mint is invalid.")]
    WrongVaultMint,
    #[msg("The RWA vault owner is invalid.")]
    WrongVaultOwner,
    #[msg("Checked arithmetic failed.")]
    MathOverflow,
}
