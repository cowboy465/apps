export class StreamingAudioPlayer {
  constructor({ onState } = {}) {
    this.ctx = null;
    this.queue = [];
    this.playing = false;
    this.currentSource = null;
    this.currentElement = null;
    this.onState = onState;
  }

  async _ensureCtx() {
    if (!this.ctx) this.ctx = new AudioContext();
    if (this.ctx.state === "suspended") await this.ctx.resume();
  }

  async enqueuePcm16Base64(base64, sampleRate = 24000) {
    await this._ensureCtx();
    const raw = atob(base64);
    const int16 = new Int16Array(raw.length / 2);
    for (let i = 0; i < int16.length; i++) {
      int16[i] = (raw.charCodeAt(i * 2) & 0xff) | (raw.charCodeAt(i * 2 + 1) << 8);
    }
    const floats = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) floats[i] = int16[i] / 32768;

    const buf = this.ctx.createBuffer(1, floats.length, sampleRate);
    buf.copyToChannel(floats, 0);
    this.queue.push(buf);
    if (!this.playing) this._playLoop();
  }

  async _playLoop() {
    this.playing = true;
    this.onState?.("playing");
    while (this.queue.length) {
      const buf = this.queue.shift();
      await new Promise((resolve) => {
        const source = this.ctx.createBufferSource();
        source.buffer = buf;
        this.currentSource = source;
        source.onended = () => resolve();
        source.connect(this.ctx.destination);
        source.start();
      });
    }
    this.currentSource = null;
    this.playing = false;
    this.onState?.("idle");
  }

  async enqueueEncodedBase64(base64, mime = "audio/mpeg") {
    await this._ensureCtx();
    const audio = new Audio(`data:${mime};base64,${base64}`);
    this.currentElement = audio;
    this.playing = true;
    this.onState?.("playing");
    await audio.play().catch(() => {});
    await new Promise((resolve) => {
      audio.onended = resolve;
      audio.onerror = resolve;
    });
    this.currentElement = null;
    this.playing = false;
    this.onState?.("idle");
  }

  clearAndStop(reason = "barge_in") {
    this.queue = [];
    try {
      this.currentSource?.stop(0);
    } catch {}
    try {
      if (this.currentElement) {
        this.currentElement.pause();
        this.currentElement.currentTime = 0;
      }
    } catch {}
    this.currentElement = null;
    this.currentSource = null;
    this.playing = false;
    this.onState?.(`stopped:${reason}`);
  }
}
