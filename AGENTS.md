# AGENTS.md

## Cursor Cloud specific instructions

OpenClaw is a Telegram Mini App voice assistant made of two independent npm packages (no monorepo tooling):

- `api/` — Node.js (ESM) Express + `ws` WebSocket server. Realtime STT → LLM → TTS pipeline. Session lifecycle with Telegram `initData` auth and HMAC-signed stream tokens.
- `miniapp/` — Vite frontend voice UI.

Each package has its own `package.json` + `package-lock.json`; install/run them separately.

### Running (dev)
- API: `cd api && npm run dev` — listens on `:8787` (`node --watch`). Requires `api/.env` (copy from `api/.env.example`).
- Frontend: `cd miniapp && npm run dev` — serves `:5173` and proxies `/api` (HTTP + WebSocket) to `127.0.0.1:8787` (see `miniapp/vite.config.js`), so the API must run on 8787.
- There are no `lint` or `test` scripts in either package — only `dev`/`start` (api) and `dev`/`build`/`preview` (miniapp). Don't assume a test runner exists.

### External dependencies are optional and degrade gracefully
- `REDIS_URL` empty → session store falls back to in-memory (`session-store=memory` in the startup log). Fine for dev.
- `MISTRAL_API_KEY` empty → STT returns an error for a turn, LLM returns a stub reply, and TTS is disabled (`TTS_ENABLED=false`), so the frontend uses the browser `speechSynthesis` fallback. A full voice turn (real transcription + model reply + audio) needs a real `MISTRAL_API_KEY`.
- Telegram logging (`TELEGRAM_LOG_ENABLED`) posts to the Telegram Bot API; set it to `false` in dev when using a fake bot token.

### Auth / testing the API without Telegram
- `POST /api/realtime/session/start` and `/session/stop` require valid Telegram `initData` verified against `TELEGRAM_BOT_TOKEN`. To exercise the API outside Telegram, set any `TELEGRAM_BOT_TOKEN` in `api/.env` and craft `initData` whose `hash` is `HMAC-SHA256(dataCheckString, key=HMAC-SHA256(botToken, "WebAppData"))` (see `api/src/middleware/verifyTelegramInitData.js`). `auth_date` must be within 24h.
- The realtime WebSocket at `/api/realtime/stream?token=<streamToken>` authenticates with the HMAC stream token returned by `session/start` (not `initData`).

### Frontend gotcha (headless / no microphone)
- The "Connect" button calls `getUserMedia()` before opening the WebSocket, so with no microphone it fails with "Requested device not found" and never connects.
- The "Hold to Talk" button opens the WebSocket first and requests the mic after, so it establishes a live session ("Session ready." + active WS badge) even without a mic. Use it to verify frontend↔backend connectivity in a mic-less environment.
- Outside Telegram, `window.Telegram.WebApp.initData` is empty; the app correctly reports "Missing Telegram initData". Inject a valid signed `initData` onto `window.Telegram.WebApp` to simulate the Telegram context for manual testing.
