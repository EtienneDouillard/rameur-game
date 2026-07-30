import type {
  CalibrationUiPhase,
  GameEvent,
  GameEventListener,
  PlayerId,
  PlayerPoseFrame,
  PlayerRhythmProfile,
} from "../types/events";
import { activePlayers, type PlayerCount } from "../types/gameMode";
import { extractFeatures } from "./features";
import { OneEuroFilter } from "./oneEuro";

const CALIBRATION_STROKES = 10;
export { CALIBRATION_STROKES };
/** Attente globale avant les coups de calibration */
const CALIBRATION_WAIT_MS = 15_000;
const CALIB_WAIT_PROGRESS = 0.2;
const HOLD_VALID_MS = 200;
const REFRACTORY_MIN_MS = 380;
const REFRACTORY_MAX_MS = 1100;
const REFRACTORY_RATIO = 0.5;
const MIN_STROKE_GAP_MS = 400;
/** Vitesse basse → on recale la ligne de base du signal */
const BASELINE_LERP = 0.04;
/** Fenêtre d'auto-réglage des seuils pendant la partie */
const AUTOTUNE_WINDOW_MS = 4000;
const AUTOTUNE_MIN_AMP_FLOOR = 0.025;
const AUTOTUNE_VEL_FLOOR = 0.07;
/**
 * Hystérésis du cycle de rame : on ne compte qu'en montant vers le finish,
 * et il faut être redescendu au catch pour pouvoir recompter.
 */
const SCHMITT_HIGH = 0.76;
const SCHMITT_LOW = 0.3;
/** Vitesse de rétraction de l'enveloppe (par seconde, en fraction de l'amplitude) */
const ENVELOPE_DECAY_PER_SEC = 0.22;
/** Amplitude minimale acceptée pendant l'essai des rames */
const CALIB_MIN_AMP = 0.03;

interface PlayerState {
  filter: OneEuroFilter;
  velFilter: OneEuroFilter;
  prevDrive: number;
  prevTime: number;
  /** "catch" = prêt à compter la traction, "drive" = traction comptée, on attend le retour */
  cycleState: "catch" | "drive";
  /** Enveloppe adaptative du signal (min/max glissants) */
  envMin: number;
  envMax: number;
  lastStrokeAt: number;
  strokeIntervals: number[];
  calibSamples: number[];
  calibIdleSamples: number[];
  calibIdleStartedAt: number;
  calibIdleDone: boolean;
  calibPeakVel: number[];
  calibStrokeAmps: number[];
  calibStrokeCount: number;
  windowStart: number;
  windowMin: number;
  windowMax: number;
  windowStrokes: number;
  profile: PlayerRhythmProfile | null;
  active: boolean;
  refractoryUntil: number;
  lastValidDrive: number;
  lastValidAt: number;
  velocity: number;
  driveBaseline: number;
  lastMotionAt: number;
}

export class RhythmEngine {
  private listeners = new Set<GameEventListener>();
  private players: Record<PlayerId, PlayerState>;
  private calibrating = false;
  private enabled: PlayerId[] = ["player1", "player2"];
  private calibStartedAt = 0;
  private lastWaitSecondEmitted = -1;
  private calibStrokesOpened = false;

  constructor() {
    this.players = {
      player1: this.newPlayerState(),
      player2: this.newPlayerState(),
    };
  }

  private newPlayerState(): PlayerState {
    return {
      filter: new OneEuroFilter(2.4, 0.04, 1.1),
      velFilter: new OneEuroFilter(1.9, 0.075, 1),
      prevDrive: 0,
      prevTime: 0,
      cycleState: "catch",
      envMin: Infinity,
      envMax: -Infinity,
      lastStrokeAt: 0,
      strokeIntervals: [],
      calibSamples: [],
      calibIdleSamples: [],
      calibIdleStartedAt: 0,
      calibIdleDone: false,
      calibPeakVel: [],
      calibStrokeAmps: [],
      calibStrokeCount: 0,
      windowStart: 0,
      windowMin: Infinity,
      windowMax: -Infinity,
      windowStrokes: 0,
      profile: null,
      active: false,
      refractoryUntil: 0,
      lastValidDrive: 0,
      lastValidAt: 0,
      velocity: 0,
      driveBaseline: 0.5,
      lastMotionAt: 0,
    };
  }

