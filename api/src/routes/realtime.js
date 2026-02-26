import crypto from "node:crypto";
import express from "express";
import { signStreamToken } from "../realtime/token.js";
import { requireTelegramInitData } from "../middleware/verifyTelegramInitData.js";

export function createRealtimeRouter({ config, sessionStore }) {
  const router = express.Router();
  const requireTelegram = requireTelegramInitData({ botToken: config.telegramBotToken });

  router.post("/session/start", requireTelegram, async (req, res) => {
    const now = new Date().toISOString();
    const sessionId = crypto.randomUUID();
    const streamToken = signStreamToken({ sessionId, tgUserId: req.telegram?.user?.id || null }, config.streamTokenSecret, config.streamTokenTtlSec);

    const session = {
      id: sessionId,
      state: "active",
      createdAt: now,
      updatedAt: now,
      telegramUser: req.telegram?.user || null,
      turnCounter: 0,
      mode: req.body?.mode || "continuous",
      lastActivityAt: now,
    };

    await sessionStore.create(session, config.sessionTtlSec);

    res.json({
      sessionId,
      streamToken,
      wsEndpoint: "/api/realtime/stream",
      expiresInSec: config.streamTokenTtlSec,
      state: session.state,
    });
  });

  router.post("/session/stop", requireTelegram, async (req, res) => {
    const sessionId = req.body?.sessionId;
    if (!sessionId) return res.status(400).json({ error: "sessionId required" });

    const existing = await sessionStore.get(sessionId);
    if (!existing) return res.status(404).json({ error: "session not found" });
    if (String(existing?.telegramUser?.id || "") !== String(req.telegram?.user?.id || "")) {
      return res.status(403).json({ error: "forbidden" });
    }

    const updated = await sessionStore.update(sessionId, {
      state: "stopped",
      stoppedAt: new Date().toISOString(),
      stopReason: req.body?.reason || "client_request",
    });

    res.json({ sessionId, state: updated?.state || "stopped", stoppedAt: updated?.stoppedAt });
  });

  return router;
}
