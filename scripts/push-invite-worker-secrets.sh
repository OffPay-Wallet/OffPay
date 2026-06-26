#!/usr/bin/env bash
set -euo pipefail

CONFIG="${CONFIG:-workers/api/wrangler.toml}"

echo "OffPay invite gate Worker setup"
echo
echo "Before running, make sure MongoDB Atlas Network Access allows Cloudflare Worker egress."
echo "For prototype testing, Atlas -> Security -> Database & Network Access -> IP Access List -> 0.0.0.0/0."
echo

read -rp "MongoDB URI (mongodb+srv://...): " MONGODB_URI
read -rp "MongoDB database [offpay]: " MONGODB_DATABASE
MONGODB_DATABASE="${MONGODB_DATABASE:-offpay}"

read -rp "Invite pepper (blank to generate new): " OFFPAY_INVITE_CODE_PEPPER
if [[ -z "${OFFPAY_INVITE_CODE_PEPPER}" ]]; then
  OFFPAY_INVITE_CODE_PEPPER="$(openssl rand -hex 32)"
  echo "Generated OFFPAY_INVITE_CODE_PEPPER:"
  echo "${OFFPAY_INVITE_CODE_PEPPER}"
  echo "Save this value. You must use the same pepper when generating invite codes."
fi

if [[ ${#OFFPAY_INVITE_CODE_PEPPER} -lt 32 ]]; then
  echo "OFFPAY_INVITE_CODE_PEPPER must be at least 32 characters." >&2
  exit 1
fi

echo
echo "Pushing Worker secrets..."
printf "%s" "${MONGODB_URI}" \
  | npx wrangler secret put MONGODB_URI --config "${CONFIG}"
printf "%s" "${MONGODB_DATABASE}" \
  | npx wrangler secret put MONGODB_DATABASE --config "${CONFIG}"
printf "%s" "${OFFPAY_INVITE_CODE_PEPPER}" \
  | npx wrangler secret put OFFPAY_INVITE_CODE_PEPPER --config "${CONFIG}"

echo
echo "Running worker typecheck..."
npm run typecheck:api-worker

echo
echo "Deploying Worker..."
npx wrangler deploy --config "${CONFIG}"

echo
echo "Done."
echo "Generate shareable invite codes with:"
echo "OFFPAY_INVITE_CODE_PEPPER='${OFFPAY_INVITE_CODE_PEPPER}' npm run invite:generate -- --count 100 --segment B1 --expiry-days 30"
echo "Codes are six uppercase alphanumeric characters."
