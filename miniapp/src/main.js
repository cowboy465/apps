import "./styles.css";
import { BrowserVAD } from "./vad";
import { StreamingAudioPlayer } from "./audioPlayer";
import { ClientEvent, ServerEvent, VoiceWsClient } from "./wsClient";

const app = document.querySelector("#app");

app.innerHTML = `
  <main class="app-shell">
    <section class="card">
      <strong>Voice Session</strong>
      <p class="small">Push-to-talk + optional hands-free continuous mode.</p>
      <div class="status-grid" id="statusGrid"></div>
    </section>

    <section class="card controls">
      <button id="pttBtn" class="btn primary">Hold to Talk</button>
      <button id="connectBtn" class="btn">Connect</button>
    </section>

    <section class="card transcript-pane" id="transcriptPane"></section>

    <section class="card">
      <div class="toggle-row">
        <label for="continuous">Hands-free continuous mode</label>
        <input id="continuous" type="checkbox" />
      </div>
      <div class="toggle-row">
        <label for="silenceMs">VAD silence cutoff (ms)</label>
        <input id="silenceMs" type="number" min="900" max="1200" value="1000" />
      </div>
      <p class="small">Balanced default: 1000ms (allowed 900-1200ms).</p>
    </section>
  </main>
`;

const state = {
  connected: false,
  recording: false,
  speaking: false,
  playing: false,
  continuous: false,
  partialAssistant: "",
};

const els = {
  statusGrid: document.getElementById("statusGrid"),
  transcriptPane: document.getElementById("transcriptPane"),
  pttBtn: document.getElementById("pttBtn"),
  connectBtn: document.getElementById("connectBtn"),
  continuous: document.getElementById("continuous"),
  silenceMs: document.getElementById("silenceMs"),
};

let ws;
let mediaStream;
let mediaRecorder;
let vad;
let sessionId = null;
let initData = window?.Telegram?.WebApp?.initData || "";
let gotTtsAudio = false;
let lastAssistantText = "";

const player = new StreamingAudioPlayer({
  onState: (mode) => {
    state.playing = mode === "playing";
    renderStatus();
  },
});

function speakLocal(text) {
  if (!text || !window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.rate = 1;
  u.pitch = 1;
  u.lang = "en-US";
  window.speechSynthesis.speak(u);
}

function renderStatus() {
  const pills = [
    ["WS", state.connected],
    ["REC", state.recording],
    ["VAD", state.speaking],
    ["PLAY", state.playing],
  ];
  els.statusGrid.innerHTML = pills
    .map(([label, active]) => `<div class="status-pill ${active ? "active" : ""}">${label}</div>`)
    .join("");
  els.connectBtn.textContent = state.connected ? "Disconnect" : "Connect";
}

function addTranscript(role, text, { partial = false } = {}) {
  const div = document.createElement("div");
  div.className = `transcript-line ${role} ${partial ? "partial" : ""}`;
  div.textContent = text;
  els.transcriptPane.appendChild(div);
  els.transcriptPane.scrollTop = els.transcriptPane.scrollHeight;
}

async function ensureMic() {
  if (mediaStream) return;
  mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });

  vad = new BrowserVAD({
    silenceMs: Number(els.silenceMs.value) || 1000,
    onSpeechStart: () => {
      state.speaking = true;
      renderStatus();
      ws?.send(ClientEvent.VadState, { state: "start" });
      if (state.playing) {
        player.clearAndStop("barge_in");
        ws?.send(ClientEvent.BargeIn, { reason: "user_speaking" });
      }
      if (state.continuous && !state.recording) startRecording();
    },
    onSpeechEnd: () => {
      state.speaking = false;
      renderStatus();
      ws?.send(ClientEvent.VadState, { state: "end" });
      if (state.continuous && state.recording) stopRecording(false);
    },
  });
  await vad.attach(mediaStream);
}

function startRecording() {
  if (!mediaStream || state.recording) return;
  mediaRecorder = new MediaRecorder(mediaStream, { mimeType: "audio/webm;codecs=opus" });
  mediaRecorder.ondataavailable = async (evt) => {
    const buf = await evt.data.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let binary = "";
    for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
    ws?.send(ClientEvent.AudioChunk, { audio_b64: btoa(binary), mime: mediaRecorder.mimeType });
  };
  mediaRecorder.start(240);
  state.recording = true;
  renderStatus();
}

function stopRecording(_commit = false) {
  if (!mediaRecorder || !state.recording) return;
  mediaRecorder.stop();
  state.recording = false;
  renderStatus();
}

