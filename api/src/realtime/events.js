import crypto from "node:crypto";

export const inboundEventTypes = new Set([
  "audio_chunk",
  "vad_state",
  "barge_in",
  "stop_continuous",
]);

export const outboundEventTypes = {
  STT_PARTIAL: "stt_partial",
  STT_FINAL: "stt_final",
  LLM_PARTIAL: "llm_partial",
  LLM_FINAL: "llm_final",
  TTS_CHUNK: "tts_chunk",
  TTS_END: "tts_end",
  TURN_COMMITTED: "turn_committed",
};

export function parseEnvelope(raw) {
  if (typeof raw !== "string") return { ok: false, error: "payload must be text" };

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: "invalid json" };
  }

  if (!parsed || typeof parsed !== "object") return { ok: false, error: "invalid envelope" };
  if (!parsed.type || typeof parsed.type !== "string") return { ok: false, error: "missing type" };

  if (!inboundEventTypes.has(parsed.type)) {
    return { ok: false, error: `unsupported type: ${parsed.type}` };
  }

  return {
    ok: true,
    envelope: {
      type: parsed.type,
      eventId: parsed.eventId || crypto.randomUUID?.() || String(Date.now()),
      ts: parsed.ts || new Date().toISOString(),
      sessionId: parsed.sessionId,
      turnId: parsed.turnId,
      payload: parsed.payload ?? {},
    },
  };
}

export function makeOutboundEvent(type, payload = {}, extras = {}) {
  return {
    type,
    eventId: crypto.randomUUID?.() || String(Date.now()),
    ts: new Date().toISOString(),
    payload,
    ...extras,
  };
}
