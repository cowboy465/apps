import { config } from "../config.js";

const audioBySession = new Map();

function pushChunk(sessionId, b64) {
  if (!sessionId || !b64) return;
  const buf = Buffer.from(b64, "base64");
  const list = audioBySession.get(sessionId) || [];
  list.push(buf);
  audioBySession.set(sessionId, list);
}

function flushChunks(sessionId) {
  const list = audioBySession.get(sessionId) || [];
  audioBySession.delete(sessionId);
  if (!list.length) return null;
  return Buffer.concat(list);
}

async function transcribeWithMistral(audioBuffer) {
  if (!config.mistralApiKey) {
    throw new Error("MISTRAL_API_KEY missing");
  }

  const form = new FormData();
  form.append("model", config.mistralSttModel);
  form.append("file", new Blob([audioBuffer], { type: "audio/webm" }), "input.webm");

  const res = await fetch(`${config.mistralBaseUrl}/v1/audio/transcriptions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.mistralApiKey}`,
    },
    body: form,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.message || data?.error || `STT failed (${res.status})`);
  }

  return data?.text || "";
}

export async function sttTranscribeChunk(ctx, envelope) {
  const sessionId = ctx?.sessionId;

  if (envelope.type === "audio_chunk") {
    pushChunk(sessionId, envelope.payload?.audio_b64);
    return { partialText: null, finalText: null };
  }

  if (envelope.type === "vad_state" && envelope.payload?.state === "end") {
    const audio = flushChunks(sessionId);
    if (!audio) return { partialText: null, finalText: "" };

    try {
      const finalText = await transcribeWithMistral(audio);
      return { partialText: null, finalText };
    } catch (err) {
      return { partialText: null, finalText: "", error: err.message };
    }
  }

  return { partialText: null, finalText: null };
}
