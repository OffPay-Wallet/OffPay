# OffPay RWA Delegate Program

This Anchor program is Phase 4 of the OffPay RWA path. It creates and delegates
OffPay-owned RWA intent PDAs for MagicBlock Ephemeral Rollups. It does not move
RWA tokens and does not accelerate arbitrary Jupiter or Token-2022 transfers.

## Tech

- Solana Anchor `1.0.2`
- MagicBlock `ephemeral-rollups-sdk` `0.14.3`
- MagicBlock Delegation Program through the SDK `#[delegate]`, `#[commit]`, and
  `MagicIntentBundleBuilder`

## Devnet Deploy

Install the required toolchain first:

```bash
rustup install 1.89.0
agave-install init 3.1.9
avm install 1.0.2
avm use 1.0.2
```

Generate or restore the local program keypair before the first deploy:

```bash
mkdir -p target/deploy
solana-keygen new --no-bip39-passphrase --force --outfile target/deploy/offpay_rwa_delegate-keypair.json
anchor keys sync
```

Build and deploy to devnet:

```bash
npm run program:rwa:build
npm run program:rwa:deploy:devnet
```

Verify:

```bash
npm run program:rwa:show:devnet
```

After deployment, set the Worker env values:

```bash
OFFPAY_RWA_DELEGATE_PROGRAM_ID="<deployed_program_id>"
OFFPAY_RWA_DELEGATE_DEVNET_ENABLED="1"
OFFPAY_RWA_MAGICBLOCK_ROUTER_DEVNET_URL="https://devnet-router.magicblock.app"
```
