import type { GameEvent, PlayerId } from "../types/events";
import type { PlayerCount } from "../types/gameMode";
import { activePlayers } from "../types/gameMode";
import { RhythmEngine } from "../events/rhythmEngine";
import {
  GameSession,
  multiplierForCombo,
  comboLabel,
  strokeRateSpm,
  type GameSnapshot,
} from "../game/gameSession";
import { SoundEngine } from "../audio/soundEngine";
import { PoseVision } from "../vision/poseVision";
import { startCamera, stopCamera } from "../vision/camera";
import { ParticleField } from "./particles";
import { VideoStageFx } from "./videoStageFx";
import { CameraRig } from "./cameraRig";
import { BackgroundMusic } from "../audio/backgroundMusic";
import { loadAudioPrefs, saveAudioPrefs } from "../audio/audioPrefs";
import { loadVideoPrefs, saveVideoPrefs } from "../vision/videoPrefs";
import { OdysseyVoice } from "./odysseyVoice";
import {
  DEFAULT_MATCH_DURATION_SEC,
  formatMatchTimer,
  MATCH_DURATION_OPTIONS,
  type MatchDurationSec,
} from "../types/matchDuration";

export class App {
  private root: HTMLElement;
  private video: HTMLVideoElement;
  private playerCount: PlayerCount = 2;
  private rhythm = new RhythmEngine();
  private game = new GameSession();
  private sound = new SoundEngine();
  private vision: PoseVision | null = null;
  private particles: ParticleField | null = null;
  private videoFx: VideoStageFx | null = null;
  private cameraRig: CameraRig | null = null;
  private music: BackgroundMusic | null = null;
  private lastCombo: Record<PlayerId, number> = { player1: 0, player2: 0 };
  private calibDone: Record<PlayerId, boolean> = { player1: false, player2: false };
  private lastFrameAt = 0;
  private frameCount = 0;
  private animHandle = 0;
  private prevSnap: GameSnapshot | null = null;
  private lastPoints: Record<PlayerId, number> = { player1: 0, player2: 0 };
  private wasInFlow: Record<PlayerId, boolean> = { player1: false, player2: false };
  private lastComboTier: Record<PlayerId, number> = { player1: 1, player2: 1 };
  private lastCountdownSec = -1;
  private matchDurationSec: MatchDurationSec = DEFAULT_MATCH_DURATION_SEC;
  private audioMusicOn = true;
  private audioSfxOn = true;
  private videoMirrorOn = false;
  private odyssey: Record<PlayerId, OdysseyVoice> = {
    player1: new OdysseyVoice(),
    player2: new OdysseyVoice(),
  };
  private lastCharge: Record<PlayerId, number> = { player1: 0, player2: 0 };

  constructor(root: HTMLElement, video: HTMLVideoElement) {
    this.root = root;
    this.video = video;
    this.renderShell();
  }

