export class BrowserVAD {
  constructor({
    sampleRate = 48000,
    frameMs = 40,
    energyThreshold = 0.015,
    silenceMs = 1000,
    onSpeechStart,
    onSpeechEnd,
    onFrame,
  } = {}) {
    this.sampleRate = sampleRate;
    this.frameSamples = Math.round((sampleRate * frameMs) / 1000);
    this.energyThreshold = energyThreshold;
    this.silenceMs = silenceMs;
    this.onSpeechStart = onSpeechStart;
    this.onSpeechEnd = onSpeechEnd;
    this.onFrame = onFrame;

    this._speaking = false;
    this._silenceStartAt = 0;
    this._source = null;
    this._processor = null;
    this._context = null;
  }

  async attach(stream) {
    this._context = new AudioContext({ sampleRate: this.sampleRate });
    this._source = this._context.createMediaStreamSource(stream);
    this._processor = this._context.createScriptProcessor(this.frameSamples, 1, 1);

    this._processor.onaudioprocess = (evt) => {
      const input = evt.inputBuffer.getChannelData(0);
      this.onFrame?.(input);
      let energy = 0;
      for (let i = 0; i < input.length; i++) energy += input[i] * input[i];
      const rms = Math.sqrt(energy / input.length);
      const now = performance.now();

      if (rms > this.energyThreshold) {
        if (!this._speaking) {
          this._speaking = true;
          this.onSpeechStart?.();
        }
        this._silenceStartAt = 0;
      } else if (this._speaking) {
        if (!this._silenceStartAt) this._silenceStartAt = now;
        if (now - this._silenceStartAt >= this.silenceMs) {
          this._speaking = false;
          this._silenceStartAt = 0;
          this.onSpeechEnd?.();
        }
      }
    };

    this._source.connect(this._processor);
    this._processor.connect(this._context.destination);
  }

  setSilenceMs(ms) {
    this.silenceMs = Math.max(900, Math.min(1200, Number(ms) || 1000));
  }

  destroy() {
    this._processor?.disconnect();
    this._source?.disconnect();
    this._context?.close();
    this._speaking = false;
    this._silenceStartAt = 0;
  }
}
