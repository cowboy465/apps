import { config } from "../config.js";

function truncate(text, max) {
  if (!text) return "";
  const s = String(text);
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function formatTurnCard({ sessionId, turnId, userText, assistantText, mode = "hybrid", bargeInUsed = false, latency = {} }) {
  const now = new Date().toISOString();
  return [
    "🗣️ Voice Turn",
    `Session: ${sessionId}`,
    `Turn: ${turnId}`,
    `User: ${truncate(userText, 500)}`,
    `Assistant: ${truncate(assistantText, 1200)}`,
    `Latency: stt=${latency.sttMs ?? "-"}ms, llm=${latency.llmMs ?? "-"}ms, tts_first=${latency.ttsFirstMs ?? "-"}ms, total=${latency.totalMs ?? "-"}ms`,
    `Mode: ${mode} | Barge-in: ${bargeInUsed ? "yes" : "no"}`,
    `At: ${now}`,
  ].join("\n");
}

export async function sendTelegramTurnLog({ session, sessionId, turnId, userText, assistantText, mode, bargeInUsed, latency }) {
  if (!config.telegramLogEnabled) return { ok: true, skipped: "disabled" };
  if (!config.telegramBotToken) return { ok: false, error: "TELEGRAM_BOT_TOKEN missing" };

  const chatId = session?.telegramUser?.id;
  if (!chatId) return { ok: false, error: "telegram chat id not found on session" };

  const text = formatTurnCard({ sessionId, turnId, userText, assistantText, mode, bargeInUsed, latency });
  const url = `https://api.telegram.org/bot${config.telegramBotToken}/sendMessage`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      disable_web_page_preview: true,
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.ok === false) {
    return { ok: false, error: data?.description || `Telegram send failed (${res.status})` };
  }
  return { ok: true };
}