  private renderShell(): void {
    this.root.innerHTML = `
      <div class="rb rb--2p rb--odyssey" data-rb>
        <div class="rb-video-stage" data-cam-stage>
          <div class="rb-video-slot"></div>
          <div class="rb-video-fx" data-video-fx></div>
          <canvas class="rb-video-rings" aria-hidden="true"></canvas>
          <div class="rb-video-scanlines" aria-hidden="true"></div>
          <div class="rb-video-divider" data-video-divider aria-hidden="true"></div>
          <div class="rb-video-hints" aria-live="polite">
            <div class="rb-video-hint-zone rb-video-hint-zone--left">
              <p class="rb-video-hint" data-play-hint="p1" hidden></p>
            </div>
            <div class="rb-video-hint-zone rb-video-hint-zone--right">
              <p class="rb-video-hint" data-play-hint="p2" hidden></p>
            </div>
          </div>
        </div>
        <div class="rb-odyssey-layer" aria-hidden="true">
          <div class="rb-odyssey-horizon"></div>
          <div class="rb-odyssey-waves"></div>
          <div class="rb-odyssey-grain"></div>
        </div>
        <canvas class="rb-particles" aria-hidden="true"></canvas>
        <header class="rb-hud">
          <div class="rb-hud-row">
            <div class="rb-hud-side rb-hud-side--left" data-panel="p1">
              <div class="rb-score rb-score--bounce" data-score="p1">0</div>
              <div class="rb-combo" data-combo="p1"></div>
              <div class="rb-flow-badge" data-flow="p1" hidden>VENT ARRIÈRE</div>
            </div>
            <div class="rb-hud-side rb-hud-side--right" data-panel="p2">
              <div class="rb-score rb-score--bounce" data-score="p2">0</div>
              <div class="rb-combo" data-combo="p2"></div>
              <div class="rb-flow-badge" data-flow="p2" hidden>VENT ARRIÈRE</div>
            </div>
          </div>
          <div class="rb-tug" data-tug-wrap>
            <div class="rb-tug-track">
              <div class="rb-tug-fill rb-tug-fill--left"></div>
              <div class="rb-tug-fill rb-tug-fill--right"></div>
              <div class="rb-tug-ship" data-tug-ship aria-hidden="true"></div>
            </div>
          </div>
          <div class="rb-timer" data-timer>1:30</div>
          <div class="rb-phase" data-phase>En mer…</div>
          <div class="rb-rush-label" data-rush hidden>DERNIÈRE LIGNE</div>
        </header>
        <main class="rb-main">
          <div class="rb-column rb-column--left" data-col="p1">
            <div class="rb-flow-stack">
              <div class="rb-flow-moves">
                <span class="rb-flow-metric-label">MOVE</span>
                <span class="rb-flow-strokes" data-flow-strokes="p1">0</span>
              </div>
              <div class="rb-energy" data-flow-bar="p1"><div class="rb-energy-fill" data-energy="p1"></div></div>
              <span class="rb-flow-caption" data-flow-caption="p1">0/7</span>
            </div>
            <div class="rb-flow-rhythm">
              <span class="rb-flow-metric-label">RHYTHM</span>
              <span class="rb-flow-rhythm-value" data-flow-rhythm="p1">—</span>
            </div>
            <div class="rb-flash" data-flash="p1"></div>
          </div>
          <div class="rb-center">
            <div class="rb-screen rb-screen--active" data-screen="start">
              <p class="rb-epic-kicker">L'équipage d'Ulysse</p>
              <h1>L'ODYSSÉE</h1>
              <p class="rb-epic-tagline">Row Battle · ramez sur la mer Égée</p>
              <p class="rb-mode-label">Mode de jeu</p>
              <div class="rb-mode-picker" role="group" aria-label="Nombre de joueurs">
                <button type="button" class="rb-mode rb-mode--active" data-mode="1">1 joueur</button>
                <button type="button" class="rb-mode" data-mode="2">2 joueurs</button>
              </div>
              <p class="rb-mode-hint" data-mode-hint>Solo : placez-vous au centre du cadre.</p>
              <p class="rb-mode-label">Durée de la partie</p>
              <div class="rb-mode-picker" role="group" aria-label="Durée">
                ${MATCH_DURATION_OPTIONS.map(
                  (sec) =>
                    `<button type="button" class="rb-mode rb-duration" data-duration="${sec}">${sec}s</button>`,
                ).join("")}
              </div>
              <p class="rb-mode-label">Caméra</p>
              <div class="rb-mode-picker" role="group" aria-label="Affichage caméra">
                <button type="button" class="rb-mode" data-video-mirror-toggle>Retourner la vidéo : OFF</button>
              </div>
              <p class="rb-mode-hint" data-video-mirror-hint>Si gauche et droite sont inversées à l'écran, activez cette option.</p>
              <p class="rb-mode-label">Son</p>
              <div class="rb-mode-picker" role="group" aria-label="Audio">
                <button type="button" class="rb-mode rb-mode--active" data-audio-toggle="music">Musique : ON</button>
                <button type="button" class="rb-mode rb-mode--active" data-audio-toggle="sfx">Effets : ON</button>
              </div>
              <p class="rb-privacy">La caméra ne quitte pas le navire (cet appareil).</p>
              <button type="button" class="rb-btn rb-btn--primary" data-action="start">Embarquer</button>
              <p class="rb-hint" data-load-status></p>
            </div>
            <div class="rb-screen" data-screen="calib">
              <h2>Essai des rames</h2>
              <p data-calib-step><strong>1.</strong> Restez <strong>immobile ~2 s</strong> face à la caméra.</p>
              <p class="rb-mode-hint" data-calib-hint>Puis 5 coups de rame pour calibrer l'IA sur votre mouvement.</p>
              <div class="rb-calib-bars">
                <div class="rb-calib-bar" data-calib-wrap="p1"><span data-calib="p1"></span></div>
                <div class="rb-calib-bar" data-calib-wrap="p2"><span data-calib="p2"></span></div>
              </div>
            </div>
            <div class="rb-screen rb-screen--play" data-screen="play"></div>
            <div class="rb-screen" data-screen="end">
              <h2 data-winner>Victoire</h2>
              <div class="rb-results">
                <div class="rb-result-card" data-result="p1"></div>
                <div class="rb-result-card" data-result="p2"></div>
              </div>
              <button type="button" class="rb-btn rb-btn--primary" data-action="replay">Reprendre la mer</button>
            </div>
          </div>
          <div class="rb-column rb-column--right" data-col="p2">
            <div class="rb-flow-stack">
              <div class="rb-flow-moves">
                <span class="rb-flow-metric-label">MOVE</span>
                <span class="rb-flow-strokes" data-flow-strokes="p2">0</span>
              </div>
              <div class="rb-energy" data-flow-bar="p2"><div class="rb-energy-fill" data-energy="p2"></div></div>
              <span class="rb-flow-caption" data-flow-caption="p2">0/7</span>
            </div>
            <div class="rb-flow-rhythm">
              <span class="rb-flow-metric-label">RHYTHM</span>
              <span class="rb-flow-rhythm-value" data-flow-rhythm="p2">—</span>
            </div>
            <div class="rb-flash" data-flash="p2"></div>
          </div>
        </main>
        <footer class="rb-footer">
          <span data-fps></span>
          <span class="rb-footer-audio">
            <button type="button" class="rb-audio-mini" data-audio-toggle="music" title="Musique">♪</button>
            <button type="button" class="rb-audio-mini" data-audio-toggle="sfx" title="Effets">FX</button>
            <button type="button" class="rb-audio-mini" data-video-mirror-toggle title="Retourner la vidéo">⇄</button>
          </span>
        </footer>
      </div>
    `;

    const slot = this.root.querySelector<HTMLElement>(".rb-video-slot")!;
    slot.appendChild(this.video);
    this.video.className = "rb-video";
    this.video.playsInline = true;
    this.video.muted = true;
    this.video.autoplay = true;
    this.video.removeAttribute("hidden");

    const rb = this.root.querySelector<HTMLElement>("[data-rb]")!;
    const canvas = this.root.querySelector<HTMLCanvasElement>(".rb-particles")!;
    const rings = this.root.querySelector<HTMLCanvasElement>(".rb-video-rings")!;
    const overlay = this.root.querySelector<HTMLElement>("[data-video-fx]")!;
    this.particles = new ParticleField(canvas);
    this.videoFx = new VideoStageFx(rb, overlay!, rings!);
    const camStage = this.root.querySelector<HTMLElement>("[data-cam-stage]")!;
    this.cameraRig = new CameraRig(camStage);

    const resize = () => {
      this.particles?.resize();
      this.videoFx?.resize();
    };
    window.addEventListener("resize", resize);
    resize();

    this.root.querySelectorAll<HTMLButtonElement>("[data-mode]").forEach((btn) => {
      btn.onclick = () => this.setPlayerCount(Number(btn.dataset.mode) as PlayerCount);
    });
    this.root.querySelectorAll<HTMLButtonElement>("[data-duration]").forEach((btn) => {
      btn.onclick = () => this.setMatchDuration(Number(btn.dataset.duration) as MatchDurationSec);
    });
    this.setPlayerCount(1);
    this.setMatchDuration(DEFAULT_MATCH_DURATION_SEC);
    this.applyAudioPrefs(loadAudioPrefs());
    this.applyVideoPrefs(loadVideoPrefs());

    this.root.querySelectorAll<HTMLButtonElement>("[data-video-mirror-toggle]").forEach((btn) => {
      btn.onclick = () => this.setVideoMirror(!this.videoMirrorOn);
    });

    this.root.querySelectorAll<HTMLButtonElement>("[data-audio-toggle]").forEach((btn) => {
      btn.onclick = () => {
        const kind = btn.dataset.audioToggle as "music" | "sfx";
        if (kind === "music") this.setAudioMusic(!this.audioMusicOn);
        else this.setAudioSfx(!this.audioSfxOn);
      };
    });

    this.root.querySelector<HTMLButtonElement>('[data-action="start"]')!.onclick = () =>
      void this.boot();
    this.root.querySelector<HTMLButtonElement>('[data-action="replay"]')!.onclick = () =>
      void this.replay();

    this.showScreen("start");
  }

