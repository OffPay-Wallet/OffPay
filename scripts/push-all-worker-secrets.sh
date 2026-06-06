#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# push-all-worker-secrets.sh
#
# Push ALL required Cloudflare Worker secrets for offpay-api in one go.
# Reads values from a local .env-style file or prompts interactively.
#
# Usage:
#   ./scripts/push-all-worker-secrets.sh                    # interactive
#   ./scripts/push-all-worker-secrets.sh --env .env.secrets  # from file
# =============================================================================

CONFIG="${CONFIG:-workers/api/wrangler.toml}"
ENV_FILE=""

for arg in "$@"; do
  case "$arg" in
    --env=*) ENV_FILE="${arg#*=}" ;;
    --env)   shift; ENV_FILE="${1:-}" ;;
  esac
done

push_secret() {
  local name="$1"
  local value="$2"
  if [[ -z "${value}" ]]; then
    echo "  ⏭  Skipping ${name} (empty)"
    return
  fi
  printf "%s" "${value}" | npx wrangler secret put "${name}" --config "${CONFIG}" 2>&1 | tail -1
}

load_env_value() {
  local key="$1"
  if [[ -n "${ENV_FILE}" && -f "${ENV_FILE}" ]]; then
    grep -E "^${key}=" "${ENV_FILE}" 2>/dev/null | head -1 | sed "s/^${key}=//" | sed 's/^["'"'"']//;s/["'"'"']$//' || true
  fi
}

prompt_or_load() {
  local name="$1"
  local prompt_text="$2"
  local default_value="${3:-}"
  local value=""

  # Try loading from env file first
  value="$(load_env_value "${name}")"
  if [[ -n "${value}" ]]; then
    echo "  📄 ${name} loaded from ${ENV_FILE}"
    printf "%s" "${value}"
    return
  fi

  # Interactive prompt
  if [[ -n "${default_value}" ]]; then
    read -rp "${prompt_text} [${default_value}]: " value
    value="${value:-${default_value}}"
  else
    read -rp "${prompt_text}: " value
  fi
  printf "%s" "${value}"
}

echo "═══════════════════════════════════════════════════════════════"
echo "  OffPay Worker — Push ALL Secrets to Cloudflare"
echo "  Config: ${CONFIG}"
if [[ -n "${ENV_FILE}" ]]; then
  echo "  Env file: ${ENV_FILE}"
fi
echo "═══════════════════════════════════════════════════════════════"
echo

# ---------------------------------------------------------------------------
# 1. Core auth secrets
# ---------------------------------------------------------------------------
echo "── Core Auth Secrets ──────────────────────────────────────────"

OFFPAY_BOOTSTRAP_SECRET="$(prompt_or_load OFFPAY_BOOTSTRAP_SECRET "OFFPAY_BOOTSTRAP_SECRET (64 hex chars, or blank to generate)")"
if [[ -z "${OFFPAY_BOOTSTRAP_SECRET}" ]]; then
  OFFPAY_BOOTSTRAP_SECRET="$(openssl rand -hex 32)"
  echo "  🔑 Generated OFFPAY_BOOTSTRAP_SECRET: ${OFFPAY_BOOTSTRAP_SECRET}"
fi

OFFPAY_BACKUP_HMAC_SECRET="$(prompt_or_load OFFPAY_BACKUP_HMAC_SECRET "OFFPAY_BACKUP_HMAC_SECRET (64 hex chars, or blank to generate)")"
if [[ -z "${OFFPAY_BACKUP_HMAC_SECRET}" ]]; then
  OFFPAY_BACKUP_HMAC_SECRET="$(openssl rand -hex 32)"
  echo "  🔑 Generated OFFPAY_BACKUP_HMAC_SECRET: ${OFFPAY_BACKUP_HMAC_SECRET}"
fi

push_secret "OFFPAY_BOOTSTRAP_SECRET" "${OFFPAY_BOOTSTRAP_SECRET}"
push_secret "OFFPAY_BACKUP_HMAC_SECRET" "${OFFPAY_BACKUP_HMAC_SECRET}"

