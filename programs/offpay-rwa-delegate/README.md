# OffPay RWA Delegate Program

This is a **devnet-only sandbox**. It creates and delegates OffPay-owned RWA
intent PDAs for MagicBlock Ephemeral Rollups. Its `settle_sandbox` instruction
also moves configured classic-SPL sandbox assets between user and vault token
accounts.

Do not deploy or fund this program on mainnet. Sandbox quote amounts are stored
from owner-supplied intent arguments and are not authorized by an on-chain
oracle or independent settlement signer. Real mainnet xStocks are Token-2022
assets and use the separately verified Jupiter base-chain settlement path; the
delegate-program mainnet capability remains disabled.

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
