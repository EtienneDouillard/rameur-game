import type { PlayerId } from "../types/events";

/** Coups réguliers consécutifs (rythme serré) pour entrer en flow */
export const FLOW_CHARGE_STROKES = 7;
/** Coups en flow avec multiplicateur de score */
export const FLOW_BOOST_STROKES = 10;
const FLOW_SCORE_MULT = 1.45;

export interface FlowSnapshot {
  /** Remplissage jauge latérale 0–1 */
  barFill: number;
  inFlow: boolean;
  /** Progression vers le flow (0–7) quand pas en flow */
  chargeProgress: number;
  chargeRequired: number;
  /** Coups de boost restants en flow (10 → 0) */
  boostStrokesLeft: number;
  boostStrokesTotal: number;
  /** Multiplicateur de score actuel (flow ou 1) */
  scoreMultiplier: number;
  /** Alias visuel caméra / FX (0–1) */
  intensity: number;
}

interface PlayerFlowState {
  charge: number;
  inFlow: boolean;
  boostLeft: number;
}

export class FlowController {
  private state: Record<PlayerId, PlayerFlowState> = {
    player1: this.empty(),
    player2: this.empty(),
  };

  private empty(): PlayerFlowState {
    return { charge: 0, inFlow: false, boostLeft: 0 };
  }

  reset(): void {
    this.state.player1 = this.empty();
    this.state.player2 = this.empty();
  }

  /**
   * @param flowRegular coup dans une fenêtre de rythme plus stricte (pour le flow)
   */
  onStroke(player: PlayerId, flowRegular: boolean): number {
    const s = this.state[player];

    if (s.inFlow) {
      if (!flowRegular) {
        this.resetPlayer(player);
        return 1;
      }
      const mult = FLOW_SCORE_MULT;
      s.boostLeft -= 1;
      if (s.boostLeft <= 0) {
        s.inFlow = false;
        s.charge = 0;
        s.boostLeft = 0;
      }
      return mult;
    }

    if (flowRegular) {
      s.charge += 1;
      if (s.charge >= FLOW_CHARGE_STROKES) {
        s.inFlow = true;
        s.boostLeft = FLOW_BOOST_STROKES;
        s.charge = 0;
        return 1;
      }
    } else {
      s.charge = 0;
    }

    return 1;
  }

  tick(_dtSec: number): void {
    /* pas de décroissance passive : tout passe par les coups */
  }

  onComboBreak(player: PlayerId): void {
    this.resetPlayer(player);
  }

  private resetPlayer(player: PlayerId): void {
    this.state[player] = this.empty();
  }

  getSnapshot(player: PlayerId): FlowSnapshot {
    const s = this.state[player];
    const inFlow = s.inFlow && s.boostLeft > 0;

    let barFill: number;
    if (inFlow) {
      barFill = s.boostLeft / FLOW_BOOST_STROKES;
    } else {
      barFill = s.charge / FLOW_CHARGE_STROKES;
    }

    const intensity = inFlow ? 0.55 + (s.boostLeft / FLOW_BOOST_STROKES) * 0.45 : barFill * 0.5;

    return {
      barFill,
      inFlow,
      chargeProgress: s.charge,
      chargeRequired: FLOW_CHARGE_STROKES,
      boostStrokesLeft: inFlow ? s.boostLeft : 0,
      boostStrokesTotal: FLOW_BOOST_STROKES,
      scoreMultiplier: inFlow ? FLOW_SCORE_MULT : 1,
      intensity,
    };
  }

  scoreMultiplier(player: PlayerId): number {
    return this.getSnapshot(player).scoreMultiplier;
  }

  matchEnergy(players: PlayerId[]): number {
    let e = 0;
    for (const p of players) {
      const snap = this.getSnapshot(p);
      e = Math.max(e, snap.inFlow ? 0.85 : snap.barFill * 0.7);
    }
    return Math.min(1, e);
  }
}
