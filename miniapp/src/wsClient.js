export const ClientEvent = {
  AudioChunk: "audio_chunk",
  VadState: "vad_state",
  BargeIn: "barge_in",
  StopContinuous: "stop_continuous",
};

export const ServerEvent = {
  SessionReady: "session_ready",
  STTPartial: "stt_partial",
  STTFinal: "stt_final",
  LLMPartial: "llm_partial",
  LLMFinal: "llm_final",
  TTSChunk: "tts_chunk",
  TTSEnd: "tts_end",
  TurnCommitted: "turn_committed",
  SessionStopped: "session_stopped",
  Error: "error",
};

export class VoiceWsClient {
  constructor({ url, onOpen, onClose, onEvent }) {
    this.url = url;
    this.onOpen = onOpen;
    this.onClose = onClose;
    this.onEvent = onEvent;
    this.ws = null;
  }

  connect() {
    this.ws = new WebSocket(this.url);
    this.ws.onopen = () => this.onOpen?.();
    this.ws.onclose = () => this.onClose?.();
    this.ws.onerror = () => this.onEvent?.({ type: ServerEvent.Error, payload: { message: "WebSocket error" } });
    this.ws.onmessage = (msg) => {
      try {
        const data = JSON.parse(msg.data);
        this.onEvent?.(data);
      } catch {
        this.onEvent?.({ type: ServerEvent.Error, payload: { message: "Invalid message JSON" } });
      }
    };
  }

  send(type, payload = {}) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ type, payload }));
  }

  close() {
    this.ws?.close();
  }
}
