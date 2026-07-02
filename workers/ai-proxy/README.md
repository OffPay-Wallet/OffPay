# OffPay AI Proxy Worker

Cloudflare Worker for the OffPay agentic payments AI and voice proxy.

The worker protects default provider keys and does not execute OffPay wallet, payment, swap, Umbra, offline, or RPC tools. Tool execution remains in the app through local tool handlers and the API Worker-backed helpers.

In strict privacy mode, chat providers receive sanitized prompt text only and return structured intent JSON. Wallet facts, balances, token mints, transaction hashes, validation, confirmation, signing, and submission stay in the app.

## Endpoints

- `GET /health`
- `GET /api/ai/health`
- `POST /api/ai/chat`
- `POST /api/ai/voice/transcribe`
- `POST /api/ai/voice/speech`
- `POST /api/ai` for kind-based JSON dispatch for `chat` and `voice_speech`

## Providers

- Chat: Workers AI primary (`@cf/zai-org/glm-4.7-flash`) with Gemini API and Groq fallback.
- STT: Sarvam first, ElevenLabs fallback only when strict fallback gates allow it.
- TTS: Sarvam first, ElevenLabs fallback with `enable_logging=false`. Can be disabled with `AI_PROXY_TTS_ENABLED=false`.

## Secrets

Workers AI uses the `[ai]` binding in `wrangler.toml`, so it does not need a provider API key secret. Use Cloudflare secrets only for external fallback provider keys. Do not add these to the Expo app `.env`.

```sh
npx wrangler secret put GEMINI_API_KEY --config workers/ai-proxy/wrangler.toml
npx wrangler secret put GROQ_API_KEY --config workers/ai-proxy/wrangler.toml
npx wrangler secret put SARVAM_API_KEY --config workers/ai-proxy/wrangler.toml
npx wrangler secret put ELEVENLABS_API_KEY --config workers/ai-proxy/wrangler.toml
npx wrangler secret put ELEVENLABS_VOICE_ID --config workers/ai-proxy/wrangler.toml
npx wrangler secret put AI_PROXY_SESSION_SECRET --config workers/ai-proxy/wrangler.toml
```

