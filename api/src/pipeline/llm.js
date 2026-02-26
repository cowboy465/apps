import { config } from "../config.js";

export async function llmGenerate(_ctx, inputText) {
  if (!inputText) return { partial: null, final: "" };

  if (!config.mistralApiKey) {
    return {
      partial: null,
      final: "I can hear you, but MISTRAL_API_KEY is missing on the server.",
    };
  }

  const body = {
    model: config.mistralChatModel,
    messages: [
      { role: "system", content: config.assistantSystemPrompt },
      { role: "user", content: inputText },
    ],
    temperature: 0.4,
  };

  const res = await fetch(`${config.mistralBaseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.mistralApiKey}`,
    },
    body: JSON.stringify(body),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.message || data?.error || `LLM failed (${res.status})`;
    return { partial: null, final: `I hit an upstream error: ${msg}` };
  }

  const final = data?.choices?.[0]?.message?.content || "";
  const partial = final ? String(final).slice(0, Math.min(80, String(final).length)) : null;
  return { partial, final };
}