# ---------------------------------------------------------------------------
# 2. Upstash Redis (KV)
# ---------------------------------------------------------------------------
echo
echo "── Upstash Redis ────────────────────────────────────────────"

KV_REST_API_URL="$(prompt_or_load KV_REST_API_URL "KV_REST_API_URL")"
KV_REST_API_TOKEN="$(prompt_or_load KV_REST_API_TOKEN "KV_REST_API_TOKEN")"

push_secret "KV_REST_API_URL" "${KV_REST_API_URL}"
push_secret "KV_REST_API_TOKEN" "${KV_REST_API_TOKEN}"

# ---------------------------------------------------------------------------
# 3. Helius RPC
# ---------------------------------------------------------------------------
echo
echo "── Helius ───────────────────────────────────────────────────"

HELIUS_DEVNET_API_KEY="$(prompt_or_load HELIUS_DEVNET_API_KEY "HELIUS_DEVNET_API_KEY")"
HELIUS_MAINNET_API_KEY="$(prompt_or_load HELIUS_MAINNET_API_KEY "HELIUS_MAINNET_API_KEY")"
HELIUS_DEVNET_RPC_URL="$(prompt_or_load HELIUS_DEVNET_RPC_URL "HELIUS_DEVNET_RPC_URL")"
HELIUS_MAINNET_RPC_URL="$(prompt_or_load HELIUS_MAINNET_RPC_URL "HELIUS_MAINNET_RPC_URL")"
HELIUS_DEVNET_WS_URL="$(prompt_or_load HELIUS_DEVNET_WS_URL "HELIUS_DEVNET_WS_URL")"
HELIUS_MAINNET_WS_URL="$(prompt_or_load HELIUS_MAINNET_WS_URL "HELIUS_MAINNET_WS_URL")"

push_secret "HELIUS_DEVNET_API_KEY" "${HELIUS_DEVNET_API_KEY}"
push_secret "HELIUS_MAINNET_API_KEY" "${HELIUS_MAINNET_API_KEY}"
push_secret "HELIUS_DEVNET_RPC_URL" "${HELIUS_DEVNET_RPC_URL}"
push_secret "HELIUS_MAINNET_RPC_URL" "${HELIUS_MAINNET_RPC_URL}"
push_secret "HELIUS_DEVNET_WS_URL" "${HELIUS_DEVNET_WS_URL}"
push_secret "HELIUS_MAINNET_WS_URL" "${HELIUS_MAINNET_WS_URL}"

# ---------------------------------------------------------------------------
# 4. Alchemy RPC
# ---------------------------------------------------------------------------
echo
echo "── Alchemy ──────────────────────────────────────────────────"

ALCHEMY_DEVNET_RPC_URL="$(prompt_or_load ALCHEMY_DEVNET_RPC_URL "ALCHEMY_DEVNET_RPC_URL")"
ALCHEMY_MAINNET_RPC_URL="$(prompt_or_load ALCHEMY_MAINNET_RPC_URL "ALCHEMY_MAINNET_RPC_URL")"
ALCHEMY_DEVNET_FALLBACK_RPC_URL="$(prompt_or_load ALCHEMY_DEVNET_FALLBACK_RPC_URL "ALCHEMY_DEVNET_FALLBACK_RPC_URL (optional)")"
ALCHEMY_MAINNET_FALLBACK_RPC_URL="$(prompt_or_load ALCHEMY_MAINNET_FALLBACK_RPC_URL "ALCHEMY_MAINNET_FALLBACK_RPC_URL (optional)")"
ALCHEMY_PRICE_API_KEY="$(prompt_or_load ALCHEMY_PRICE_API_KEY "ALCHEMY_PRICE_API_KEY")"

