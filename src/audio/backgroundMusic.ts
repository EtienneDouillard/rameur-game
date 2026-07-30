const MUSIC_SRC = "/audio/music-loop.mp3";

/** Lecture MP3 en boucle (piste libre de droits, voir public/audio/ATTRIBUTION.md). */
export class BackgroundMusic {
  private audio: HTMLAudioElement;
  private enabled = true;
  private playing = false;

  constructor() {
    this.audio = new Audio(MUSIC_SRC);
    this.audio.loop = true;
    this.audio.preload = "auto";
    this.audio.volume = 0.42;
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (!on) this.stop();
    else if (this.playing) void this.audio.play().catch(() => {});
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  async start(): Promise<void> {
    if (!this.enabled) return;
    this.playing = true;
    this.audio.currentTime = 0;
    try {
      await this.audio.play();
    } catch {
      this.playing = false;
    }
  }

  stop(): void {
    this.playing = false;
    this.audio.pause();
    this.audio.playbackRate = 1;
  }

  setFinalRush(active: boolean): void {
    this.audio.playbackRate = active ? 1.06 : 1;
    this.audio.volume = active ? 0.5 : 0.42;
  }
}
