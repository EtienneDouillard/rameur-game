import type { GameEvent, PlayerId } from "../types/events";
import { RhythmEngine } from "../events/rhythmEngine";
import { GameSession, comboLabel, multiplierForCombo, type GameSnapshot } from "../game/gameSession";
import { SoundEngine } from "../audio/soundEngine";
import { PoseVision } from "../vision/poseVision";
import { startCamera, stopCamera } from "../vision/camera";
import { ParticleField } from "./particles";

export class App {
  private root: HTMLElement;
  private video: HTMLVideoElement;
  private rhythm = new RhythmEngine();
  private game = new GameSession();
  private sound = new SoundEngine();
  private vision: PoseVision | null = null;
  private particles: ParticleField | null = null;
  private lastCombo: Record<PlayerId, number> = { player1: 0, player2: 0 };
  private calibDone: Record<PlayerId, boolean> = { player1: false, player2: false };
  private lastFrameAt = 0;
  private frameCount = 0;
  private animHandle = 0;
  private prevSnap: GameSnapshot | null = null;

  constructor(root: HTMLElement, video: HTMLVideoElement) {
    this.root = root;
    this.video = video;
    this.renderShell();
  }

  private renderShell(): void {
    this.root.innerHTML = `
      <div class="rb">
        <canvas class="rb-particles" aria-hidden="true"></canvas>
        <header class="rb-header">
          <div class="rb-player rb-player--left">
            <div class="rb-score" data-score="p1">0</div>
            <div class="rb-combo" data-combo="p1"></div>
          </div>
          <div class="rb-timer-wrap">
            <div class="rb-timer" data-timer>1:30</div>
            <div class="rb-phase" data-phase>Row Battle</div>
          </div>
          <div class="rb-player rb-player--right">
            <div class="rb-score" data-score="p2">0</div>
            <div class="rb-combo" data-combo="p2"></div>
          </div>
        </header>
        <main class="rb-main">
          <div class="rb-column rb-column--left">
            <div class="rb-energy"><div class="rb-energy-fill" data-energy="p1"></div></div>
            <div class="rb-flash" data-flash="p1"></div>
          </div>
          <div class="rb-center">
            <div class="rb-screen rb-screen--active" data-screen="start">
              <h1>ROW BATTLE</h1>
              <p>Deux rameurs · Une caméra · Zéro capteur</p>
              <p class="rb-privacy">La vidéo reste sur cet appareil.</p>
              <button type="button" class="rb-btn rb-btn--primary" data-action="start">Jouer</button>
              <p class="rb-hint" data-load-status></p>
            </div>
            <div class="rb-screen" data-screen="calib">
              <h2>Calibration</h2>
              <p>Ramez normalement pendant <strong>5 secondes</strong></p>
              <div class="rb-calib-bars">
                <div class="rb-calib-bar"><span data-calib="p1"></span></div>
                <div class="rb-calib-bar"><span data-calib="p2"></span></div>
              </div>
            </div>
            <div class="rb-screen" data-screen="play">
              <p class="rb-play-hint">Gardez le rythme !</p>
            </div>
            <div class="rb-screen" data-screen="end">
              <h2 data-winner>Victoire</h2>
              <div class="rb-results">
                <div class="rb-result-card" data-result="p1"></div>
                <div class="rb-result-card" data-result="p2"></div>
              </div>
              <button type="button" class="rb-btn rb-btn--primary" data-action="replay">Rejouer</button>
            </div>
          </div>
          <div class="rb-column rb-column--right">
            <div class="rb-energy"><div class="rb-energy-fill" data-energy="p2"></div></div>
            <div class="rb-flash" data-flash="p2"></div>
          </div>
        </main>
        <footer class="rb-footer" data-fps></footer>
      </div>
    `;

    const canvas = this.root.querySelector<HTMLCanvasElement>(".rb-particles")!;
    this.particles = new ParticleField(canvas);
    window.addEventListener("resize", () => this.particles?.resize());
    this.particles.resize();

    this.root.querySelector<HTMLButtonElement>('[data-action="start"]')!.onclick = () =>
      void this.boot();
    this.root.querySelector<HTMLButtonElement>('[data-action="replay"]')!.onclick = () =>
      void this.replay();
  }

  private showScreen(name: "start" | "calib" | "play" | "end"): void {
    this.root.querySelectorAll<HTMLElement>(".rb-screen").forEach((el) => {
      el.classList.toggle("rb-screen--active", el.dataset.screen === name);
    });
  }

