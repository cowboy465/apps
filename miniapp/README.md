# Telegram Mini App Frontend (Voice UX Stub)

## Run

```bash
cd apps/miniapp
npm install
npm run dev
```

Dev server defaults to `http://localhost:5173`.

## Notes
- Starts session via `POST /api/realtime/session/start` (requires Telegram `initData`).
- WebSocket connects to `/api/realtime/stream?token=...`.
- Uses browser VAD with configurable silence cutoff (900-1200ms, default 1000ms).
- Barge-in clears queued/active playback immediately and sends `barge_in`.
- Event names are aligned to current API contract (`stt_final`, `llm_partial`, `tts_chunk`, etc.).