  private setPlayerCount(count: PlayerCount): void {
    this.playerCount = count;
    const rb = this.root.querySelector<HTMLElement>("[data-rb]")!;
    rb.classList.toggle("rb--1p", count === 1);
    rb.classList.toggle("rb--2p", count === 2);

    this.root.querySelectorAll<HTMLButtonElement>("[data-mode]").forEach((btn) => {
      btn.classList.toggle("rb-mode--active", Number(btn.dataset.mode) === count);
    });

    const hint = this.root.querySelector<HTMLElement>("[data-mode-hint]")!;
    hint.textContent =
      count === 1
        ? "Solo : placez-vous au centre du pont."
        : "Duo : marin de bâbord à gauche, tribord à droite.";
  }

  private setMatchDuration(sec: MatchDurationSec): void {
    this.matchDurationSec = sec;
    this.root.querySelectorAll<HTMLButtonElement>("[data-duration]").forEach((btn) => {
      btn.classList.toggle("rb-mode--active", Number(btn.dataset.duration) === sec);
    });
    const timerEl = this.root.querySelector<HTMLElement>("[data-timer]");
    if (timerEl) timerEl.textContent = formatMatchTimer(sec);
  }

  private applyAudioPrefs(prefs: { music: boolean; sfx: boolean }): void {
    this.audioMusicOn = prefs.music;
    this.audioSfxOn = prefs.sfx;
    this.music = this.music ?? new BackgroundMusic();
    this.music.setEnabled(this.audioMusicOn);
    this.sound.setSfxEnabled(this.audioSfxOn);
    this.updateAudioToggleLabels();
  }

