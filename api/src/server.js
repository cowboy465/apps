import http from "node:http";
import express from "express";
import cors from "cors";
import { WebSocketServer } from "ws";
import { config } from "./config.js";
import { createSessionStore } from "./session/store.js";
import { createRealtimeRouter } from "./routes/realtime.js";
import { verifyStreamToken } from "./realtime/token.js";
import { makeOutboundEvent, parseEnvelope, outboundEventTypes } from "./realtime/events.js";
import { sttTranscribeChunk } from "./pipeline/stt.js";
import { llmGenerate } from "./pipeline/llm.js";
import { ttsSynthesize } from "./pipeline/tts.js";
import { sendTelegramTurnLog } from "./integrations/telegramLog.js";

const app = express();
app.use(
  cors({
    origin: config.miniappOrigin === "*" ? true : config.miniappOrigin,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["content-type", "x-telegram-init-data", "authorization"],
  }),
);
app.use(express.json({ limit: "2mb" }));

const { type: storeType, store: sessionStore } = await createSessionStore(config.redisUrl);

app.get("/health", (_req, res) => {
  res.json({ ok: true, redis: storeType, ts: new Date().toISOString() });
});

app.use("/api/realtime", createRealtimeRouter({ config, sessionStore }));

const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname !== "/api/realtime/stream") return;

  const token = url.searchParams.get("token") || req.headers["sec-websocket-protocol"];
  const verified = verifyStreamToken(String(token || ""), config.streamTokenSecret);
  if (!verified.valid) {
    socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
    socket.destroy();
    return;
  }

  wss.handleUpgrade(req, socket, head, (ws) => {
    ws.auth = verified.payload;
    wss.emit("connection", ws, req);
  });
});

wss.on("connection", async (ws) => {
  const sessionId = ws.auth?.sessionId;
  const session = await sessionStore.get(sessionId);
  if (!session || session.state !== "active") {
    ws.send(JSON.stringify({ error: "invalid session" }));
    ws.close();
    return;
  }

  ws.send(JSON.stringify(makeOutboundEvent("session_ready", { sessionId })));

  ws.on("message", async (raw) => {
    const parsed = parseEnvelope(raw.toString());
    if (!parsed.ok) {
      ws.send(JSON.stringify(makeOutboundEvent("error", { reason: parsed.error })));
      return;
    }

    const envelope = parsed.envelope;
    let currentSession = await sessionStore.get(sessionId);
    if (!currentSession) {
      ws.send(JSON.stringify(makeOutboundEvent("error", { reason: "session expired" })));
      return;
    }
    currentSession = await sessionStore.update(sessionId, { lastActivityAt: new Date().toISOString() });

    if (envelope.type === "barge_in") {
      ws.send(JSON.stringify(makeOutboundEvent(outboundEventTypes.TTS_END, { interrupted: true })));
      return;
    }

    if (envelope.type === "stop_continuous") {
      await sessionStore.update(sessionId, { state: "stopped", stopReason: "stop_continuous" });
      ws.send(JSON.stringify(makeOutboundEvent("session_stopped", { sessionId })));
      return;
    }

    const turnStart = Date.now();
    const sttStart = Date.now();
    const stt = await sttTranscribeChunk({ sessionId }, envelope);
    const sttMs = Date.now() - sttStart;
    if (stt.error) {
      ws.send(JSON.stringify(makeOutboundEvent("error", { reason: stt.error })));
      return;
    }
    if (stt.partialText) {
      ws.send(JSON.stringify(makeOutboundEvent(outboundEventTypes.STT_PARTIAL, { text: stt.partialText })));
    }
    if (!stt.finalText) return;

    ws.send(JSON.stringify(makeOutboundEvent(outboundEventTypes.STT_FINAL, { text: stt.finalText })));

    const llmStart = Date.now();
    const llm = await llmGenerate({ sessionId }, stt.finalText);
    const llmMs = Date.now() - llmStart;
    if (llm.partial) {
      ws.send(JSON.stringify(makeOutboundEvent(outboundEventTypes.LLM_PARTIAL, { text: llm.partial })));
    }
    if (llm.final) {
      ws.send(JSON.stringify(makeOutboundEvent(outboundEventTypes.LLM_FINAL, { text: llm.final })));
    }

    const ttsStart = Date.now();
    const tts = await ttsSynthesize({ sessionId }, llm.final);
    const ttsMs = Date.now() - ttsStart;
    if (tts.error) {
      ws.send(JSON.stringify(makeOutboundEvent("error", { reason: tts.error })));
    }
    if (tts.chunk) {
      ws.send(
        JSON.stringify(
          makeOutboundEvent(outboundEventTypes.TTS_CHUNK, {
            audioBase64: tts.chunk,
            format: tts.format || "pcm16",
          }),
        ),
      );
    }
    if (tts.ended) {
      const updated = await sessionStore.update(sessionId, { turnCounter: (currentSession.turnCounter || 0) + 1 });
      const turnId = updated?.turnCounter || (currentSession.turnCounter || 0) + 1;
      ws.send(JSON.stringify(makeOutboundEvent(outboundEventTypes.TTS_END, { done: true })));
      ws.send(JSON.stringify(makeOutboundEvent(outboundEventTypes.TURN_COMMITTED, { sessionId, turnId })));

      const totalMs = Date.now() - turnStart;
      const logRes = await sendTelegramTurnLog({
        session: updated || currentSession,
        sessionId,
        turnId,
        userText: stt.finalText,
        assistantText: llm.final,
        mode: currentSession.mode || "hybrid",
        bargeInUsed: false,
        latency: { sttMs, llmMs, ttsFirstMs: ttsMs, totalMs },
      });
      if (!logRes.ok) {
        ws.send(JSON.stringify(makeOutboundEvent("error", { reason: `telegram_log: ${logRes.error}` })));
      }
    }
  });
});

server.listen(config.port, () => {
  console.log(`[api] listening on :${config.port} (session-store=${storeType})`);
});