push_secret "ALCHEMY_DEVNET_RPC_URL" "${ALCHEMY_DEVNET_RPC_URL}"
push_secret "ALCHEMY_MAINNET_RPC_URL" "${ALCHEMY_MAINNET_RPC_URL}"
push_secret "ALCHEMY_DEVNET_FALLBACK_RPC_URL" "${ALCHEMY_DEVNET_FALLBACK_RPC_URL}"
push_secret "ALCHEMY_MAINNET_FALLBACK_RPC_URL" "${ALCHEMY_MAINNET_FALLBACK_RPC_URL}"
push_secret "ALCHEMY_PRICE_API_KEY" "${ALCHEMY_PRICE_API_KEY}"

# ---------------------------------------------------------------------------
# 5. Jupiter
# ---------------------------------------------------------------------------
echo
echo "── Jupiter ──────────────────────────────────────────────────"

JUPITER_API_KEY="$(prompt_or_load JUPITER_API_KEY "JUPITER_API_KEY")"
push_secret "JUPITER_API_KEY" "${JUPITER_API_KEY}"

# ---------------------------------------------------------------------------
# 6. MongoDB / Invite Gate
# ---------------------------------------------------------------------------
echo
echo "── MongoDB / Invite Gate ────────────────────────────────────"

MONGODB_URI="$(prompt_or_load MONGODB_URI "MONGODB_URI (mongodb+srv://...)")"
MONGODB_DATABASE="$(prompt_or_load MONGODB_DATABASE "MONGODB_DATABASE" "offpay")"

OFFPAY_INVITE_CODE_PEPPER="$(prompt_or_load OFFPAY_INVITE_CODE_PEPPER "OFFPAY_INVITE_CODE_PEPPER (blank to generate)")"
if [[ -z "${OFFPAY_INVITE_CODE_PEPPER}" ]]; then
  OFFPAY_INVITE_CODE_PEPPER="$(openssl rand -hex 32)"
  echo "  🔑 Generated OFFPAY_INVITE_CODE_PEPPER: ${OFFPAY_INVITE_CODE_PEPPER}"
  echo "  ⚠️  Save this value! You must use the same pepper when generating invite codes."
fi

if [[ ${#OFFPAY_INVITE_CODE_PEPPER} -lt 32 ]]; then
  echo "ERROR: OFFPAY_INVITE_CODE_PEPPER must be at least 32 characters." >&2
  exit 1
fi

push_secret "MONGODB_URI" "${MONGODB_URI}"
push_secret "MONGODB_DATABASE" "${MONGODB_DATABASE}"
push_secret "OFFPAY_INVITE_CODE_PEPPER" "${OFFPAY_INVITE_CODE_PEPPER}"

# ---------------------------------------------------------------------------
# 7. Devnet faucet (optional)
# ---------------------------------------------------------------------------
echo
echo "── Devnet Faucet (optional) ─────────────────────────────────"

OFFPAY_DEVNET_FAUCET_SECRET_KEY="$(prompt_or_load OFFPAY_DEVNET_FAUCET_SECRET_KEY "OFFPAY_DEVNET_FAUCET_SECRET_KEY (base58 or blank to skip)")"
push_secret "OFFPAY_DEVNET_FAUCET_SECRET_KEY" "${OFFPAY_DEVNET_FAUCET_SECRET_KEY}"

# ---------------------------------------------------------------------------
# 8. Umbra (optional)
# ---------------------------------------------------------------------------
echo
echo "── Umbra (optional) ─────────────────────────────────────────"

UMBRA_API_KEY="$(prompt_or_load UMBRA_API_KEY "UMBRA_API_KEY (blank to skip)")"
push_secret "UMBRA_API_KEY" "${UMBRA_API_KEY}"

# ---------------------------------------------------------------------------
# Done
# ---------------------------------------------------------------------------
echo
echo "═══════════════════════════════════════════════════════════════"
echo "  ✅ All secrets pushed to Cloudflare Worker."
echo ""
echo "  Deploy with:"
echo "    npm run deploy:api-worker"
echo ""
echo "  Tail logs with:"
echo "    npm run tail:api-worker"
echo "═══════════════════════════════════════════════════════════════"
