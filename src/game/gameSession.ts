import type { GameEvent, PlayerId } from "../types/events";
import type { PlayerCount } from "../types/gameMode";
import { DEFAULT_MATCH_DURATION_SEC, type MatchDurationSec } from "../types/matchDuration";
import { FlowController, type FlowSnapshot, FLOW_CHARGE_STROKES, FLOW_BOOST_STROKES } from "./flowController";
import { multiplierForCombo } from "./combo";

const FINAL_RUSH_MS = 10_000;

export interface PlayerStats {
  score: number;
  combo: number;
  maxCombo: number;
  strokes: number;
  regularStrokes: number;
  intervals: number[];
  energy: number;
  flow: FlowSnapshot;
}

export interface GameSnapshot {
  timeLeftMs: number;
  phase: "idle" | "calibrating" | "playing" | "finished";
  player1: PlayerStats;
  player2: PlayerStats;
  tugPercent: number;
  finalRush: boolean;
  matchDurationSec: number;
}

type SnapshotListener = (snap: GameSnapshot) => void;

function emptyStats(): PlayerStats {
  const flow: FlowSnapshot = {
    barFill: 0,
    inFlow: false,
    chargeProgress: 0,
    chargeRequired: FLOW_CHARGE_STROKES,
    boostStrokesLeft: 0,
    boostStrokesTotal: FLOW_BOOST_STROKES,
    scoreMultiplier: 1,
    intensity: 0,
  };
  return {
    score: 0,
    combo: 0,
    maxCombo: 0,
    strokes: 0,
    regularStrokes: 0,
    intervals: [],
    energy: 0.35,
    flow,
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
  private playerCount: PlayerCount = 2;
  private flow = new FlowController();
  private lastTick = 0;
  private matchDurationMs = DEFAULT_MATCH_DURATION_SEC * 1000;

  setMatchDurationSec(sec: MatchDurationSec): void {
    this.matchDurationMs = sec * 1000;
  }

  getMatchDurationSec(): number {
    return this.matchDurationMs / 1000;
  }

  onSnapshot(listener: SnapshotListener): () => void {
    this.snapshotListeners.add(listener);
    return () => this.snapshotListeners.delete(listener);
  }

  getPhase(): GameSnapshot["phase"] {
    return this.phase;
  }

  beginCalibration(playerCount: PlayerCount = 2, durationSec: MatchDurationSec = DEFAULT_MATCH_DURATION_SEC): void {
    this.phase = "calibrating";
    this.stats.player1 = emptyStats();
    this.stats.player2 = emptyStats();
    this.playerCount = playerCount;
    this.matchDurationMs = durationSec * 1000;
    this.flow.reset();
    this.broadcast();
  }

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
          this.flow.onComboBreak(event.player);
          this.syncFlowStats();
          this.broadcast();
        }
        break;
      default:
        break;
    }
  }

  startPlaying(): void {
    this.phase = "playing";
    this.playStart = performance.now();
    this.lastTick = this.playStart;
    this.tick();
  }

  private tick = (): void => {
    if (this.phase !== "playing") return;
    const now = performance.now();
    const dt = (now - this.lastTick) / 1000;
    this.lastTick = now;

    const elapsed = now - this.playStart;
    if (elapsed >= this.matchDurationMs) {
      this.phase = "finished";
      this.broadcast();
      return;
    }

    this.flow.tick(dt);
    this.syncFlowStats();
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
    let flowRegular = false;
    if (last > 0) {
      const dt = at - last;
      s.intervals.push(dt);
      const period = this.expectedPeriod[player];
      const lo = period * 0.72;
      const hi = period * 1.28;
      regular = dt >= lo && dt <= hi;
      const flowLo = period * 0.78;
      const flowHi = period * 1.22;
      flowRegular = dt >= flowLo && dt <= flowHi;
      if (regular) {
        s.combo = Math.min(s.combo + 1, 12);
        s.regularStrokes++;
      } else {
        s.combo = 0;
      }
    } else {
      s.combo = 1;
      flowRegular = true;
    }
    s.maxCombo = Math.max(s.maxCombo, s.combo);
    s.strokes++;
    this.lastStrokeAt[player] = at;

    const mult = multiplierForCombo(s.combo);
    const flowMult = this.flow.onStroke(player, flowRegular);
    const points = Math.round(100 * strength * mult * flowMult);
    s.score += points;
    this.syncFlowStats();

    this.broadcast();
  }

  private syncFlowStats(): void {
    for (const id of ["player1", "player2"] as const) {
      const flow = this.flow.getSnapshot(id);
      this.stats[id].flow = flow;
      this.stats[id].energy = flow.barFill;
    }
  }

  private broadcast(): void {
    const snap = this.getSnapshot();
    for (const l of this.snapshotListeners) l(snap);
  }

  getSnapshot(): GameSnapshot {
    const elapsed =
      this.phase === "playing" ? performance.now() - this.playStart : this.matchDurationMs;
    const timeLeftMs = Math.max(0, this.matchDurationMs - elapsed);
    const finalRush = timeLeftMs <= FINAL_RUSH_MS && this.phase === "playing";

    const s1 = this.stats.player1.score;
    const s2 = this.stats.player2.score;
    const total = s1 + s2 + 1;
    const tugPercent = this.playerCount === 1 ? 50 : 15 + (70 * s1) / total;

    return {
      timeLeftMs,
      phase: this.phase,
      player1: { ...this.stats.player1, flow: { ...this.stats.player1.flow } },
      player2: { ...this.stats.player2, flow: { ...this.stats.player2.flow } },
      tugPercent,
      finalRush,
      matchDurationSec: this.matchDurationMs / 1000,
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

export function strokeRateSpm(intervals: number[]): number {
  if (intervals.length === 0) return 0;
  const recent = intervals.slice(-5);
  const avg = recent.reduce((a, b) => a + b, 0) / recent.length;
  if (avg < 250) return 0;
  return Math.min(60, Math.round(60000 / avg));
}

export { multiplierForCombo, comboLabel } from "./combo";