  on(listener: GameEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: GameEvent): void {
    for (const l of this.listeners) l(event);
  }

  startCalibration(playerCount: PlayerCount = 2): void {
    this.enabled = activePlayers(playerCount);
    this.calibrating = true;
    this.calibStartedAt = performance.now();
    this.lastWaitSecondEmitted = -1;
    this.calibStrokesOpened = false;
    for (const id of ["player1", "player2"] as const) {
      const p = this.players[id];
      p.filter.reset();
      p.velFilter.reset();
      p.calibSamples = [];
      p.calibIdleSamples = [];
      p.calibIdleStartedAt = 0;
      p.calibIdleDone = false;
      p.calibPeakVel = [];
      p.calibStrokeAmps = [];
      p.calibStrokeCount = 0;
      p.windowStart = 0;
      p.windowMin = Infinity;
      p.windowMax = -Infinity;
      p.windowStrokes = 0;
      p.profile = null;
      p.strokeIntervals = [];
      p.cycleState = "catch";
      p.envMin = Infinity;
      p.envMax = -Infinity;
      p.active = false;
      p.prevTime = 0;
      p.prevDrive = 0;
      p.driveBaseline = 0.5;
      p.lastValidAt = 0;
      p.refractoryUntil = 0;
      p.lastStrokeAt = 0;
      p.lastMotionAt = 0;
      p.velocity = 0;
    }
    this.emit({ type: "CalibrationWait", secondsLeft: 15 });
    this.lastWaitSecondEmitted = 15;
  }

  isCalibrating(): boolean {
    return this.calibrating;
  }

  isPlayerIdleCalibrated(player: PlayerId): boolean {
    return this.players[player].calibIdleDone;
  }

  /** Filet de sécurité : personne ne doit rester bloqué sur l'écran de calibration. */
  forceFinishCalibration(): void {
    if (!this.calibrating) return;
    const now = performance.now();
    for (const id of this.enabled) {
      if (!this.players[id].profile) this.finishPlayerCalibration(id, now);
    }
  }

  getCalibStrokes(player: PlayerId): number {
    return this.players[player].calibStrokeCount;
  }

  /** Diagnostic terrain (activé par ?debug=1) */
  getDiagnostics(player: PlayerId): string {
    const p = this.players[player];
    if (!p.profile) return "calib";
    const range = p.envMax - p.envMin;
    const norm = range > 0 ? (p.prevDrive - p.driveBaseline - p.envMin) / range : 0;
    return [
      `amp:${range.toFixed(3)}`,
      `min:${p.profile.minStrokeAmp.toFixed(3)}`,
      `n:${norm.toFixed(2)}`,
      p.cycleState === "drive" ? "tirage" : "retour",
      p.active ? "ON" : "off",
    ].join(" ");
  }

