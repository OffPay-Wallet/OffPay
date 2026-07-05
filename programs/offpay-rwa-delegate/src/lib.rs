use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::anchor::{commit, delegate, ephemeral};
use ephemeral_rollups_sdk::cpi::DelegateConfig;
use ephemeral_rollups_sdk::ephem::MagicIntentBundleBuilder;

declare_id!("4gFd61LGkcfMzK6i7dB96EfxHPgWRZRw8Q3q1rWCiqu7");

pub const CONFIG_SEED: &[u8] = b"rwa_config";
pub const INTENT_SEED: &[u8] = b"rwa_intent";
pub const MAX_QUOTE_TTL_SECONDS: i64 = 15 * 60;
pub const MIN_QUOTE_TTL_SECONDS: i64 = 5;

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
    #[msg("The requested RWA intent status transition is invalid.")]
    InvalidIntentStatus,
    #[msg("The RWA intent quote has expired.")]
    QuoteExpired,
    #[msg("The RWA intent quote is still valid.")]
    QuoteStillValid,
    #[msg("The RWA quote TTL is outside the configured bounds.")]
    InvalidQuoteTtl,
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
    #[msg("Checked arithmetic failed.")]
    MathOverflow,
}