| Name                      | Required    | Used for                                                                                                                                                                                                                                                                  |
| ------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GEMINI_API_KEY`          | No          | Gemini chat fallback provider                                                                                                                                                                                                                                             |
| `GROQ_API_KEY`            | No          | Groq chat fallback provider                                                                                                                                                                                                                                               |
| `SARVAM_API_KEY`          | Yes         | Primary voice STT and TTS provider                                                                                                                                                                                                                                        |
| `ELEVENLABS_API_KEY`      | No          | Voice fallback when Sarvam fails and strict privacy gates allow fallback                                                                                                                                                                                                  |
| `ELEVENLABS_VOICE_ID`     | No          | ElevenLabs TTS fallback voice                                                                                                                                                                                                                                             |
| `AI_PROXY_SESSION_SECRET` | Conditional | HMAC secret used to verify the `x-offpay-ai-session` token. Required when `AI_PROXY_REQUIRE_SESSION_TOKEN=true`. The same value must be set on the client as `EXPO_PUBLIC_OFFPAY_AI_SESSION_SECRET` until a backend-issued token endpoint replaces the pre-shared secret. |

## Worker Vars

These are non-secret Worker variables. The defaults are already in `wrangler.toml`; override them in Cloudflare only when the deployed Worker needs a different value.

| Name                                           | Default                     |
| ---------------------------------------------- | --------------------------- |
| `AI_PROXY_PRIVACY_MODE`                        | `strict`                    |
| `AI_PROXY_GEMINI_PRIVACY_CONFIRMED`            | `true`                      |
| `AI_PROXY_ALLOW_GEMINI_UNPAID`                 | `false`                     |
| `AI_PROXY_ALLOW_VOICE_FALLBACK_WITH_RETENTION` | `false`                     |
| `CLOUDFLARE_AI_CHAT_MODEL`                     | `@cf/zai-org/glm-4.7-flash` |
| `CLOUDFLARE_AI_PROVIDER_TIMEOUT_MS`            | `5500`                      |
| `GEMINI_CHAT_MODEL`                            | `gemini-3.1-flash-lite`     |
| `AI_PROXY_PRIMARY_PROVIDER_TIMEOUT_MS`         | `8000`                      |
| `GROQ_CHAT_MODEL`                              | `llama-3.1-8b-instant`      |
| `GROQ_PROVIDER_TIMEOUT_MS`                     | `16000`                     |
| `GROQ_MAX_COMPLETION_TOKENS`                   | `4096`                      |
| `GROQ_REASONING_EFFORT`                        | `default`                   |
| `SARVAM_STT_MODEL`                             | `saaras:v3`                 |
| `SARVAM_STT_MODE`                              | `transcribe`                |
| `SARVAM_TTS_MODEL`                             | `bulbul:v3`                 |
| `SARVAM_TTS_SPEAKER`                           | `shubh`                     |
| `SARVAM_TTS_LANGUAGE`                          | `en-IN`                     |
| `SARVAM_TTS_CODEC`                             | `mp3`                       |
| `ELEVENLABS_STT_MODEL`                         | `scribe_v2`                 |
| `ELEVENLABS_TTS_MODEL`                         | `eleven_flash_v2_5`         |
| `ELEVENLABS_OUTPUT_FORMAT`                     | `mp3_44100_128`             |
| `ELEVENLABS_ENABLE_LOGGING`                    | `false`                     |
| `AI_PROXY_MAX_CHAT_BYTES`                      | `65536`                     |
| `AI_PROXY_MAX_AUDIO_BYTES`                     | `8388608`                   |
| `AI_PROXY_MAX_TTS_CHARS`                       | `900`                       |
| `AI_PROXY_PROVIDER_TIMEOUT_MS`                 | `24000`                     |
| `AI_PROXY_TTS_ENABLED`                         | `true`                      |
| `AI_PROXY_ALLOWED_ORIGINS`                     | empty                       |
| `AI_PROXY_RATE_LIMIT_WINDOW_MS`                | `60000`                     |
| `AI_PROXY_RATE_LIMIT_MAX`                      | `40`                        |
| `AI_PROXY_REQUIRE_SESSION_TOKEN`               | `false`                     |

`AI_PROXY_ALLOWED_ORIGINS` is only for browser/web clients that send an `Origin` header. Native app requests do not send `Origin`, so this is not a replacement for the planned attestation and rate-limit gate.

The built-in rate limit uses Upstash Redis REST when `UPSTASH_REDIS_REST_URL` and
`UPSTASH_REDIS_REST_TOKEN` are configured on the AI proxy Worker, then falls back to the
per-isolate in-memory guard if Redis is temporarily unavailable. The older `KV_REST_*` names are
accepted only as migration aliases.

Hourly chat credits are enforced by the `offpay-api` Worker through the `OFFPAY_API_AI_CREDITS`
service binding. The AI proxy does not hold MongoDB secrets. In production the API Worker uses
Upstash Redis as the hot hourly credit ledger and falls back to MongoDB if Redis is unavailable. Chat
requests are charged before the provider call and released through the same binding if
validation/provider/proxy errors prevent a successful answer, so provider timeouts do not waste
credits. Run `npm run invite:setup` with the API Worker's existing `MONGODB_URI` and
`MONGODB_DATABASE` to create the `ai_chat_usage` indexes used by the fallback ledger.

Workers AI is the primary chat provider through the `AI` binding in `wrangler.toml` and uses
`CLOUDFLARE_AI_CHAT_MODEL` (`@cf/zai-org/glm-4.7-flash` by default). The Workers AI path uses native
tool calling for first-turn local tool decisions, compact final-answer prompts after tool execution,
and a hashed `x-session-affinity` value so Cloudflare prefix caching can reuse the static agent/tool
prefix across a chat session. If Workers AI times out, rate-limits, or is unavailable, the Worker
falls back to Gemini when `GEMINI_API_KEY` is configured, then to Groq when `GROQ_API_KEY` is
configured. Streamed agent turns still return SSE to the app; the worker gathers the provider result
first and then emits the existing `chat_delta`, `tool_request`, and `chat_done` events.

## Local Env

For local Worker testing, copy the tracked template and fill provider keys:

```sh
cp workers/ai-proxy/.dev.vars.example workers/ai-proxy/.dev.vars
```

`workers/ai-proxy/.dev.vars` is ignored by git and is the only local file that should contain `GEMINI_API_KEY`, `SARVAM_API_KEY`, `ELEVENLABS_API_KEY`, or `ELEVENLABS_VOICE_ID`.

The Expo app only needs the public Worker custom-domain URL and matching client allowlist:

```sh
EXPO_PUBLIC_OFFPAY_AI_PROXY_URL=https://ai.offpay.app
EXPO_PUBLIC_OFFPAY_AI_PROXY_ALLOWED_ORIGINS=https://ai.offpay.app
```

When `AI_PROXY_REQUIRE_SESSION_TOKEN=true` is set on the Worker, the app must also ship the matching shared secret in `EXPO_PUBLIC_OFFPAY_AI_SESSION_SECRET`. Until the backend mints session tokens server-side, the client signs them locally with this shared HMAC secret. Both values rotate together.

```sh
EXPO_PUBLIC_OFFPAY_AI_SESSION_SECRET=<same value set as AI_PROXY_SESSION_SECRET>
```

## Deploy

```sh
npm run deploy:ai-proxy
```

Equivalent direct command:

```sh
npx wrangler deploy --config workers/ai-proxy/wrangler.toml
```

After deploy, set the public Worker URL in the app:

```sh
EXPO_PUBLIC_OFFPAY_AI_PROXY_URL=https://ai.offpay.app
EXPO_PUBLIC_OFFPAY_AI_PROXY_ALLOWED_ORIGINS=https://ai.offpay.app
```