  ingest(frames: PlayerPoseFrame[]): void {
    const now = performance.now();

    if (this.calibrating) {
      this.tickCalibrationClock(now);
    }

    for (const frame of frames) {
      if (!this.enabled.includes(frame.player)) continue;
      const p = this.players[frame.player];
      const feat = extractFeatures(frame.landmarks);

      let rawDrive: number | null = null;
      if (feat.valid && feat.confidence >= 0.28) {
        rawDrive = feat.drive;
        p.lastValidDrive = feat.drive;
        p.lastValidAt = frame.timestamp;
      } else if (frame.timestamp - p.lastValidAt < HOLD_VALID_MS && p.lastValidAt > 0) {
        rawDrive = p.lastValidDrive;
      }

      if (rawDrive === null) continue;

      const driveFiltered = p.filter.filter(rawDrive, frame.timestamp);

      let dtSec = 1 / 30;
      if (p.prevTime > 0) {
        dtSec = Math.max(1 / 60, Math.min(0.12, (frame.timestamp - p.prevTime) / 1000));
      }
      const rawVel = (driveFiltered - p.prevDrive) / dtSec;
      p.velocity = p.velFilter.filter(rawVel, frame.timestamp);
      p.prevDrive = driveFiltered;
      p.prevTime = frame.timestamp;

      const idleVel =
        p.profile?.thresholds.idle ?? 0.08;
      if (Math.abs(p.velocity) < idleVel * 1.1) {
        p.driveBaseline += (driveFiltered - p.driveBaseline) * BASELINE_LERP;
      } else {
        p.lastMotionAt = now;
      }

      const drive = driveFiltered - p.driveBaseline;

      // Un joueur déjà calibré continue d'être suivi pendant que les autres
      // terminent : ses filtres et sa ligne de base restent à jour.
      if (this.calibrating && !p.profile) {
        if (!this.calibStrokesOpened) {
          p.calibIdleSamples.push(driveFiltered);
          const waitProgress =
            Math.min(1, (now - this.calibStartedAt) / CALIBRATION_WAIT_MS) *
            CALIB_WAIT_PROGRESS;
          this.emitCalibProgress(frame.player, waitProgress, "wait", 0);
          continue;
        }

        if (!p.calibIdleDone) {
          this.openCalibStrokesForPlayer(p, drive);
        }

        p.calibSamples.push(drive);
        this.detectStroke(p, drive, dtSec, now, frame.player, true);
        continue;
      }

      if (!p.profile) continue;

      this.autoTuneProfile(p, drive, now);

      const strokeTh = p.profile.thresholds.stroke;
      if (Math.abs(p.velocity) > strokeTh * 0.6) {
        if (!p.active) {
          p.active = true;
          this.emit({ type: "PlayerActive", player: frame.player, at: now });
        }
        p.lastMotionAt = now;
      } else if (p.active && now - p.lastMotionAt > 1400) {
        p.active = false;
        this.emit({ type: "PlayerIdle", player: frame.player, at: now });
        this.emit({ type: "ComboLost", player: frame.player, at: now });
        p.cycleState = "catch";
      }

      this.detectStroke(p, drive, dtSec, now, frame.player, false);
    }
  }

  /**
   * Un cycle de rame = une traction + un retour. On compte UN point, au
   * moment de la traction (le signal atteint le haut de sa course), puis
   * plus rien tant que le rameur n'est pas revenu au catch.
   */
  private detectStroke(
    p: PlayerState,
    drive: number,
    dtSec: number,
    now: number,
    player: PlayerId,
    isCalib: boolean,
  ): void {
    const prof = p.profile;
    const minAmp = isCalib ? CALIB_MIN_AMP : prof!.minStrokeAmp;

    if (!isFinite(p.envMax) || !isFinite(p.envMin) || p.envMax < p.envMin) {
      p.envMax = drive;
      p.envMin = drive;
    } else {
      const shrink = (p.envMax - p.envMin) * ENVELOPE_DECAY_PER_SEC * dtSec;
      p.envMax = Math.max(drive, p.envMax - shrink);
      p.envMin = Math.min(drive, p.envMin + shrink);
    }

    const range = p.envMax - p.envMin;

    if (
      !isCalib &&
      prof &&
      p.active &&
      p.lastStrokeAt > 0 &&
      now - p.lastStrokeAt > prof.periodMs * 2.8
    ) {
      p.active = false;
      this.emit({ type: "PlayerIdle", player, at: now });
      this.emit({ type: "ComboLost", player, at: now });
      p.cycleState = "catch";
    }

    // Oscillation trop faible : on est à l'arrêt, aucun coup possible.
    if (range < minAmp) return;

    const norm = (drive - p.envMin) / range;

    if (p.cycleState === "drive") {
      if (norm <= SCHMITT_LOW) p.cycleState = "catch";
      return;
    }

    const canFire =
      now >= p.refractoryUntil &&
      (p.lastStrokeAt <= 0 || now - p.lastStrokeAt >= MIN_STROKE_GAP_MS);

    if (norm >= SCHMITT_HIGH && canFire) {
      this.fireStroke(p, range, now, player, isCalib);
      p.cycleState = "drive";
    }
  }