  private async boot(): Promise<void> {
    const status = this.root.querySelector<HTMLElement>("[data-load-status]")!;
    status.textContent = "Autorisation caméra…";
    await this.sound.unlock();

    try {
      await startCamera(this.video);
    } catch {
      status.textContent = "Caméra refusée. Autorisez l’accès et réessayez.";
      return;
    }

    status.textContent = "Chargement de l’IA…";
    this.vision = new PoseVision(this.video, (frames) => {
      this.frameCount++;
      this.rhythm.ingest(frames);
    });

    try {
      await this.vision.init();
    } catch (e) {
      status.textContent = `Erreur IA : ${e instanceof Error ? e.message : "inconnue"}`;
      return;
    }

    status.textContent = `Prêt (${this.vision.getBackend()})`;
    this.wireEvents();
    this.vision.start();
    this.startRenderLoop();
    this.beginMatch();
  }

  private wireEvents(): void {
    this.rhythm.on((ev) => {
      this.game.onGameEvent(ev);
      this.onRhythmEvent(ev);
    });

    this.game.onSnapshot((snap) => {
      this.updateHud(snap);
      this.checkComboChanges(snap);
      if (snap.phase === "finished" && this.prevSnap?.phase === "playing") {
        this.onGameEnd(snap);
      }
      this.prevSnap = snap;
    });
  }

  private beginMatch(): void {
    this.calibDone = { player1: false, player2: false };
    this.lastCombo = { player1: 0, player2: 0 };
    this.showScreen("calib");
    this.setPhaseText("Calibration…");
    this.game.beginCalibration();
    this.rhythm.startCalibration();
  }

  private onRhythmEvent(ev: GameEvent): void {
    if (ev.type === "CalibrationProgress") {
      const key = ev.player === "player1" ? "p1" : "p2";
      const bar = this.root.querySelector<HTMLElement>(`[data-calib="${key}"]`);
      if (bar) bar.style.width = `${Math.round(ev.progress * 100)}%`;
    }
    if (ev.type === "CalibrationDone") {
      this.calibDone[ev.player] = true;
      if (this.calibDone.player1 && this.calibDone.player2) {
        this.showScreen("play");
        this.setPhaseText("C’est parti !");
        this.game.startPlaying();
      }
    }
    if (ev.type === "StrokeDetected" && this.game.getPhase() === "playing") {
      this.onStroke(ev.player, ev.strength);
    }
    if (ev.type === "ComboLost" && this.game.getPhase() === "playing") {
      this.sound.playComboBreak();
      this.flashPlayer(ev.player, "break");
    }
  }

  private onStroke(player: PlayerId, strength: number): void {
    const snap = this.game.getSnapshot();
    const combo = player === "player1" ? snap.player1.combo : snap.player2.combo;
    const mult = multiplierForCombo(combo);
    this.sound.playStroke(mult);
    this.flashPlayer(player, "hit", strength);

    const col = this.root.querySelector<HTMLElement>(
      player === "player1" ? ".rb-column--left" : ".rb-column--right",
    );
    if (col && this.particles) {
      const rect = col.getBoundingClientRect();
      const parent = this.root.querySelector(".rb")!.getBoundingClientRect();
      const x = rect.left - parent.left + rect.width / 2;
      const y = rect.top - parent.top + rect.height * 0.6;
      this.particles.burst(x, y, strength * (mult >= 5 ? 1.8 : 1), player === "player1" ? "left" : "right");
      if (mult >= 10) this.particles.flashScreen(1);
      else if (mult >= 5) this.particles.burst(x, y, 1.2, player === "player1" ? "left" : "right");
    }
  }

  private checkComboChanges(snap: GameSnapshot): void {
    for (const player of ["player1", "player2"] as const) {
      const combo = player === "player1" ? snap.player1.combo : snap.player2.combo;
      const prev = this.lastCombo[player];
      if (combo > prev && combo >= 3) {
        const mult = multiplierForCombo(combo);
        if ([2, 3, 5, 10].includes(mult)) this.sound.playComboUp();
      }
      if (combo === 0 && prev > 2) {
        this.sound.playComboBreak();
      }
      this.lastCombo[player] = combo;
    }
  }