  private setAudioMusic(on: boolean): void {
    this.audioMusicOn = on;
    if (!this.music) this.music = new BackgroundMusic();
    this.music.setEnabled(on);
    if (on && this.game.getPhase() === "playing") void this.music.start();
    this.persistAudioPrefs();
    this.updateAudioToggleLabels();
  }

  private setAudioSfx(on: boolean): void {
    this.audioSfxOn = on;
    this.sound.setSfxEnabled(on);
    this.persistAudioPrefs();
    this.updateAudioToggleLabels();
  }

  private persistAudioPrefs(): void {
    saveAudioPrefs({ music: this.audioMusicOn, sfx: this.audioSfxOn });
  }

  private applyVideoPrefs(prefs: { mirror: boolean }): void {
    this.videoMirrorOn = prefs.mirror;
    this.syncVideoMirrorUi();
  }

  private setVideoMirror(on: boolean): void {
    this.videoMirrorOn = on;
    saveVideoPrefs({ mirror: on });
    this.syncVideoMirrorUi();
  }

  private syncVideoMirrorUi(): void {
    const rb = this.root.querySelector<HTMLElement>("[data-rb]")!;
    rb.classList.toggle("rb--video-mirror", this.videoMirrorOn);
    this.vision?.setFlipHorizontal(this.videoMirrorOn);
    this.root.querySelectorAll<HTMLButtonElement>("[data-video-mirror-toggle]").forEach((btn) => {
      const mini = btn.classList.contains("rb-audio-mini");
      if (mini) {
        btn.textContent = "⇄";
        btn.classList.toggle("rb-audio-mini--off", !this.videoMirrorOn);
        btn.classList.toggle("rb-mode--active", this.videoMirrorOn);
        btn.title = this.videoMirrorOn
          ? "Retourner la vidéo : activé"
          : "Retourner la vidéo : désactivé";
      } else {
        btn.textContent = `Retourner la vidéo : ${this.videoMirrorOn ? "ON" : "OFF"}`;
        btn.classList.toggle("rb-mode--active", this.videoMirrorOn);
      }
    });
  }

  private updateAudioToggleLabels(): void {
    this.root.querySelectorAll<HTMLButtonElement>("[data-audio-toggle]").forEach((btn) => {
      const kind = btn.dataset.audioToggle;
      if (kind === "music") {
        const on = this.audioMusicOn;
        btn.textContent = btn.classList.contains("rb-audio-mini") ? "♪" : `Musique : ${on ? "ON" : "OFF"}`;
        btn.classList.toggle("rb-mode--active", on);
        btn.classList.toggle("rb-audio-mini--off", !on);
      }
      if (kind === "sfx") {
        const on = this.audioSfxOn;
        btn.textContent = btn.classList.contains("rb-audio-mini") ? "FX" : `Effets : ${on ? "ON" : "OFF"}`;
        btn.classList.toggle("rb-mode--active", on);
        btn.classList.toggle("rb-audio-mini--off", !on);
      }
    });
  }

