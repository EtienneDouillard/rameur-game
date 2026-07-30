import type { GameEvent, PlayerId } from "../types/events";
import type { PlayerCount } from "../types/gameMode";
import { activePlayers } from "../types/gameMode";
import { FlowController, type FlowSnapshot } from "./flowController";
import { multiplierForCombo } from "./combo";

const GAME_DURATION_MS = 90_000;
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
}

type SnapshotListener = (snap: GameSnapshot) => void;

function emptyStats(): PlayerStats {
  const flow = { level: 0, inFlow: false, overdrive: false };
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
          this.stats[event.player].energy = Math.max(
            0.15,
            this.stats[event.player].energy - 0.25,
          );
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
    if (elapsed >= GAME_DURATION_MS) {
      this.phase = "finished";
      this.broadcast();
      return;
    }

    this.flow.tick(dt);
    for (const id of activePlayers(this.playerCount)) {
      const s = this.stats[id];
      s.energy = Math.max(0.1, s.energy - 0.0008);
    }
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
    const flowMult = this.flow.onStroke(player, regular, s.combo);
    const points = Math.round(100 * strength * mult * flowMult);
    s.score += points;
    s.energy = Math.min(1, s.energy + 0.12 + strength * 0.15);
    this.syncFlowStats();

    this.broadcast();
  }

  private syncFlowStats(): void {
    for (const id of ["player1", "player2"] as const) {
      this.stats[id].flow = this.flow.getSnapshot(id, this.stats[id].combo);
    }
  }

  getMusicEnergy(): { energy: number; finalRush: boolean } {
    const snap = this.getSnapshot();
    if (snap.phase !== "playing") return { energy: 0.1, finalRush: false };
    const combos = { player1: snap.player1.combo, player2: snap.player2.combo };
    const energy = this.flow.matchEnergy(activePlayers(this.playerCount), combos);
    const comboBoost =
      Math.max(multiplierForCombo(combos.player1), multiplierForCombo(combos.player2)) / 10;
    return {
      energy: Math.min(1, energy + comboBoost + (snap.finalRush ? 0.25 : 0)),
      finalRush: snap.finalRush,
    };
  }

  private broadcast(): void {
    const snap = this.getSnapshot();
    for (const l of this.snapshotListeners) l(snap);
  }

  getSnapshot(): GameSnapshot {
    const elapsed =
      this.phase === "playing" ? performance.now() - this.playStart : GAME_DURATION_MS;
    const timeLeftMs = Math.max(0, GAME_DURATION_MS - elapsed);
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

export { multiplierForCombo, comboLabel } from "./combo";
