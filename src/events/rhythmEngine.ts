import type {
  GameEvent,
  GameEventListener,
  PlayerId,
  PlayerPoseFrame,
  PlayerRhythmProfile,
} from "../types/events";
import { activePlayers, type PlayerCount } from "../types/gameMode";
import { extractFeatures } from "./features";
import { OneEuroFilter } from "./oneEuro";

const CALIBRATION_STROKES = 5;
/** Garder le dernier drive valide si la pose flicker (ms) */
const HOLD_VALID_MS = 180;
/**
 * Refractory : un vrai coup de rame dure ~0,6–1,4 s.
 * Trop bas → 1 mouvement = 2–4 coups (bruit / demi-cycles).
 */
const REFRACTORY_MIN_MS = 520;
const REFRACTORY_MAX_MS = 900;
const REFRACTORY_RATIO = 0.42;
/** Intervalle dur minimum entre deux coups comptés */
const MIN_STROKE_GAP_MS = 480;

interface PlayerState {
  filter: OneEuroFilter;
  velFilter: OneEuroFilter;
  prevDrive: number;
  prevTime: number;
  /** rising | falling cycle */
  phase: "rising" | "falling";
  cyclePeak: number;
  cycleTrough: number;
  lastStrokeAt: number;
  strokeIntervals: number[];
  calibSamples: number[];
  calibPeakVel: number[];
  calibStrokeCount: number;
  profile: PlayerRhythmProfile | null;
  active: boolean;
  refractoryUntil: number;
  lastValidDrive: number;
  lastValidAt: number;
  /** Velocité filtrée (unités / s) */
  velocity: number;
}

export class RhythmEngine {
  private listeners = new Set<GameEventListener>();
  private players: Record<PlayerId, PlayerState>;
  private calibrating = false;
  private enabled: PlayerId[] = ["player1", "player2"];

  constructor() {
    this.players = {
      player1: this.newPlayerState(),
      player2: this.newPlayerState(),
    };
  }