  private fireStroke(
    p: PlayerState,
    amplitude: number,
    now: number,
    player: PlayerId,
    isCalib: boolean,
  ): void {
    const amp = Math.max(0.01, amplitude);

    if (!isCalib && p.profile && !p.active) {
      // Une traction d'amplitude franche réveille le joueur : on ne perd
      // jamais un vrai mouvement à cause du drapeau d'activité.
      p.active = true;
      p.lastMotionAt = now;
      this.emit({ type: "PlayerActive", player, at: now });
    }

    if (isCalib) {
      p.calibPeakVel.push(Math.abs(p.velocity));
      p.calibStrokeAmps.push(amp);
      p.calibStrokeCount += 1;
      const strokePart = p.calibStrokeCount / CALIBRATION_STROKES;
      const progress =
        CALIB_WAIT_PROGRESS + strokePart * (1 - CALIB_WAIT_PROGRESS);
      this.emitCalibProgress(player, progress, "strokes", p.calibStrokeCount);
      if (p.calibStrokeCount >= CALIBRATION_STROKES) {
        this.finishPlayerCalibration(player, now);
      }
    }

    const periodHint = p.profile?.periodMs ?? 1000;
    const refractory = Math.min(
      REFRACTORY_MAX_MS,
      Math.max(REFRACTORY_MIN_MS, periodHint * REFRACTORY_RATIO),
    );
    p.refractoryUntil = now + refractory;

    if (p.lastStrokeAt > 0) {
      const interval = now - p.lastStrokeAt;
      if (interval > 400 && interval < 2800) {
        p.strokeIntervals.push(interval);
      }
    }
    p.lastStrokeAt = now;

    if (isCalib) return;

    p.windowStrokes += 1;
    const strength = clamp(amp / (p.profile!.amplitudeNorm + 0.02), 0.4, 1);

    this.emit({
      type: "StrokeDetected",
      player,
      strength,
      at: now,
    });
  }

  /**
   * Si le joueur bouge visiblement mais qu'aucun coup ne sort, on assouplit
   * progressivement son profil : le jeu se répare tout seul au lieu de rester bloqué.
   */
  private autoTuneProfile(p: PlayerState, drive: number, now: number): void {
    const prof = p.profile;
    if (!prof) return;

    if (p.windowStart === 0) {
      p.windowStart = now;
      p.windowMin = drive;
      p.windowMax = drive;
      p.windowStrokes = 0;
      return;
    }

    p.windowMin = Math.min(p.windowMin, drive);
    p.windowMax = Math.max(p.windowMax, drive);

    if (now - p.windowStart < AUTOTUNE_WINDOW_MS) return;

    const span = p.windowMax - p.windowMin;
    const moving = span >= Math.max(prof.noiseAmp * 3, 0.05);

    if (moving && p.windowStrokes === 0) {
      prof.minStrokeAmp = Math.max(
        AUTOTUNE_MIN_AMP_FLOOR,
        Math.min(prof.minStrokeAmp * 0.75, span * 0.35),
      );
      prof.amplitudeNorm = Math.max(0.05, Math.min(prof.amplitudeNorm, span * 0.9));
      prof.thresholds.stroke = Math.max(
        AUTOTUNE_VEL_FLOOR,
        prof.thresholds.stroke * 0.75,
      );
      prof.thresholds.idle = Math.max(0.04, prof.thresholds.stroke * 0.2);
    }

    p.windowStart = now;
    p.windowMin = drive;
    p.windowMax = drive;
    p.windowStrokes = 0;
  }

  private tickCalibrationClock(now: number): void {
    const elapsed = now - this.calibStartedAt;
    const secondsLeft = Math.max(
      0,
      Math.ceil((CALIBRATION_WAIT_MS - elapsed) / 1000),
    );

    if (!this.calibStrokesOpened) {
      if (secondsLeft !== this.lastWaitSecondEmitted) {
        this.lastWaitSecondEmitted = secondsLeft;
        this.emit({ type: "CalibrationWait", secondsLeft });
      }
      if (elapsed >= CALIBRATION_WAIT_MS) {
        this.openCalibStrokesPhase();
      }
      return;
    }
  }

  private openCalibStrokesPhase(): void {
    if (this.calibStrokesOpened) return;
    this.calibStrokesOpened = true;
    for (const id of this.enabled) {
      const p = this.players[id];
      if (p.profile) continue;
      this.openCalibStrokesForPlayer(p, 0);
    }
    this.emit({ type: "CalibrationStrokesBegin" });
  }

