import { config } from "../config.js";

export async function ttsSynthesize(_ctx, text) {
  if (!text) return { chunk: null, ended: true };

  // Default remains local browser speech fallback unless explicitly enabled.
  if (!config.ttsEnabled) return { chunk: null, ended: true };
  if (!config.mistralApiKey) return { chunk: null, ended: true, error: "MISTRAL_API_KEY missing" };

  try {
    const res = await fetch(`${config.ttsBaseUrl}/v1/audio/speech`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.mistralApiKey}`,
      },
      body: JSON.stringify({
        model: config.ttsModel,
        voice: config.ttsVoice,
        input: text,
        format: "mp3",
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      return { chunk: null, ended: true, error: `TTS failed (${res.status}) ${errText}` };
    }

    const arr = new Uint8Array(await res.arrayBuffer());
    const chunk = Buffer.from(arr).toString("base64");
    return {
      chunk,
      ended: true,
      format: "audio/mpeg",
    };
  } catch (err) {
    return { chunk: null, ended: true, error: err.message };
  }
}
