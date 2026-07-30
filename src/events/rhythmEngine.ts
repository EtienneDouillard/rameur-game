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
/** Hold du dernier drive valide si la pose flicker */
const HOLD_VALID_MS = 220;
/**
 * Anti double-coup sans rater les vrais coups de rame (~0,7–1,3 s).
 * Trop haut → on rate des coups ; trop bas → 1 move = 2–4.
 */
const REFRACTORY_MIN_MS = 360;
const REFRACTORY_MAX_MS = 780;
const REFRACTORY_RATIO = 0.32;
const MIN_STROKE_GAP_MS = 400;

interface PlayerState {
  filter: OneEuroFilter;
  velFilter: OneEuroFilter;
  prevDrive: number;
  prevTime: number;
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
      // Un peu plus réactif pour suivre les pics de rame
      filter: new OneEuroFilter(2.6, 0.035, 1.15),
      velFilter: new OneEuroFilter(2.0, 0.07, 1),
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
      p.prevDrive = 0;
      p.lastValidAt = 0;
      p.refractoryUntil = 0;
      p.lastStrokeAt = 0;
      p.velocity = 0;
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
      if (feat.valid && feat.confidence >= 0.25) {
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
        // Ne plus compter les coups d'un joueur déjà calibré
        if (p.profile) continue;
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
   * Pic rising→falling. Deux chemins (clair + rapide) + gap mini anti-doublon.
   */
  private detectStroke(
    p: PlayerState,
    drive: number,
    now: number,
    player: PlayerId,
    isCalib: boolean,
  ): void {
    const vUp = isCalib
      ? 0.16
      : Math.max(0.11, p.profile!.thresholds.stroke * 0.9);
    const vDown = isCalib
      ? -0.13
      : -Math.max(0.09, p.profile!.thresholds.stroke * 0.7);
    const minAmp = isCalib
      ? 0.032
      : Math.max(0.028, p.profile!.amplitudeNorm * 0.3);

    const canFire =
      now >= p.refractoryUntil &&
      (p.lastStrokeAt <= 0 || now - p.lastStrokeAt >= MIN_STROKE_GAP_MS);

    if (p.phase === "rising") {
      p.cyclePeak = Math.max(p.cyclePeak, drive);
      p.cycleTrough = Math.min(p.cycleTrough, drive);

      const span = p.cyclePeak - p.cycleTrough;
      const dropFromPeak = p.cyclePeak - drive;

      // Chemin principal : pic net
      if (
        canFire &&
        p.velocity < vDown &&
        span >= minAmp * 0.55 &&
        dropFromPeak >= minAmp * 0.32
      ) {
        this.fireStroke(p, drive, now, player, isCalib);
        p.phase = "falling";
        p.cycleTrough = drive;
        return;
      }

      // Chemin rapide : grosse descente même si le pic est partiel
      if (
        canFire &&
        p.velocity < vDown * 1.55 &&
        p.cyclePeak > -Infinity &&
        dropFromPeak >= minAmp * 0.2
      ) {
        this.fireStroke(p, drive, now, player, isCalib);
        p.phase = "falling";
        p.cycleTrough = drive;
      }
    } else {
      p.cycleTrough = Math.min(p.cycleTrough, drive);
      // Remontée pour armer le prochain cycle (pas trop exigeant)
      if (p.velocity > vUp * 0.5) {
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
      now - p.lastStrokeAt > p.profile.periodMs * 2.8
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
      if (interval > 380 && interval < 2800) {
        p.strokeIntervals.push(interval);
      }
    }
    p.lastStrokeAt = now;

    const strength = isCalib
      ? Math.min(1, amp * 4)
      : Math.min(1, amp / (p.profile!.amplitudeNorm + 0.05));

    // Calib : pas d'événement gameplay (évite le spam au lancement)
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

    const peakVels = p.calibPeakVel.filter((v) => v > 0.04);
    // Seuil un peu plus bas → mieux suit les coups après calib
    const velThresh =
      peakVels.length >= 2
        ? Math.max(0.1, median(peakVels) * 0.24)
        : 0.16;

    const profile: PlayerRhythmProfile = {
      periodMs: clamp(periodMs, 550, 2000),
      amplitudeNorm: Math.max(0.055, amp),
      thresholds: {
        stroke: velThresh,
        idle: Math.max(0.05, velThresh * 0.22),
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
        thresholds: { stroke: 0.16, idle: 0.05 },
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
