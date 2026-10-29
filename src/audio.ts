// All sound is synthesized locally after a user gesture. No samples or network requests.
export class Sound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private ambience: OscillatorNode[] = [];
  enabled = false;
  volume = 0.35;
  async init() {
    try {
      if (!this.ctx) {
        this.ctx = new AudioContext();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0;
        this.master.connect(this.ctx.destination);
        for (const freq of [55, 82.41, 110.2]) {
          const o = this.ctx.createOscillator(),
            g = this.ctx.createGain();
          o.type = "sine";
          o.frequency.value = freq;
          g.gain.value = 0.035;
          o.connect(g);
          g.connect(this.master);
          o.start();
          this.ambience.push(o);
        }
      }
      if (this.ctx.state === "suspended") await this.ctx.resume();
      this.enabled = true;
      this.setVolume(this.volume);
    } catch {
      this.enabled = false;
    }
  }
  setVolume(v: number) {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.ctx && this.master)
      this.master.gain.setTargetAtTime(
        this.enabled ? this.volume : 0,
        this.ctx.currentTime,
        0.05,
      );
  }
  mute() {
    this.enabled = false;
    this.setVolume(this.volume);
  }
  tone(
    freq: number,
    duration: number,
    type: OscillatorType = "sine",
    gain = 0.15,
    end?: number,
  ) {
    if (!this.enabled || !this.ctx || !this.master) return;
    const t = this.ctx.currentTime,
      o = this.ctx.createOscillator(),
      g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (end)
      o.frequency.exponentialRampToValueAtTime(Math.max(10, end), t + duration);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    o.connect(g);
    g.connect(this.master);
    o.start(t);
    o.stop(t + duration + 0.01);
    o.onended = () => {
      o.disconnect();
      g.disconnect();
    };
  }
  shot() {
    this.tone(140, 0.1, "sawtooth", 0.26, 28);
    this.tone(1800, 0.04, "square", 0.07, 240);
  }
  hit() {
    this.tone(720, 0.08, "triangle", 0.12, 280);
  }
  hurt() {
    this.tone(65, 0.25, "sawtooth", 0.12, 22);
  }
  click() {
    this.tone(940, 0.055, "sine", 0.08, 500);
  }
  hack() {
    this.tone(220, 0.7, "sawtooth", 0.07, 1200);
  }
  success() {
    this.tone(440, 0.22, "sine", 0.12);
    setTimeout(() => this.tone(660, 0.3, "sine", 0.1), 120);
    setTimeout(() => this.tone(880, 0.5, "sine", 0.1), 240);
  }
  dispose() {
    this.ambience.forEach((o) => o.stop());
    void this.ctx?.close();
  }
}