  private newPlayerState(): PlayerState {
    return {
      filter: new OneEuroFilter(2.2, 0.04, 1.2),
      velFilter: new OneEuroFilter(1.8, 0.08, 1),
      prevDrive: 0,
      prevTime: 0,
      phase: "rising",
      cyclePeak: -Infinity,
      cycleTrough: Infinity,
      lastStrokeAt: 0,
      strokeIntervals: [],
      calibSamples: [],
      calibPeakVel: [],
      calibStrokeCount: 0,
      profile: null,
      active: false,
      refractoryUntil: 0,
      lastValidDrive: 0,
      lastValidAt: 0,
      velocity: 0,
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
    for (const id of ["player1", "player2"] as const) {
      const p = this.players[id];
      p.filter.reset();
      p.velFilter.reset();
      p.calibSamples = [];
      p.calibPeakVel = [];
      p.calibStrokeCount = 0;
      p.profile = null;
      p.strokeIntervals = [];
      p.phase = "rising";
      p.cyclePeak = -Infinity;
      p.cycleTrough = Infinity;
      p.active = false;
      p.prevTime = 0;
      p.lastValidAt = 0;
      p.refractoryUntil = 0;
      p.lastStrokeAt = 0;
    }
  }

  isCalibrating(): boolean {
    return this.calibrating;
  }

  ingest(frames: PlayerPoseFrame[]): void {
    const now = performance.now();

    for (const frame of frames) {
      if (!this.enabled.includes(frame.player)) continue;
      const p = this.players[frame.player];
      const feat = extractFeatures(frame.landmarks);

      let rawDrive: number | null = null;
      if (feat.valid && feat.confidence >= 0.32) {
        rawDrive = feat.drive;
        p.lastValidDrive = feat.drive;
        p.lastValidAt = frame.timestamp;
      } else if (frame.timestamp - p.lastValidAt < HOLD_VALID_MS && p.lastValidAt > 0) {
        rawDrive = p.lastValidDrive;
      }

      if (rawDrive === null) continue;

      const drive = p.filter.filter(rawDrive, frame.timestamp);

      let dtSec = 1 / 30;
      if (p.prevTime > 0) {
        dtSec = Math.max(1 / 60, Math.min(0.12, (frame.timestamp - p.prevTime) / 1000));
      }
      const rawVel = (drive - p.prevDrive) / dtSec;
      p.velocity = p.velFilter.filter(rawVel, frame.timestamp);
      p.prevDrive = drive;
      p.prevTime = frame.timestamp;

      if (this.calibrating) {
        p.calibSamples.push(drive);
        this.detectStroke(p, drive, now, frame.player, true);
        continue;
      }

      if (!p.profile) continue;

      if (!p.active && Math.abs(p.velocity) > p.profile.thresholds.idle) {
        p.active = true;
        this.emit({ type: "PlayerActive", player: frame.player, at: now });
      }

      this.detectStroke(p, drive, now, frame.player, false);
    }
  }

  /**
   * Détection par croisement de pic (rising → falling).
   * Velocité en unités/seconde (indépendante du FPS).
   */
  private detectStroke(
    p: PlayerState,
    drive: number,
    now: number,
    player: PlayerId,
    isCalib: boolean,
  ): void {
    const vUp = isCalib
      ? 0.22
      : Math.max(0.16, p.profile!.thresholds.stroke);
    const vDown = isCalib
      ? -0.18
      : -Math.max(0.14, p.profile!.thresholds.stroke * 0.85);
    const minAmp = isCalib
      ? 0.055
      : Math.max(0.045, p.profile!.amplitudeNorm * 0.38);

    if (p.phase === "rising") {
      p.cyclePeak = Math.max(p.cyclePeak, drive);
      p.cycleTrough = Math.min(p.cycleTrough, drive);

      // Un seul chemin : pic clair (montée → descente) avec amplitude réelle
      const span = p.cyclePeak - p.cycleTrough;
      const dropFromPeak = p.cyclePeak - drive;
      if (
        now >= p.refractoryUntil &&
        (p.lastStrokeAt <= 0 || now - p.lastStrokeAt >= MIN_STROKE_GAP_MS) &&
        p.velocity < vDown &&
        span >= minAmp &&
        dropFromPeak >= minAmp * 0.4
      ) {
        this.fireStroke(p, drive, now, player, isCalib);
        p.phase = "falling";
        p.cycleTrough = drive;
      }
    } else {
      // falling : attendre une vraie remontée avant le prochain cycle
      p.cycleTrough = Math.min(p.cycleTrough, drive);
      if (p.velocity > vUp * 0.7 && drive - p.cycleTrough >= minAmp * 0.25) {
        p.phase = "rising";
        p.cyclePeak = drive;
        p.cycleTrough = drive;
      }
    }

    if (
      !isCalib &&
      p.profile &&
      p.active &&
      p.lastStrokeAt > 0 &&
      now - p.lastStrokeAt > p.profile.periodMs * 2.6
    ) {
      p.active = false;
      this.emit({ type: "PlayerIdle", player, at: now });
      this.emit({ type: "ComboLost", player, at: now });
      p.phase = "rising";
      p.cyclePeak = drive;
      p.cycleTrough = drive;
    }
  }

  private fireStroke(
    p: PlayerState,
    _drive: number,
    now: number,
    player: PlayerId,
    isCalib: boolean,
  ): void {
    const amp = Math.max(0.01, p.cyclePeak - p.cycleTrough);
    if (isCalib) {
      p.calibPeakVel.push(Math.abs(p.velocity));
      p.calibStrokeCount += 1;
      const progress = Math.min(1, p.calibStrokeCount / CALIBRATION_STROKES);
      this.emit({ type: "CalibrationProgress", player, progress });
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
      if (interval > 320 && interval < 2800) {
        p.strokeIntervals.push(interval);
      }
    }
    p.lastStrokeAt = now;

    const strength = isCalib
      ? Math.min(1, amp * 4)
      : Math.min(1, amp / (p.profile!.amplitudeNorm + 0.05));

    // Pendant la calib : progresser sans spammer le gameplay
    if (isCalib) return;

    this.emit({
      type: "StrokeDetected",
      player,
      strength: Math.max(0.25, strength),
      at: now,
    });
  }

  private finishPlayerCalibration(player: PlayerId, now: number): void {
    const p = this.players[player];
    if (p.profile) return;

    const intervals = p.strokeIntervals.filter((i) => i > 400 && i < 2500);
    const periodMs =
      intervals.length >= 2
        ? median(intervals)
        : intervals.length === 1
          ? intervals[0]
          : 1050;

    const samples = p.calibSamples;
    const amp =
      samples.length > 15
        ? percentile(samples, 0.92) - percentile(samples, 0.08)
        : samples.length > 5
          ? percentile(samples, 0.85) - percentile(samples, 0.15)
          : 0.12;

    const peakVels = p.calibPeakVel.filter((v) => v > 0.05);
    const velThresh =
      peakVels.length >= 2
        ? Math.max(0.12, median(peakVels) * 0.28)
        : 0.2;

    const profile: PlayerRhythmProfile = {
      periodMs: clamp(periodMs, 550, 2000),
      amplitudeNorm: Math.max(0.06, amp),
      thresholds: {
        stroke: velThresh,
        idle: Math.max(0.06, velThresh * 0.25),
      },
    };
    p.profile = profile;
    p.lastStrokeAt = 0;
    p.refractoryUntil = now + REFRACTORY_MIN_MS;
    p.phase = "rising";
    p.cyclePeak = -Infinity;
    p.cycleTrough = Infinity;
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
        thresholds: { stroke: 0.2, idle: 0.06 },
      };
    }
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
