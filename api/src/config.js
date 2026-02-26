import dotenv from "dotenv";

dotenv.config({ path: process.env.ENV_FILE || ".env" });

export const config = {
  port: Number(process.env.PORT || 8787),
  nodeEnv: process.env.NODE_ENV || "development",
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || "",
  miniappOrigin: process.env.MINIAPP_ORIGIN || "*",
  redisUrl: process.env.REDIS_URL || "",
  streamTokenSecret: process.env.REALTIME_STREAM_TOKEN_SECRET || "dev-stream-secret",
  streamTokenTtlSec: Number(process.env.REALTIME_STREAM_TOKEN_TTL_SEC || 900),
  sessionTtlSec: Number(process.env.REALTIME_SESSION_TTL_SEC || 3600),

  mistralApiKey: process.env.MISTRAL_API_KEY || "",
  mistralBaseUrl: process.env.MISTRAL_BASE_URL || "https://api.mistral.ai",
  mistralSttModel: process.env.MISTRAL_STT_MODEL || "voxtral-mini-latest",
  mistralChatModel: process.env.MISTRAL_CHAT_MODEL || "mistral-small-latest",
  assistantSystemPrompt:
    process.env.ASSISTANT_SYSTEM_PROMPT ||
    "You are a concise, helpful voice assistant. Reply naturally and briefly.",

  ttsEnabled: String(process.env.TTS_ENABLED || "false") === "true",
  ttsBaseUrl: process.env.TTS_BASE_URL || process.env.MISTRAL_BASE_URL || "https://api.mistral.ai",
  ttsModel: process.env.TTS_MODEL || "mistral-tts-latest",
  ttsVoice: process.env.TTS_VOICE || "alloy",

  telegramLogEnabled: String(process.env.TELEGRAM_LOG_ENABLED || "true") === "true",
};
