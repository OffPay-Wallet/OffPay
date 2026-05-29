# OffPay AI Proxy Worker

Cloudflare Worker for the OffPay agentic payments AI and voice proxy.

The worker protects default provider keys and does not execute OffPay wallet, payment, swap, Umbra, offline, or RPC tools. Tool execution remains in the app through `services/` adapters and app-side helpers.

In strict privacy mode, chat providers receive sanitized prompt text only and return structured intent JSON. Wallet facts, balances, token mints, transaction hashes, validation, confirmation, signing, and submission stay in the app.

## Endpoints

- `GET /health`
- `GET /api/ai/health`
- `POST /api/ai/chat`
- `POST /api/ai/voice/transcribe`
- `POST /api/ai/voice/speech`
- `POST /api/ai` for kind-based JSON dispatch for `chat` and `voice_speech`

## Providers

- Chat: Google Gemma 4 26B via the Gemini API (`gemma-4-26b-a4b-it`). This is the only chat provider.
- STT: Sarvam first, ElevenLabs fallback only when strict fallback gates allow it.
- TTS: Sarvam first, ElevenLabs fallback with `enable_logging=false`. Can be disabled with `AI_PROXY_TTS_ENABLED=false`.

## Secrets

Use Cloudflare secrets for provider keys. Do not add these to the Expo app `.env`.

```sh
npx wrangler secret put GEMINI_API_KEY
npx wrangler secret put SARVAM_API_KEY
npx wrangler secret put ELEVENLABS_API_KEY
npx wrangler secret put ELEVENLABS_VOICE_ID
npx wrangler secret put AI_PROXY_SESSION_SECRET
```

| Name | Required | Used for |
| --- | --- | --- |
| `GEMINI_API_KEY` | No | Gemini chat fallback when explicitly enabled |
| `SARVAM_API_KEY` | Yes | Primary voice STT and TTS provider |
| `ELEVENLABS_API_KEY` | No | Voice fallback when Sarvam fails and strict privacy gates allow fallback |
| `ELEVENLABS_VOICE_ID` | No | ElevenLabs TTS fallback voice |
| `AI_PROXY_SESSION_SECRET` | Conditional | HMAC secret used to verify the `x-offpay-ai-session` token. Required when `AI_PROXY_REQUIRE_SESSION_TOKEN=true`. The same value must be set on the client as `EXPO_PUBLIC_OFFPAY_AI_SESSION_SECRET` until a backend-issued token endpoint replaces the pre-shared secret. |

## Worker Vars

These are non-secret Worker variables. The defaults are already in `wrangler.toml`; override them in Cloudflare only when the deployed Worker needs a different value.

| Name | Default |
| --- | --- |
| `AI_PROXY_PRIVACY_MODE` | `strict` |
| `AI_PROXY_GEMINI_PRIVACY_CONFIRMED` | `true` |
| `AI_PROXY_ALLOW_GEMINI_UNPAID` | `false` |
| `AI_PROXY_ALLOW_VOICE_FALLBACK_WITH_RETENTION` | `false` |
| `GEMINI_CHAT_MODEL` | `gemma-4-26b-a4b-it` |
| `SARVAM_STT_MODEL` | `saaras:v3` |
| `SARVAM_STT_MODE` | `transcribe` |
| `SARVAM_TTS_MODEL` | `bulbul:v3` |
| `SARVAM_TTS_SPEAKER` | `shubh` |
| `SARVAM_TTS_LANGUAGE` | `en-IN` |
| `SARVAM_TTS_CODEC` | `mp3` |
| `ELEVENLABS_STT_MODEL` | `scribe_v2` |
| `ELEVENLABS_TTS_MODEL` | `eleven_flash_v2_5` |
| `ELEVENLABS_OUTPUT_FORMAT` | `mp3_44100_128` |
| `ELEVENLABS_ENABLE_LOGGING` | `false` |
| `AI_PROXY_MAX_CHAT_BYTES` | `65536` |
| `AI_PROXY_MAX_AUDIO_BYTES` | `8388608` |
| `AI_PROXY_MAX_TTS_CHARS` | `900` |
| `AI_PROXY_PROVIDER_TIMEOUT_MS` | `20000` |
| `AI_PROXY_TTS_ENABLED` | `true` |
| `AI_PROXY_ALLOWED_ORIGINS` | empty |
| `AI_PROXY_RATE_LIMIT_WINDOW_MS` | `60000` |
| `AI_PROXY_RATE_LIMIT_MAX` | `40` |
| `AI_PROXY_REQUIRE_SESSION_TOKEN` | `false` |

`AI_PROXY_ALLOWED_ORIGINS` is only for browser/web clients that send an `Origin` header. Native app requests do not send `Origin`, so this is not a replacement for the planned attestation and rate-limit gate.

The built-in rate limit is a free per-isolate guard keyed mostly by Cloudflare's connecting IP. It reduces accidental/provider-key abuse without adding storage latency, but production should still move this to KV or Durable Objects once the app-attestation verifier is wired.

## Local Env

For local Worker testing, copy the tracked template and fill provider keys:

```sh
cp workers/ai-proxy/.dev.vars.example workers/ai-proxy/.dev.vars
```

`workers/ai-proxy/.dev.vars` is ignored by git and is the only local file that should contain `GEMINI_API_KEY`, `SARVAM_API_KEY`, `ELEVENLABS_API_KEY`, or `ELEVENLABS_VOICE_ID`.

The Expo app only needs the public Worker URL:

```sh
EXPO_PUBLIC_OFFPAY_AI_PROXY_URL=https://offpay-ai-proxy.<account>.workers.dev
```

When `AI_PROXY_REQUIRE_SESSION_TOKEN=true` is set on the Worker, the app must also ship the matching shared secret in `EXPO_PUBLIC_OFFPAY_AI_SESSION_SECRET`. Until the backend mints session tokens server-side, the client signs them locally with this shared HMAC secret. Both values rotate together.

```sh
EXPO_PUBLIC_OFFPAY_AI_SESSION_SECRET=<same value set as AI_PROXY_SESSION_SECRET>
```

## Deploy

```sh
cd workers/ai-proxy
npx wrangler deploy
```

After deploy, set the public Worker URL in the app:

```sh
EXPO_PUBLIC_OFFPAY_AI_PROXY_URL=https://offpay-ai-proxy.<account>.workers.dev
```