  private openCalibStrokesForPlayer(p: PlayerState, drive: number): void {
    if (p.calibIdleDone) return;
    const idle = p.calibIdleSamples;
    p.driveBaseline =
      idle.length >= 8 ? median(idle.slice(-60)) : p.driveBaseline;
    p.calibIdleDone = true;
    p.cycleState = "catch";
    p.envMin = drive;
    p.envMax = drive;
  }

  private finishPlayerCalibration(player: PlayerId, now: number): void {
    const p = this.players[player];
    if (p.profile) return;

    const intervals = p.strokeIntervals.filter((i) => i > 350 && i < 2600);
    const periodMs =
      intervals.length >= 2
        ? median(intervals)
        : intervals.length === 1
          ? intervals[0]
          : 1050;

    // L'amplitude de référence vient des coups réellement joués,
    // jamais de la phase d'attente (le joueur y bouge librement).
    const strokeAmps = p.calibStrokeAmps.filter((a) => a > 0.005);
    const ampFromStrokes = strokeAmps.length >= 3 ? median(strokeAmps) : 0;
    const samples = p.calibSamples;
    const ampFromSignal =
      samples.length > 20
        ? percentile(samples, 0.9) - percentile(samples, 0.1)
        : 0;
    const measured = Math.max(ampFromStrokes, ampFromSignal * 0.75);
    const amplitudeNorm = clamp(measured > 0.02 ? measured : 0.11, 0.05, 1.2);

    // Le bruit ne peut jamais dépasser une fraction de l'amplitude utile,
    // sinon plus aucun coup ne passerait le seuil en partie.
    const idle = p.calibIdleSamples;
    const rawNoise =
      idle.length >= 20 ? percentile(idle, 0.75) - percentile(idle, 0.25) : 0.02;
    const noiseAmp = clamp(rawNoise, 0.008, amplitudeNorm * 0.3);

    const minStrokeAmp = clamp(
      Math.max(amplitudeNorm * 0.3, noiseAmp * 1.8),
      0.028,
      amplitudeNorm * 0.55,
    );

    const peakVels = p.calibPeakVel.filter((v) => v > 0.04);
    const velThresh =
      peakVels.length >= 3
        ? clamp(median(peakVels) * 0.3, 0.1, 0.4)
        : 0.14;

    const profile: PlayerRhythmProfile = {
      periodMs: clamp(periodMs, 500, 2200),
      amplitudeNorm,
      noiseAmp,
      minStrokeAmp,
      thresholds: {
        stroke: velThresh,
        idle: Math.max(0.05, velThresh * 0.2),
      },
    };
    p.profile = profile;
    p.lastStrokeAt = 0;
    p.refractoryUntil = now + REFRACTORY_MIN_MS;
    p.cycleState = "catch";
    p.envMin = Infinity;
    p.envMax = -Infinity;
    p.active = false;
    this.emitCalibProgress(player, 1, "ready", CALIBRATION_STROKES);
    this.emit({ type: "CalibrationDone", player, profile });

    if (this.enabled.every((id) => this.players[id].profile !== null)) {
      this.endCalibrationPhase();
    }
  }

  private endCalibrationPhase(): void {
    this.calibrating = false;
    for (const player of ["player1", "player2"] as const) {
      if (this.enabled.includes(player)) continue;
      this.players[player].profile = {
        periodMs: 1100,
        amplitudeNorm: 0.12,
        noiseAmp: 0.02,
        minStrokeAmp: 0.05,
        thresholds: { stroke: 0.18, idle: 0.06 },
      };
    }
  }

  private emitCalibProgress(
    player: PlayerId,
    progress: number,
    phase: CalibrationUiPhase,
    strokesDone: number,
  ): void {
    this.emit({
      type: "CalibrationProgress",
      player,
      progress: Math.min(1, progress),
      phase,
      strokesDone,
      strokesRequired: CALIBRATION_STROKES,
    });
  }

  getProfile(player: PlayerId): PlayerRhythmProfile | null {
    return this.players[player].profile;
  }
}

function median(arr: number[]): number {
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function percentile(arr: number[], p: number): number {
  const s = [...arr].sort((a, b) => a - b);
  const idx = Math.floor(p * (s.length - 1));
  return s[idx];
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}
