import type { GameEvent, PlayerId } from "../types/events";
import type { PlayerCount } from "../types/gameMode";
import { activePlayers } from "../types/gameMode";

const GAME_DURATION_MS = 90_000;

export interface PlayerStats {
  score: number;
  combo: number;
  maxCombo: number;
  strokes: number;
  regularStrokes: number;
  intervals: number[];
  energy: number;
}

export interface GameSnapshot {
  timeLeftMs: number;
  phase: "idle" | "calibrating" | "playing" | "finished";
  player1: PlayerStats;
  player2: PlayerStats;
}

type SnapshotListener = (snap: GameSnapshot) => void;

function emptyStats(): PlayerStats {
  return {
    score: 0,
    combo: 0,
    maxCombo: 0,
    strokes: 0,
    regularStrokes: 0,
    intervals: [],
    energy: 0.35,
  };
}

export class GameSession {
  private phase: GameSnapshot["phase"] = "idle";
  private stats: Record<PlayerId, PlayerStats> = {
    player1: emptyStats(),
    player2: emptyStats(),
  };
  private lastStrokeAt: Record<PlayerId, number> = { player1: 0, player2: 0 };
  private expectedPeriod: Record<PlayerId, number> = { player1: 1100, player2: 1100 };
  private playStart = 0;
  private snapshotListeners = new Set<SnapshotListener>();
  private raf = 0;

  onSnapshot(listener: SnapshotListener): () => void {
    this.snapshotListeners.add(listener);
    return () => this.snapshotListeners.delete(listener);
  }

  getPhase(): GameSnapshot["phase"] {
    return this.phase;
  }

  beginCalibration(playerCount: PlayerCount = 2): void {
    this.phase = "calibrating";
    this.stats.player1 = emptyStats();
    this.stats.player2 = emptyStats();
    this.playerCount = playerCount;
    this.broadcast();
  }

  private playerCount: PlayerCount = 2;

  onGameEvent(event: GameEvent): void {
    if (event.type === "CalibrationDone") {
      this.expectedPeriod[event.player] = event.profile.periodMs;
    }

    if (this.phase !== "playing" && event.type === "StrokeDetected") {
      return;
    }

    switch (event.type) {
      case "StrokeDetected":
        this.handleStroke(event.player, event.strength, event.at);
        break;
      case "ComboLost":
        if (this.playerCount === 2 || event.player === "player1") {
          this.stats[event.player].combo = 0;
          this.stats[event.player].energy = Math.max(
            0.15,
            this.stats[event.player].energy - 0.25,
          );
          this.broadcast();
        }
        break;
      case "CalibrationProgress":
        break;
      default:
        break;
    }
  }

  startPlaying(): void {
    this.phase = "playing";
    this.playStart = performance.now();
    this.tick();
  }

  private tick = (): void => {
    if (this.phase !== "playing") return;
    const elapsed = performance.now() - this.playStart;
    if (elapsed >= GAME_DURATION_MS) {
      this.phase = "finished";
      this.broadcast();
      return;
    }
    for (const id of activePlayers(this.playerCount)) {
      const s = this.stats[id];
      s.energy = Math.max(0.1, s.energy - 0.0008);
    }
    this.broadcast();
    this.raf = requestAnimationFrame(this.tick);
  };

  stop(): void {
    cancelAnimationFrame(this.raf);
  }

  private handleStroke(player: PlayerId, strength: number, at: number): void {
    const s = this.stats[player];
    const last = this.lastStrokeAt[player];
    let regular = true;
    if (last > 0) {
      const dt = at - last;
      s.intervals.push(dt);
      const period = this.expectedPeriod[player];
      const lo = period * 0.78;
      const hi = period * 1.22;
      regular = dt >= lo && dt <= hi;
      if (regular) {
        s.combo = Math.min(s.combo + 1, 12);
        s.regularStrokes++;
      } else {
        s.combo = 0;
      }
    } else {
      s.combo = 1;
    }
    s.maxCombo = Math.max(s.maxCombo, s.combo);
    s.strokes++;
    this.lastStrokeAt[player] = at;

    const mult = multiplierForCombo(s.combo);
    const points = Math.round(100 * strength * mult);
    s.score += points;
    s.energy = Math.min(1, s.energy + 0.12 + strength * 0.15);

    this.broadcast();
  }

  private broadcast(): void {
    const snap = this.getSnapshot();
    for (const l of this.snapshotListeners) l(snap);
  }

  getSnapshot(): GameSnapshot {
    const elapsed =
      this.phase === "playing" ? performance.now() - this.playStart : GAME_DURATION_MS;
    const timeLeftMs = Math.max(0, GAME_DURATION_MS - elapsed);
    return {
      timeLeftMs,
      phase: this.phase,
      player1: { ...this.stats.player1 },
      player2: { ...this.stats.player2 },
    };
  }

  regularityPercent(player: PlayerId): number {
    const s = this.stats[player];
    if (s.strokes === 0) return 0;
    return Math.round((s.regularStrokes / s.strokes) * 100);
  }

  rhythmPrecision(player: PlayerId): number {
    const s = this.stats[player];
    if (s.intervals.length < 2) return s.strokes > 0 ? 70 : 0;
    const period = this.expectedPeriod[player];
    const deviations = s.intervals.map((i) => Math.abs(i - period) / period);
    const meanDev = deviations.reduce((a, b) => a + b, 0) / deviations.length;
    return Math.round(Math.max(0, 100 - meanDev * 120));
  }
}

export function multiplierForCombo(combo: number): number {
  if (combo >= 10) return 10;
  if (combo >= 7) return 5;
  if (combo >= 5) return 3;
  if (combo >= 3) return 2;
  return 1;
}

export function comboLabel(combo: number): string {
  const m = multiplierForCombo(combo);
  return m > 1 ? `×${m}` : "";
}