async function startSession() {
  const tg = window.Telegram?.WebApp;
  if (!tg) {
    throw new Error("Telegram WebApp SDK not found. Open from bot menu/button inside Telegram.");
  }

  try {
    tg.ready?.();
    tg.expand?.();
  } catch {}

  initData = tg.initData || "";
  if (!initData) {
    await new Promise((r) => setTimeout(r, 80));
    initData = tg.initData || "";
  }
  if (!initData) throw new Error("Missing Telegram initData. Open inside Telegram Mini App.");

  const res = await fetch("/api/realtime/session/start", {
    method: "POST",
    headers: { "content-type": "application/json", "x-telegram-init-data": initData },
    body: JSON.stringify({ mode: state.continuous ? "continuous" : "ptt" }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.reason || data?.error || "Failed to start session");
  sessionId = data.sessionId;
  return data;
}

async function stopSession(reason = "client_request") {
  if (!sessionId || !initData) return;
  await fetch("/api/realtime/session/stop", {
    method: "POST",
    headers: { "content-type": "application/json", "x-telegram-init-data": initData },
    body: JSON.stringify({ sessionId, reason }),
  }).catch(() => {});
}

function connectWs(streamToken) {
  const base = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}`;
  ws = new VoiceWsClient({
    url: `${base}/api/realtime/stream?token=${encodeURIComponent(streamToken)}`,
    onOpen: () => {
      state.connected = true;
      renderStatus();
    },
    onClose: () => {
      state.connected = false;
      renderStatus();
    },
    onEvent: async ({ type, payload }) => {
      if (type === ServerEvent.SessionReady) {
        addTranscript("assistant", "Session ready.");
      } else if (type === ServerEvent.STTPartial) {
        // optional UI hook
      } else if (type === ServerEvent.STTFinal) {
        addTranscript("user", payload?.text || "");
      } else if (type === ServerEvent.LLMPartial) {
        state.partialAssistant = payload?.text || "";
      } else if (type === ServerEvent.LLMFinal) {
        const finalText = payload?.text || "";
        lastAssistantText = finalText;
        gotTtsAudio = false;
        addTranscript("assistant", finalText);
        state.partialAssistant = "";
      } else if (type === ServerEvent.TTSChunk) {
        if (payload?.audioBase64 && payload.audioBase64 !== "[base64-audio-chunk-placeholder]") {
          gotTtsAudio = true;
          if (payload?.format === "audio/mpeg") {
            await player.enqueueEncodedBase64(payload.audioBase64, "audio/mpeg");
          } else {
            await player.enqueuePcm16Base64(payload.audioBase64, 24000);
          }
        }
      } else if (type === ServerEvent.TTSEnd) {
        if (!gotTtsAudio && lastAssistantText) speakLocal(lastAssistantText);
        gotTtsAudio = false;
      } else if (type === ServerEvent.TurnCommitted || type === ServerEvent.SessionStopped) {
        // completion hooks
      } else if (type === ServerEvent.Error) {
        addTranscript("assistant", `Error: ${payload?.reason || payload?.message || "unknown"}`);
      }

      const partialNode = document.getElementById("partial-assistant");
      if (partialNode) partialNode.remove();
      if (state.partialAssistant) {
        const p = document.createElement("div");
        p.id = "partial-assistant";
        p.className = "transcript-line assistant partial";
        p.textContent = state.partialAssistant;
        els.transcriptPane.appendChild(p);
      }
      els.transcriptPane.scrollTop = els.transcriptPane.scrollHeight;
    },
  });
  ws.connect();
}

els.connectBtn.addEventListener("click", async () => {
  if (state.connected) {
    await ensureMic();
    ws.send(ClientEvent.StopContinuous, { reason: "client_request" });
    ws.close();
    await stopSession("client_request");
    sessionId = null;
  } else {
    try {
      const { streamToken } = await startSession();
      await ensureMic();
      connectWs(streamToken);
      if (state.continuous && !state.recording) {
        startRecording();
      }
    } catch (err) {
      addTranscript("assistant", `Connect failed: ${err.message}`);
    }
  }
});

els.pttBtn.addEventListener("pointerdown", async (e) => {
  e.preventDefault();
  els.pttBtn.setPointerCapture?.(e.pointerId);
  if (!state.connected) {
    try {
      const { streamToken } = await startSession();
      connectWs(streamToken);
    } catch (err) {
      addTranscript("assistant", `Connect failed: ${err.message}`);
      return;
    }
  }
  await ensureMic();
  startRecording();
});
els.pttBtn.addEventListener("pointerup", (e) => {
  e.preventDefault();
  stopRecording(false);
  ws?.send(ClientEvent.VadState, { state: "end" });
  if (els.pttBtn.hasPointerCapture?.(e.pointerId)) {
    els.pttBtn.releasePointerCapture(e.pointerId);
  }
});
els.pttBtn.addEventListener("pointercancel", (e) => {
  e.preventDefault();
  stopRecording(false);
  ws?.send(ClientEvent.VadState, { state: "end" });
  if (els.pttBtn.hasPointerCapture?.(e.pointerId)) {
    els.pttBtn.releasePointerCapture(e.pointerId);
  }
});
els.pttBtn.addEventListener("lostpointercapture", () => {
  stopRecording(false);
  ws?.send(ClientEvent.VadState, { state: "end" });
});

els.continuous.addEventListener("change", (e) => {
  state.continuous = e.target.checked;
  if (state.connected && state.continuous && !state.recording) startRecording();
  if (state.connected && !state.continuous && state.recording) stopRecording(false);
});

els.silenceMs.addEventListener("change", () => {
  const ms = Math.max(900, Math.min(1200, Number(els.silenceMs.value) || 1000));
  els.silenceMs.value = String(ms);
  vad?.setSilenceMs(ms);
});

renderStatus();
