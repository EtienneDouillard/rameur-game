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

const CALIBRATION_STROKES = 5;
export { CALIBRATION_STROKES };
/** Échantillons au repos avant les 5 coups (par joueur) */
const CALIB_IDLE_MIN_MS = 2200;
const CALIB_IDLE_MIN_SAMPLES = 45;
const HOLD_VALID_MS = 200;
const REFRACTORY_MIN_MS = 380;
const REFRACTORY_MAX_MS = 800;
const REFRACTORY_RATIO = 0.34;
const MIN_STROKE_GAP_MS = 420;
/** Vitesse basse → on recale la ligne de base du signal */
const BASELINE_LERP = 0.04;

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
  calibIdleSamples: number[];
  calibIdleStartedAt: number;
  calibIdleDone: boolean;
  calibPeakVel: number[];
  calibStrokeCount: number;
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
      phase: "rising",
      cyclePeak: -Infinity,
      cycleTrough: Infinity,
      lastStrokeAt: 0,
      strokeIntervals: [],
      calibSamples: [],
      calibIdleSamples: [],
      calibIdleStartedAt: 0,
      calibIdleDone: false,
      calibPeakVel: [],
      calibStrokeCount: 0,
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
    for (const id of ["player1", "player2"] as const) {
      const p = this.players[id];
      p.filter.reset();
      p.velFilter.reset();
      p.calibSamples = [];
      p.calibIdleSamples = [];
      p.calibIdleStartedAt = 0;
      p.calibIdleDone = false;
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
      p.driveBaseline = 0.5;
      p.lastValidAt = 0;
      p.refractoryUntil = 0;
      p.lastStrokeAt = 0;
      p.lastMotionAt = 0;
      p.velocity = 0;
    }
  }

  isCalibrating(): boolean {
    return this.calibrating;
  }

  isPlayerIdleCalibrated(player: PlayerId): boolean {
    return this.players[player].calibIdleDone;
  }

  ingest(frames: PlayerPoseFrame[]): void {
    const now = performance.now();

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

      if (this.calibrating) {
        if (p.profile) continue;

        if (!p.calibIdleDone) {
          if (p.calibIdleStartedAt === 0) p.calibIdleStartedAt = now;
          p.calibIdleSamples.push(driveFiltered);
          const idleMs = now - p.calibIdleStartedAt;
          const idleProgress = Math.min(1, idleMs / CALIB_IDLE_MIN_MS);
          this.emitCalibProgress(
            frame.player,
            idleProgress * 0.22,
            "idle",
            0,
          );
          if (
            idleMs >= CALIB_IDLE_MIN_MS &&
            p.calibIdleSamples.length >= CALIB_IDLE_MIN_SAMPLES
          ) {
            p.calibIdleDone = true;
            p.driveBaseline = median(p.calibIdleSamples.slice(-40));
            p.phase = "rising";
            p.cyclePeak = drive;
            p.cycleTrough = drive;
          }
          continue;
        }

        p.calibSamples.push(drive);
        this.detectStroke(p, drive, now, frame.player, true);
        continue;
      }

      if (!p.profile) continue;

      const strokeTh = p.profile.thresholds.stroke;
      if (Math.abs(p.velocity) > strokeTh * 0.85) {
        if (!p.active) {
          p.active = true;
          this.emit({ type: "PlayerActive", player: frame.player, at: now });
        }
        p.lastMotionAt = now;
      } else if (p.active && now - p.lastMotionAt > 1400) {
        p.active = false;
        this.emit({ type: "PlayerIdle", player: frame.player, at: now });
        this.emit({ type: "ComboLost", player: frame.player, at: now });
        p.phase = "rising";
        p.cyclePeak = drive;
        p.cycleTrough = drive;
      }

      this.detectStroke(p, drive, now, frame.player, false);
    }
  }

  private detectStroke(
    p: PlayerState,
    drive: number,
    now: number,
    player: PlayerId,
    isCalib: boolean,
  ): void {
    const prof = p.profile;
    const vUp = isCalib
      ? 0.17
      : Math.max(0.13, prof!.thresholds.stroke * 0.95);
    const vDown = isCalib
      ? -0.14
      : -Math.max(0.11, prof!.thresholds.stroke * 0.75);
    const minAmp = isCalib
      ? 0.04
      : Math.max(prof!.minStrokeAmp, prof!.amplitudeNorm * 0.32);

    const canFire =
      now >= p.refractoryUntil &&
      (p.lastStrokeAt <= 0 || now - p.lastStrokeAt >= MIN_STROKE_GAP_MS);

    if (p.phase === "rising") {
      p.cyclePeak = Math.max(p.cyclePeak, drive);
      p.cycleTrough = Math.min(p.cycleTrough, drive);

      const span = p.cyclePeak - p.cycleTrough;
      const dropFromPeak = p.cyclePeak - drive;

      if (
        canFire &&
        p.velocity < vDown &&
        span >= minAmp &&
        dropFromPeak >= minAmp * 0.38
      ) {
        this.fireStroke(p, drive, now, player, isCalib);
        p.phase = "falling";
        p.cycleTrough = drive;
        return;
      }

      // Chemin rapide uniquement en calibration
      if (
        isCalib &&
        canFire &&
        p.velocity < vDown * 1.5 &&
        dropFromPeak >= minAmp * 0.28
      ) {
        this.fireStroke(p, drive, now, player, true);
        p.phase = "falling";
        p.cycleTrough = drive;
      }
    } else {
      p.cycleTrough = Math.min(p.cycleTrough, drive);
      if (p.velocity > vUp * 0.55 && drive - p.cycleTrough >= minAmp * 0.22) {
        p.phase = "rising";
        p.cyclePeak = drive;
        p.cycleTrough = drive;
      }
    }

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

    if (!isCalib && p.profile) {
      if (amp < p.profile.minStrokeAmp) {
        p.phase = "rising";
        p.cyclePeak = _drive;
        p.cycleTrough = _drive;
        return;
      }
      if (!p.active) return;
    }

    if (isCalib) {
      p.calibPeakVel.push(Math.abs(p.velocity));
      p.calibStrokeCount += 1;
      const strokePart = p.calibStrokeCount / CALIBRATION_STROKES;
      const progress = 0.22 + strokePart * 0.78;
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

    const strength = Math.min(1, amp / (p.profile!.amplitudeNorm + 0.05));
    if (strength < 0.38) return;

    this.emit({
      type: "StrokeDetected",
      player,
      strength: Math.max(0.38, strength),
      at: now,
    });
  }

  private finishPlayerCalibration(player: PlayerId, now: number): void {
    const p = this.players[player];
    if (p.profile) return;

    const idle = p.calibIdleSamples;
    const noiseAmp =
      idle.length >= 10
        ? percentile(idle, 0.92) - percentile(idle, 0.08)
        : 0.025;

    const intervals = p.strokeIntervals.filter((i) => i > 400 && i < 2500);
    const periodMs =
      intervals.length >= 2
        ? median(intervals)
        : intervals.length === 1
          ? intervals[0]
          : 1050;

    const samples = p.calibSamples;
    const strokeAmp =
      samples.length > 15
        ? percentile(samples, 0.92) - percentile(samples, 0.08)
        : samples.length > 5
          ? percentile(samples, 0.85) - percentile(samples, 0.15)
          : 0.12;

    const amplitudeNorm = Math.max(0.065, strokeAmp, noiseAmp * 2.5);
    const minStrokeAmp = Math.max(noiseAmp * 2.8, amplitudeNorm * 0.38, 0.045);

    const peakVels = p.calibPeakVel.filter((v) => v > 0.05);
    const velThresh =
      peakVels.length >= 2
        ? Math.max(0.14, median(peakVels) * 0.32)
        : 0.18;

    const profile: PlayerRhythmProfile = {
      periodMs: clamp(periodMs, 550, 2000),
      amplitudeNorm,
      noiseAmp: Math.max(0.015, noiseAmp),
      minStrokeAmp,
      thresholds: {
        stroke: velThresh,
        idle: Math.max(0.06, velThresh * 0.2),
      },
    };
    p.profile = profile;
    p.lastStrokeAt = 0;
    p.refractoryUntil = now + REFRACTORY_MIN_MS;
    p.phase = "rising";
    p.cyclePeak = -Infinity;
    p.cycleTrough = Infinity;
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
