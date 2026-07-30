/**
 * Voix d'Ulysse — phrases selon la montée vers le flow / le vent arrière.
 * Un seul hint à l'écran ; on varie le texte pour creuser l'univers.
 */

export type OdysseyMoment =
  | "idle"
  | "charge_low" // 1–2 / 7
  | "charge_mid" // 3–4 / 7
  | "charge_high" // 5–6 / 7
  | "flow_enter"
  | "flow_boost"
  | "flow_end"
  | "break"
  | "final_rush";

const LINES: Record<Exclude<OdysseyMoment, "idle">, string[]> = {
  charge_low: [
    "Ramez, marins…",
    "Le rythme, avant tout.",
    "Posez vos rames dans l'eau.",
    "Écoutez la mer.",
  ],
  charge_mid: [
    "Tenez le pas, équipage !",
    "Bâbord, tribord — même souffle.",
    "La vague nous porte…",
    "Ne lâchez pas le tempo.",
    "Ulysse vous regarde.",
  ],
  charge_high: [
    "À l'unisson, marins !",
    "Encore ! Le vent s'éveille…",
    "Ithaque n'est plus loin !",
    "Un dernier effort — le voile gonfle !",
    "Serrons le rythme !",
  ],
  flow_enter: [
    "VENT ARRIÈRE !",
    "Les dieux nous sourient !",
    "Voile ouverte — ramez plus fort !",
    "Le souffle de Poseidon !",
  ],
  flow_boost: [
    "Surfez sur la crête !",
    "Chaque coup nous rapproche d'Ithaque.",
    "Ne brisez pas le charme…",
    "La mer obéit !",
    "Gardez ce vent !",
    "Héros de la rame !",
  ],
  flow_end: [
    "Le vent s'essouffle…",
    "Reprenez le rythme, équipage.",
    "La mer reprend ses droits.",
  ],
  break: [
    "Ne cédez pas !",
    "Le rythme s'est brisé…",
    "Relevez les rames.",
    "Ulysse n'abandonne jamais.",
  ],
  final_rush: [
    "DERNIÈRE LIGNE !",
    "Ithaque à l'horizon !",
    "Tout pour le port !",
    "Ramez comme si Troie brûlait !",
  ],
};

function pick(list: string[], prefer?: string): string {
  if (prefer && list.includes(prefer) && Math.random() < 0.35) return prefer;
  return list[Math.floor(Math.random() * list.length)] ?? list[0];
}

export function momentFromCharge(charge: number, inFlow: boolean, finalRush: boolean): OdysseyMoment {
  if (finalRush) return "final_rush";
  if (inFlow) return "flow_boost";
  if (charge >= 5) return "charge_high";
  if (charge >= 3) return "charge_mid";
  if (charge >= 1) return "charge_low";
  return "idle";
}

/** Badge court sous le score */
export function flowBadgeLabel(boostLeft: number, total: number): string {
  if (boostLeft >= total - 2) return "VENT ARRIÈRE";
  if (boostLeft >= 5) return "VOILE PLEINE";
  if (boostLeft >= 3) return "CRÊTE DE VAGUE";
  return "DERNIERS COUPS";
}

export class OdysseyVoice {
  private lastMoment: OdysseyMoment = "idle";
  private lastLine = "";
  private lastChangeAt = 0;
  private enterAnnounced = false;

  reset(): void {
    this.lastMoment = "idle";
    this.lastLine = "";
    this.lastChangeAt = 0;
    this.enterAnnounced = false;
  }

  /**
   * Retourne la phrase à afficher (ou null pour cacher).
   * Visible dès 1/7, plus intense vers 7/7 et en flow.
   */
  lineFor(opts: {
    charge: number;
    inFlow: boolean;
    justEnteredFlow: boolean;
    justLeftFlow: boolean;
    justBroke: boolean;
    finalRush: boolean;
    now?: number;
  }): string | null {
    const now = opts.now ?? performance.now();

    if (opts.justBroke) {
      this.lastMoment = "break";
      this.lastLine = pick(LINES.break);
      this.lastChangeAt = now;
      this.enterAnnounced = false;
      return this.lastLine;
    }

    if (opts.justLeftFlow) {
      this.lastMoment = "flow_end";
      this.lastLine = pick(LINES.flow_end);
      this.lastChangeAt = now;
      this.enterAnnounced = false;
      return this.lastLine;
    }

    if (opts.justEnteredFlow || (opts.inFlow && !this.enterAnnounced)) {
      this.enterAnnounced = true;
      this.lastMoment = "flow_enter";
      this.lastLine = pick(LINES.flow_enter);
      this.lastChangeAt = now;
      return this.lastLine;
    }

    const moment = momentFromCharge(opts.charge, opts.inFlow, opts.finalRush);
    if (moment === "idle") {
      this.lastMoment = "idle";
      return null;
    }

    const minHold =
      moment === "flow_boost" || moment === "final_rush"
        ? 2200
        : moment === "charge_high"
          ? 1800
          : 2400;

    if (moment !== this.lastMoment || now - this.lastChangeAt > minHold) {
      const pool = LINES[moment];
      this.lastLine = pick(pool, this.lastLine);
      this.lastMoment = moment;
      this.lastChangeAt = now;
    }

    return this.lastLine;
  }
}