  private showScreen(name: "start" | "calib" | "play" | "end"): void {
    this.root.querySelectorAll<HTMLElement>(".rb-screen").forEach((el) => {
      el.classList.toggle("rb-screen--active", el.dataset.screen === name);
    });
    const rb = this.root.querySelector<HTMLElement>("[data-rb]")!;
    rb.classList.toggle("rb--live", name === "calib" || name === "play");
    rb.classList.toggle("rb--overlay-light", name === "start" || name === "end");
    rb.classList.toggle("rb--preplay", name === "start" || name === "calib" || name === "end");
  }

  private async boot(): Promise<void> {
    const status = this.root.querySelector<HTMLElement>("[data-load-status]")!;
    status.textContent = "Autorisation caméra…";
    await this.sound.unlock();
    this.music = new BackgroundMusic();
    this.applyAudioPrefs(loadAudioPrefs());
    this.applyVideoPrefs(loadVideoPrefs());

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
    this.vision.setPlayerCount(this.playerCount);
    this.vision.setFlipHorizontal(this.videoMirrorOn);

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
      this.checkFlowStates(snap);
      this.checkScorePopups(snap);
      this.updateVideoComboFx(snap);
      this.updateCameraAndMusic(snap);
      if (snap.phase === "finished" && this.prevSnap?.phase === "playing") {
        this.onGameEnd(snap);
      }
      this.prevSnap = snap;
    });
  }

  private beginMatch(): void {
    this.multiposeTried = false;
    this.calibDone = { player1: false, player2: false };
    this.lastCombo = { player1: 0, player2: 0 };
    this.lastComboTier = { player1: 1, player2: 1 };
    this.wasInFlow = { player1: false, player2: false };
    this.lastCharge = { player1: 0, player2: 0 };
    this.odyssey.player1.reset();
    this.odyssey.player2.reset();
    this.lastCountdownSec = -1;
    this.music?.stop();
    this.lastPoints = { player1: 0, player2: 0 };
    this.vision?.setPlayerCount(this.playerCount);
    this.showScreen("calib");
    this.setPhaseText("Essai des rames…");
    const calibHint = this.root.querySelector<HTMLElement>("[data-calib-hint]");
    if (calibHint) {
      calibHint.textContent =
        this.playerCount === 1
          ? "Ne bougez pas au début, puis ramez comme en partie."
          : "Chaque marin : immobile, puis 5 coups.";
    }
    this.game.beginCalibration(this.playerCount, this.matchDurationSec);
    this.rhythm.startCalibration(this.playerCount);
  }

  private calibrationComplete(): boolean {
    const needed = activePlayers(this.playerCount);
    return needed.every((p) => this.calibDone[p]);
  }

  private onRhythmEvent(ev: GameEvent): void {
    if (ev.type === "CalibrationProgress") {
      const key = ev.player === "player1" ? "p1" : "p2";
      const bar = this.root.querySelector<HTMLElement>(`[data-calib="${key}"]`);
      if (bar) bar.style.width = `${Math.round(ev.progress * 100)}%`;
      const step = this.root.querySelector<HTMLElement>("[data-calib-step]");
      if (step) {
        if (ev.progress < 0.23) {
          step.innerHTML =
            "<strong>1.</strong> Restez <strong>immobile</strong> — l'IA mesure le calme de la mer…";
        } else if (ev.progress < 1) {
          step.innerHTML =
            "<strong>2.</strong> Ramez : <strong>5 coups</strong> nets pour calibrer votre rythme.";
        }
      }
    }
    if (ev.type === "CalibrationDone") {
      this.calibDone[ev.player] = true;
      if (this.calibrationComplete()) {
        this.showScreen("play");
        this.setPhaseText("");
        this.game.startPlaying();
        void this.music?.start();
      }
    }
    if (ev.type === "StrokeDetected" && this.game.getPhase() === "playing") {
      if (this.playerCount === 1 && ev.player !== "player1") return;
      this.onStroke(ev.player, ev.strength);
    }
    if (ev.type === "ComboLost" && this.game.getPhase() === "playing") {
      this.sound.playComboBreak();
      this.flashPlayer(ev.player, "break");
    }
  }

  private onStroke(player: PlayerId, strength: number): void {
    const snap = this.game.getSnapshot();
    const stats = player === "player1" ? snap.player1 : snap.player2;
    const mult = multiplierForCombo(stats.combo);
    this.sound.playStroke(mult);
    if (stats.combo > 1) this.sound.playComboTick();
    this.flashPlayer(player, "hit", strength);

    const side = this.playerSide(player);
    this.videoFx?.punch(side, strength);
    this.cameraRig?.pulseHit();
    this.particles?.streak(side);

    const { x, y } = this.effectCoords(player);
    const hue = player === "player1" ? 195 : 320;
    const intensity = strength * (mult >= 5 ? 2 : mult >= 2 ? 1.4 : 1);
    this.particles?.burst(x, y, intensity, side);
    this.particles?.shockwave(x, y, hue);
    if (stats.flow.inFlow) {
      this.particles?.flashScreen(0.8);
      this.particles?.burst(x, y, 2, side);
    } else if (mult >= 10) {
      this.particles?.flashScreen(1);
    } else if (mult >= 5) {
      this.particles?.burst(x, y, 1.5, side);
    }

    this.bounceScore(player);
  }

  private bounceScore(player: PlayerId): void {
    const key = player === "player1" ? "p1" : "p2";
    const el = this.root.querySelector<HTMLElement>(`[data-score="${key}"]`);
    el?.classList.remove("rb-score--pop");
    void el?.offsetWidth;
    el?.classList.add("rb-score--pop");
  }

  private playerSide(player: PlayerId): "left" | "right" | "center" {
    if (this.playerCount === 1) return "center";
    return player === "player1" ? "left" : "right";
  }

  private effectCoords(player: PlayerId): { x: number; y: number } {
    const rb = this.root.querySelector(".rb")!.getBoundingClientRect();
    if (this.playerCount === 1) {
      return { x: rb.width * 0.5, y: rb.height * 0.55 };
    }
    const col = this.root.querySelector<HTMLElement>(
      player === "player1" ? ".rb-column--left" : ".rb-column--right",
    )!;
    const rect = col.getBoundingClientRect();
    return {
      x: rect.left - rb.left + rect.width / 2,
      y: rect.top - rb.top + rect.height * 0.6,
    };
  }

  private checkScorePopups(snap: GameSnapshot): void {
    for (const player of activePlayers(this.playerCount)) {
      const stats = player === "player1" ? snap.player1 : snap.player2;
      const delta = stats.score - this.lastPoints[player];
      if (delta > 0 && snap.phase === "playing") {
        const { x, y } = this.effectCoords(player);
        const hue = player === "player1" ? 195 : 320;
        this.particles?.scorePopup(x, y - 30, `+${delta}`, hue);
      }
      this.lastPoints[player] = stats.score;
    }
  }

  private checkFlowStates(snap: GameSnapshot): void {
    if (snap.phase !== "playing") {
      for (const key of ["p1", "p2"] as const) {
        const badge = this.root.querySelector<HTMLElement>(`[data-flow="${key}"]`);
        if (badge) badge.hidden = true;
      }
      this.hidePlayHints();
      return;
    }

    for (const player of activePlayers(this.playerCount)) {
      const stats = player === "player1" ? snap.player1 : snap.player2;
      const f = stats.flow;
      const key = player === "player1" ? "p1" : "p2";
      const inBoost = f.inFlow && f.boostStrokesLeft > 0;

      const badge = this.root.querySelector<HTMLElement>(`[data-flow="${key}"]`);
      if (badge) {
        badge.hidden = !inBoost;
        if (inBoost) {
          badge.textContent = `VENT ARRIÈRE · ${f.boostStrokesLeft}/${f.boostStrokesTotal}`;
        }
        badge.classList.toggle("rb-flow-badge--over", inBoost);
      }

      const justEntered = inBoost && !this.wasInFlow[player];
      const justLeft = !inBoost && this.wasInFlow[player];
      const justBroke =
        f.chargeProgress < this.lastCharge[player] && !inBoost && !this.wasInFlow[player];

      if (justEntered) {
        this.sound.playFlowEnter();
        this.sound.playOverdrive();
      }
      if (justLeft) {
        this.sound.playFlowFade();
      }

      this.wasInFlow[player] = inBoost;
      this.lastCharge[player] = f.chargeProgress;

      const hint = this.root.querySelector<HTMLElement>(`[data-play-hint="${key}"]`);
      if (!hint) continue;

      if (inBoost) {
        hint.hidden = true;
        hint.textContent = "";
        continue;
      }

      const line = this.odyssey[player].lineFor(player, this.playerCount, {
        charge: f.chargeProgress,
        inFlow: false,
        justEnteredFlow: justEntered,
        justLeftFlow: justLeft,
        justBroke,
        finalRush: snap.finalRush,
      });

      if (line) {
        hint.hidden = false;
        hint.textContent = line;
        hint.classList.toggle("rb-video-hint--hot", f.chargeProgress >= 5);
      } else {
        hint.hidden = true;
        hint.classList.remove("rb-video-hint--hot");
      }
    }

    for (const key of ["p1", "p2"] as const) {
      if (this.playerCount === 1 && key === "p2") {
        const b = this.root.querySelector<HTMLElement>(`[data-flow="${key}"]`);
        const h = this.root.querySelector<HTMLElement>(`[data-play-hint="${key}"]`);
        if (b) b.hidden = true;
        if (h) h.hidden = true;
      }
    }
  }

  private hidePlayHints(): void {
    for (const key of ["p1", "p2"] as const) {
      const hint = this.root.querySelector<HTMLElement>(`[data-play-hint="${key}"]`);
      if (hint) {
        hint.hidden = true;
        hint.textContent = "";
        hint.classList.remove("rb-video-hint--hot");
      }
    }
  }

  private updateVideoComboFx(snap: GameSnapshot): void {
    if (snap.phase !== "playing") {
      this.videoFx?.setComboLevel(0);
      return;
    }
    const c1 = snap.player1.combo;
    const c2 = this.playerCount === 2 ? snap.player2.combo : 0;
    const max = Math.max(c1, c2);
    const level = multiplierForCombo(max);
    this.videoFx?.setComboLevel(level);
    const rb = this.root.querySelector<HTMLElement>("[data-rb]")!;
    rb.classList.toggle("rb--rush", snap.finalRush);
  }

  private updateCameraAndMusic(snap: GameSnapshot): void {
    if (snap.phase !== "playing") return;
    const players = activePlayers(this.playerCount);
    let maxIntensity = 0;
    let anyInFlow = false;
    for (const p of players) {
      const f = p === "player1" ? snap.player1.flow : snap.player2.flow;
      maxIntensity = Math.max(maxIntensity, f.intensity);
      anyInFlow = anyInFlow || f.inFlow;
    }
    this.cameraRig?.update(maxIntensity, anyInFlow, snap.finalRush);
    this.music?.setFinalRush(snap.finalRush);

    const sec = Math.ceil(snap.timeLeftMs / 1000);
    const rushEl = this.root.querySelector<HTMLElement>("[data-rush]");
    if (rushEl) rushEl.hidden = !snap.finalRush;
    if (snap.finalRush && sec !== this.lastCountdownSec && sec <= 10) {
      this.sound.playCountdownTick(sec <= 3);
      this.lastCountdownSec = sec;
    }
  }

  private checkComboChanges(snap: GameSnapshot): void {
    for (const player of activePlayers(this.playerCount)) {
      const combo = player === "player1" ? snap.player1.combo : snap.player2.combo;
      const prev = this.lastCombo[player];
      const tier = multiplierForCombo(combo);
      const prevTier = this.lastComboTier[player];
      if (tier > prevTier && tier > 1) {
        this.sound.playTierUp(tier);
      }
      if (combo > prev && combo >= 2) {
        this.root.querySelector<HTMLElement>(
          `[data-combo="${player === "player1" ? "p1" : "p2"}"]`,
        )?.classList.add("rb-combo--bump");
      }
      if (combo === 0 && prev > 2) {
        this.sound.playComboBreak();
      }
      this.lastCombo[player] = combo;
      this.lastComboTier[player] = tier;
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
    const c1 = this.root.querySelector<HTMLElement>('[data-combo="p1"]')!;
    const c2 = this.root.querySelector<HTMLElement>('[data-combo="p2"]')!;
    c1.textContent = comboLabel(snap.player1.combo);
    c2.textContent = comboLabel(snap.player2.combo);

    const e1 = this.root.querySelector<HTMLElement>('[data-energy="p1"]')!;
    const e2 = this.root.querySelector<HTMLElement>('[data-energy="p2"]')!;
    e1.style.height = `${snap.player1.flow.barFill * 100}%`;
    e2.style.height = `${snap.player2.flow.barFill * 100}%`;

    this.updateFlowColumn("p1", snap.player1);
    this.updateFlowColumn("p2", snap.player2);

    const ship = this.root.querySelector<HTMLElement>("[data-tug-ship]");
    if (ship) ship.style.left = `${snap.tugPercent}%`;
    const tug = this.root.querySelector<HTMLElement>("[data-tug-wrap]");
    if (tug) tug.hidden = this.playerCount === 1;

    const sec = Math.ceil(snap.timeLeftMs / 1000);
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    const timerEl = this.root.querySelector<HTMLElement>("[data-timer]")!;
    timerEl.textContent = `${m}:${s.toString().padStart(2, "0")}`;
    timerEl.classList.toggle("rb-timer--rush", snap.finalRush);

    const rb = this.root.querySelector<HTMLElement>("[data-rb]")!;
    const odysseyFlow =
      snap.phase === "playing" &&
      (snap.player1.flow.inFlow || snap.player2.flow.inFlow);
    rb.classList.toggle("rb--odyssey-flow", odysseyFlow);
  }

  private updateFlowColumn(key: "p1" | "p2", stats: GameSnapshot["player1"]): void {
    const flow = stats.flow;
    const col = this.root.querySelector<HTMLElement>(`[data-col="${key === "p1" ? "p1" : "p2"}"]`);
    col?.classList.toggle("rb-column--flow-active", flow.inFlow);

    const strokesEl = this.root.querySelector<HTMLElement>(`[data-flow-strokes="${key}"]`);
    if (strokesEl) strokesEl.textContent = String(stats.strokes);

    const cap = this.root.querySelector<HTMLElement>(`[data-flow-caption="${key}"]`);
    if (cap) {
      if (flow.inFlow) {
        cap.textContent = `BOOST ${flow.boostStrokesLeft}/${flow.boostStrokesTotal}`;
        cap.classList.add("rb-flow-caption--active");
      } else {
        cap.textContent = `${flow.chargeProgress}/${flow.chargeRequired}`;
        cap.classList.remove("rb-flow-caption--active");
      }
    }

    const spm = strokeRateSpm(stats.intervals);
    const rhythmEl = this.root.querySelector<HTMLElement>(`[data-flow-rhythm="${key}"]`);
    if (rhythmEl) rhythmEl.textContent = spm > 0 ? String(spm) : "—";
  }

  private setPhaseText(text: string): void {
    this.root.querySelector<HTMLElement>("[data-phase]")!.textContent = text;
  }

  private onGameEnd(snap: GameSnapshot): void {
    this.music?.stop();
    this.showScreen("end");
    if (this.playerCount === 1) {
      this.sound.playVictory();
      this.root.querySelector<HTMLElement>("[data-winner]")!.textContent = "Partie terminée !";
      this.fillResult("p1", "Joueur", snap.player1, "player1");
      const p2card = this.root.querySelector<HTMLElement>('[data-result="p2"]')!;
      p2card.innerHTML = "";
      p2card.hidden = true;
    } else {
      const p1wins = snap.player1.score > snap.player2.score;
      const p2wins = snap.player2.score > snap.player1.score;
      const winner = p1wins
        ? "Joueur 1 gagne !"
        : p2wins
          ? "Joueur 2 gagne !"
          : "Égalité !";
      this.root.querySelector<HTMLElement>("[data-winner]")!.textContent = winner;
      this.sound.playVictory();
      if ((p1wins && !p2wins) || (p2wins && !p1wins)) {
        setTimeout(() => this.sound.playDefeat(), 400);
      }
      this.fillResult("p1", "Joueur 1", snap.player1, "player1");
      this.fillResult("p2", "Joueur 2", snap.player2, "player2");
      this.root.querySelector<HTMLElement>('[data-result="p2"]')!.hidden = false;
    }
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
    el.hidden = false;
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
      this.videoFx?.tick(dt);

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
    this.music?.stop();
    this.vision?.dispose();
    stopCamera(this.video);
    this.game.stop();
  }
}
