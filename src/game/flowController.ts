import type { PlayerId } from "../types/events";
import { multiplierForCombo } from "./combo";

export interface FlowSnapshot {
  /** 0–1 intensité lissée */
  level: number;
  inFlow: boolean;
  overdrive: boolean;
}

const ENTER_STREAK = 4;
const FLOW_ON = 0.52;
const OVERDRIVE_ON = 0.78;

export class FlowController {
  private streak: Record<PlayerId, number> = { player1: 0, player2: 0 };
  private level: Record<PlayerId, number> = { player1: 0, player2: 0 };

  reset(): void {
    this.streak = { player1: 0, player2: 0 };
    this.level = { player1: 0, player2: 0 };
  }

  /** Appelé à chaque coup régulier ou non. Retourne le multiplicateur de score. */
  onStroke(player: PlayerId, regular: boolean, combo: number): number {
    if (regular) {
      this.streak[player]++;
      if (this.streak[player] >= ENTER_STREAK) {
        this.level[player] = Math.min(1, this.level[player] + 0.22);
      } else {
        this.level[player] = Math.min(1, this.level[player] + 0.06);
      }
    } else {
      this.streak[player] = 0;
      this.level[player] = Math.max(0, this.level[player] - 0.38);
    }

    return this.scoreMultiplier(player, combo);
  }

  tick(dtSec: number): void {
    const decay = 0.12 * dtSec;
    for (const id of ["player1", "player2"] as const) {
      if (this.level[id] > 0) {
        this.level[id] = Math.max(0, this.level[id] - decay);
      }
      if (this.level[id] < 0.08) this.streak[id] = 0;
    }
  }

  onComboBreak(player: PlayerId): void {
    this.streak[player] = 0;
    this.level[player] = Math.max(0, this.level[player] - 0.28);
  }

  getSnapshot(player: PlayerId, combo: number): FlowSnapshot {
    const level = this.level[player];
    const inFlow = level >= FLOW_ON;
    const overdrive = inFlow && (level >= OVERDRIVE_ON || multiplierForCombo(combo) >= 10);
    return { level, inFlow, overdrive };
  }

  scoreMultiplier(player: PlayerId, combo: number): number {
    const snap = this.getSnapshot(player, combo);
    if (snap.overdrive) return 1.55;
    if (snap.inFlow) return 1.28;
    return 1;
  }

  /** Énergie musique / FX globale 0–1 */
  matchEnergy(players: PlayerId[], combos: Record<PlayerId, number>): number {
    let e = 0;
    for (const p of players) {
      e = Math.max(e, this.level[p] * 0.7 + multiplierForCombo(combos[p]) / 12);
    }
    return Math.min(1, e);
  }
}