  private flashPlayer(player: PlayerId, kind: "hit" | "break", strength = 0.5): void {
    const key = player === "player1" ? "p1" : "p2";
    const el = this.root.querySelector<HTMLElement>(`[data-flash="${key}"]`);
    if (!el) return;
    el.classList.remove("rb-flash--on", "rb-flash--break");
    void el.offsetWidth;
    el.classList.add(kind === "break" ? "rb-flash--break" : "rb-flash--on");
    el.style.setProperty("--flash-intensity", String(strength));
  }

  private updateHud(snap: GameSnapshot): void {
    this.root.querySelector<HTMLElement>('[data-score="p1"]')!.textContent = String(snap.player1.score);
    this.root.querySelector<HTMLElement>('[data-score="p2"]')!.textContent = String(snap.player2.score);
    this.root.querySelector<HTMLElement>('[data-combo="p1"]')!.textContent = comboLabel(snap.player1.combo);
    this.root.querySelector<HTMLElement>('[data-combo="p2"]')!.textContent = comboLabel(snap.player2.combo);

    const e1 = this.root.querySelector<HTMLElement>('[data-energy="p1"]')!;
    const e2 = this.root.querySelector<HTMLElement>('[data-energy="p2"]')!;
    e1.style.height = `${snap.player1.energy * 100}%`;
    e2.style.height = `${snap.player2.energy * 100}%`;

    const sec = Math.ceil(snap.timeLeftMs / 1000);
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    this.root.querySelector<HTMLElement>("[data-timer]")!.textContent =
      `${m}:${s.toString().padStart(2, "0")}`;
  }

  private setPhaseText(text: string): void {
    this.root.querySelector<HTMLElement>("[data-phase]")!.textContent = text;
  }

  private onGameEnd(snap: GameSnapshot): void {
    this.sound.playVictory();
    this.showScreen("end");
    const winner =
      snap.player1.score > snap.player2.score
        ? "Joueur 1 gagne !"
        : snap.player2.score > snap.player1.score
          ? "Joueur 2 gagne !"
          : "Égalité !";
    this.root.querySelector<HTMLElement>("[data-winner]")!.textContent = winner;

    this.fillResult("p1", "Joueur 1", snap.player1, "player1");
    this.fillResult("p2", "Joueur 2", snap.player2, "player2");
    this.setPhaseText("Fin de partie");
    this.vision?.stop();
  }

  private fillResult(
    key: string,
    label: string,
    stats: GameSnapshot["player1"],
    player: PlayerId,
  ): void {
    const el = this.root.querySelector<HTMLElement>(`[data-result="${key}"]`)!;
    el.innerHTML = `
      <h3>${label}</h3>
      <div class="rb-stat"><span>Score</span><strong>${stats.score}</strong></div>
      <div class="rb-stat"><span>Combo max</span><strong>×${multiplierForCombo(stats.maxCombo)}</strong></div>
      <div class="rb-stat"><span>Coups</span><strong>${stats.strokes}</strong></div>
      <div class="rb-stat"><span>Régularité</span><strong>${this.game.regularityPercent(player)}%</strong></div>
      <div class="rb-stat"><span>Précision rythme</span><strong>${this.game.rhythmPrecision(player)}%</strong></div>
    `;
  }

  private async replay(): Promise<void> {
    this.vision?.start();
    this.beginMatch();
  }

  private startRenderLoop(): void {
    let last = performance.now();
    const loop = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      this.particles?.tick(dt);

      if (now - this.lastFrameAt > 1000) {
        const fps = this.frameCount;
        this.frameCount = 0;
        this.lastFrameAt = now;
        const footer = this.root.querySelector<HTMLElement>("[data-fps]");
        if (footer) footer.textContent = `${fps} poses/s · ${this.vision?.getBackend() ?? ""}`;
        if (fps < 12 && this.vision) {
          void this.tryMultiposeFallback();
        }
      }

      this.animHandle = requestAnimationFrame(loop);
    };
    this.animHandle = requestAnimationFrame(loop);
  }

  private multiposeTried = false;
  private async tryMultiposeFallback(): Promise<void> {
    if (this.multiposeTried || !this.vision) return;
    this.multiposeTried = true;
    await this.vision.fallbackToMultipose();
  }

  destroy(): void {
    cancelAnimationFrame(this.animHandle);
    this.vision?.dispose();
    stopCamera(this.video);
    this.game.stop();
  }
}
