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

const CALIBRATION_MS = 5000;

interface PlayerState {
  filter: OneEuroFilter;
  prevDrive: number;
  phase: "high" | "low";
  lastStrokeAt: number;
  strokeIntervals: number[];
  calibSamples: number[];
  calibPeaks: number[];
  profile: PlayerRhythmProfile | null;
  active: boolean;
  refractoryUntil: number;
}

export class RhythmEngine {
  private listeners = new Set<GameEventListener>();
  private players: Record<PlayerId, PlayerState>;
  private calibrating = false;
  private calibStart = 0;
  private enabled: PlayerId[] = ["player1", "player2"];

  constructor() {
    this.players = {
      player1: this.newPlayerState(),
      player2: this.newPlayerState(),
    };
  }

  private newPlayerState(): PlayerState {
    return {
      filter: new OneEuroFilter(1.4, 0.05),
      prevDrive: 0,
      phase: "low",
      lastStrokeAt: 0,
      strokeIntervals: [],
      calibSamples: [],
      calibPeaks: [],
      profile: null,
      active: false,
      refractoryUntil: 0,
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
    this.calibStart = performance.now();
    for (const id of ["player1", "player2"] as const) {
      const p = this.players[id];
      p.filter.reset();
      p.calibSamples = [];
      p.calibPeaks = [];
      p.profile = null;
      p.strokeIntervals = [];
      p.phase = "low";
      p.active = false;
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
      if (!feat.valid) continue;

      const drive = p.filter.filter(feat.drive, frame.timestamp);
      const velocity = drive - p.prevDrive;
      p.prevDrive = drive;

      if (this.calibrating) {
        p.calibSamples.push(drive);
        this.detectStrokeCalibration(p, drive, velocity, now, frame.player);
        const progress = Math.min(1, (now - this.calibStart) / CALIBRATION_MS);
        this.emit({ type: "CalibrationProgress", player: frame.player, progress });
        continue;
      }

      if (!p.profile) continue;

      if (!p.active && Math.abs(velocity) > 0.008) {
        p.active = true;
        this.emit({ type: "PlayerActive", player: frame.player, at: now });
      }

      this.detectStrokeGameplay(p, drive, velocity, now, frame.player);
    }

    if (this.calibrating && now - this.calibStart >= CALIBRATION_MS) {
      this.finishCalibration(now);
    }
  }

  private detectStrokeCalibration(
    p: PlayerState,
    drive: number,
    velocity: number,
    now: number,
    player: PlayerId,
  ): void {
    if (now < p.refractoryUntil) return;

    if (p.phase === "low" && velocity > 0.012 && drive > 0.35) {
      p.phase = "high";
    }
    if (p.phase === "high" && velocity < -0.01) {
      p.phase = "low";
      p.calibPeaks.push(drive);
      p.refractoryUntil = now + 180;
      if (p.lastStrokeAt > 0) {
        p.strokeIntervals.push(now - p.lastStrokeAt);
      }
      p.lastStrokeAt = now;
      this.emit({
        type: "StrokeDetected",
        player,
        strength: Math.min(1, drive),
        at: now,
      });
    }
  }

  private finishCalibration(now: number): void {
    this.calibrating = false;
    for (const player of this.enabled) {
      const p = this.players[player];
      const intervals = p.strokeIntervals.filter((i) => i > 400 && i < 2500);
      const periodMs =
        intervals.length >= 2
          ? median(intervals)
          : intervals.length === 1
            ? intervals[0]
            : 1100;

      const samples = p.calibSamples;
      const amp =
        samples.length > 10
          ? percentile(samples, 0.9) - percentile(samples, 0.1)
          : 0.15;

      const profile: PlayerRhythmProfile = {
        periodMs,
        amplitudeNorm: Math.max(0.08, amp),
        thresholds: {
          stroke: 0.012,
          idle: 0.004,
        },
      };
      p.profile = profile;
      p.lastStrokeAt = 0;
      p.refractoryUntil = now + periodMs * 0.35;
      this.emit({ type: "CalibrationDone", player, profile });
    }
    for (const player of ["player1", "player2"] as const) {
      if (this.enabled.includes(player)) continue;
      const profile: PlayerRhythmProfile = {
        periodMs: 1100,
        amplitudeNorm: 0.15,
        thresholds: { stroke: 0.012, idle: 0.004 },
      };
      this.players[player].profile = profile;
    }
  }

  private detectStrokeGameplay(
    p: PlayerState,
    drive: number,
    velocity: number,
    now: number,
    player: PlayerId,
  ): void {
    const profile = p.profile!;
    if (now < p.refractoryUntil) return;

    if (p.phase === "low" && velocity > profile.thresholds.stroke && drive > 0.3) {
      p.phase = "high";
    }
    if (p.phase === "high" && velocity < -profile.thresholds.stroke * 0.85) {
      p.phase = "low";
      p.refractoryUntil = now + profile.periodMs * 0.35;

      p.lastStrokeAt = now;

      const strength = Math.min(1, drive / (profile.amplitudeNorm + 0.2));
      this.emit({
        type: "StrokeDetected",
        player,
        strength,
        at: now,
      });
    }

    if (p.active && p.lastStrokeAt > 0 && now - p.lastStrokeAt > profile.periodMs * 2.2) {
      p.active = false;
      this.emit({ type: "PlayerIdle", player, at: now });
      this.emit({ type: "ComboLost", player, at: now });
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
