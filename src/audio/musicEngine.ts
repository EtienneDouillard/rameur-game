/**
 * Musique procédurale (Web Audio) — couches selon l’énergie de match.
 * Pas de fichiers externes : libre de droits par construction.
 */
export class MusicEngine {
  private ctx: AudioContext;
  private master: GainNode;
  private padGain: GainNode;
  private drumGain: GainNode;
  private bassGain: GainNode;
  private padOsc: OscillatorNode | null = null;
  private padOsc2: OscillatorNode | null = null;
  private running = false;
  private bpm = 118;
  private nextBeat = 0;
  private beat = 0;
  private targetEnergy = 0.12;
  private smoothEnergy = 0.12;
  private finalRush = false;

  setBpm(bpm: number): void {
    this.bpm = Math.min(160, Math.max(80, Math.round(bpm)));
    const root = 110 * (this.bpm / 118);
    if (this.padOsc) this.padOsc.frequency.setTargetAtTime(root, this.ctx.currentTime, 0.08);
    if (this.padOsc2) this.padOsc2.frequency.setTargetAtTime(root * 1.5, this.ctx.currentTime, 0.08);
  }

  getBpm(): number {
    return this.bpm;
  }

  constructor(ctx: AudioContext) {
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0.45;
    this.master.connect(ctx.destination);

    this.padGain = ctx.createGain();
    this.padGain.gain.value = 0.08;
    this.padGain.connect(this.master);

    this.drumGain = ctx.createGain();
    this.drumGain.gain.value = 0;
    this.drumGain.connect(this.master);

    this.bassGain = ctx.createGain();
    this.bassGain.gain.value = 0;
    this.bassGain.connect(this.master);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    const t = this.ctx.currentTime;
    this.padOsc = this.ctx.createOscillator();
    this.padOsc2 = this.ctx.createOscillator();
    this.padOsc.type = "sine";
    this.padOsc2.type = "triangle";
    this.padOsc.frequency.value = 110;
    this.padOsc2.frequency.value = 165;
    this.padOsc.connect(this.padGain);
    this.padOsc2.connect(this.padGain);
    this.padOsc.start(t);
    this.padOsc2.start(t);
    this.nextBeat = t + 0.05;
    this.beat = 0;
    this.schedule();
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setValueAtTime(this.master.gain.value, t);
    this.master.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
    this.padOsc?.stop(t + 0.5);
    this.padOsc2?.stop(t + 0.5);
    this.padOsc = null;
    this.padOsc2 = null;
  }

  setEnergy(energy: number, finalTenSeconds: boolean): void {
    this.targetEnergy = Math.min(1, Math.max(0.08, energy));
    this.finalRush = finalTenSeconds;
  }

  private schedule(): void {
    if (!this.running) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const beatDur = 60 / (this.finalRush ? this.bpm + 18 : this.bpm);

    this.smoothEnergy += (this.targetEnergy - this.smoothEnergy) * 0.08;
    const e = Math.min(1, this.smoothEnergy + (this.finalRush ? 0.35 : 0));

    this.padGain.gain.setTargetAtTime(0.06 + e * 0.1, t, 0.15);
    this.drumGain.gain.setTargetAtTime(e > 0.22 ? 0.12 + e * 0.35 : 0, t, 0.12);
    this.bassGain.gain.setTargetAtTime(e > 0.45 ? 0.08 + e * 0.28 : 0, t, 0.12);

    while (this.nextBeat < t + 0.2) {
      this.playBeat(this.nextBeat, e, this.beat % 4);
      this.nextBeat += beatDur;
      this.beat++;
    }

    requestAnimationFrame(() => this.schedule());
  }

  private playBeat(time: number, energy: number, beatInBar: number): void {
    if (energy > 0.18) this.hat(time, 0.04 + energy * 0.06);
    if (energy > 0.32 && beatInBar % 2 === 0) this.kick(time, 0.1 + energy * 0.15);
    if (energy > 0.5 && beatInBar === 2) this.snare(time, 0.08 + energy * 0.12);
    if (energy > 0.42) {
      const freqs = [55, 65.4, 73.4, 82.4];
      this.bass(time, freqs[beatInBar], 0.06 + energy * 0.1);
    }
    if (this.finalRush && beatInBar === 0) {
      this.kick(time, 0.2);
      this.hat(time, 0.1);
    }
  }

  private kick(time: number, vol: number): void {
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.frequency.setValueAtTime(150, time);
    osc.frequency.exponentialRampToValueAtTime(40, time + 0.08);
    g.gain.setValueAtTime(0.0001, time);
    g.gain.exponentialRampToValueAtTime(vol, time + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, time + 0.14);
    osc.connect(g);
    g.connect(this.drumGain);
    osc.start(time);
    osc.stop(time + 0.15);
  }

  private snare(time: number, vol: number): void {
    const bufferSize = this.ctx.sampleRate * 0.08;
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, time);
    g.gain.exponentialRampToValueAtTime(0.0001, time + 0.1);
    src.connect(g);
    g.connect(this.drumGain);
    src.start(time);
  }

  private hat(time: number, vol: number): void {
    const bufferSize = this.ctx.sampleRate * 0.03;
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1) * 0.6;
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    const hp = this.ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 7000;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, time);
    g.gain.exponentialRampToValueAtTime(0.0001, time + 0.04);
    src.connect(hp);
    hp.connect(g);
    g.connect(this.drumGain);
    src.start(time);
  }

  private bass(time: number, freq: number, vol: number): void {
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = "sawtooth";
    osc.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, time);
    g.gain.linearRampToValueAtTime(vol, time + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, time + 0.22);
    osc.connect(g);
    g.connect(this.bassGain);
    osc.start(time);
    osc.stop(time + 0.24);
  }
}
