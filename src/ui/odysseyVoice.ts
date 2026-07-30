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
  lineFor(
    player: "player1" | "player2",
    playerCount: 1 | 2,
    opts: {
      charge: number;
      inFlow: boolean;
      justEnteredFlow: boolean;
      justLeftFlow: boolean;
      justBroke: boolean;
      finalRush: boolean;
      now?: number;
    },
  ): string | null {
    const now = opts.now ?? performance.now();

    if (opts.justBroke) {
      this.lastMoment = "break";
      this.lastLine = pick(this.linesFor("break", player, playerCount));
      this.lastChangeAt = now;
      this.enterAnnounced = false;
      return this.lastLine;
    }

    if (opts.justLeftFlow) {
      this.lastMoment = "flow_end";
      this.lastLine = pick(this.linesFor("flow_end", player, playerCount));
      this.lastChangeAt = now;
      this.enterAnnounced = false;
      return this.lastLine;
    }

    if (opts.justEnteredFlow || (opts.inFlow && !this.enterAnnounced)) {
      this.enterAnnounced = true;
      this.lastMoment = "flow_enter";
      this.lastLine = pick(this.linesFor("flow_enter", player, playerCount));
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
      const pool = this.linesFor(moment, player, playerCount);
      this.lastLine = pick(pool, this.lastLine);
      this.lastMoment = moment;
      this.lastChangeAt = now;
    }

    return this.lastLine;
  }

  private linesFor(
    moment: Exclude<OdysseyMoment, "idle">,
    player: "player1" | "player2",
    playerCount: 1 | 2,
  ): string[] {
    if (playerCount === 2) {
      const duo: Partial<Record<typeof moment, { p1: string[]; p2: string[] }>> = {
        charge_low: {
          p1: ["Ramez, bâbord !", "Marin de gauche, en avant.", "Posez la rame, bâbord."],
          p2: ["Ramez, tribord !", "Marin de droite, en avant.", "Posez la rame, tribord."],
        },
        charge_mid: {
          p1: ["Tenez bâbord, marin !", "La vague vous porte à gauche.", "Ulysse compte sur vous, bâbord."],
          p2: ["Tenez tribord, marin !", "La vague vous porte à droite.", "Ulysse compte sur vous, tribord."],
        },
        charge_high: {
          p1: ["Encore, bâbord ! Le vent vient…", "Ithaque pour la gauche !", "Serrons le rythme, bâbord !"],
          p2: ["Encore, tribord ! Le vent vient…", "Ithaque pour la droite !", "Serrons le rythme, tribord !"],
        },
        flow_enter: {
          p1: ["VENT ARRIÈRE — bâbord !", "Voile ouverte à bâbord !"],
          p2: ["VENT ARRIÈRE — tribord !", "Voile ouverte à tribord !"],
        },
        flow_boost: {
          p1: ["Surfez, marin de bâbord !", "La mer obéit à gauche !", "Gardez ce vent, bâbord !"],
          p2: ["Surfez, marin de tribord !", "La mer obéit à droite !", "Gardez ce vent, tribord !"],
        },
        flow_end: {
          p1: ["Le vent faiblit à bâbord…", "Reprenez, marin de gauche."],
          p2: ["Le vent faiblit à tribord…", "Reprenez, marin de droite."],
        },
        break: {
          p1: ["Ne lâchez pas, bâbord !", "Relevez la rame, marin de gauche."],
          p2: ["Ne lâchez pas, tribord !", "Relevez la rame, marin de droite."],
        },
        final_rush: {
          p1: ["DERNIÈRE LIGNE — bâbord !", "Tout donner à gauche !"],
          p2: ["DERNIÈRE LIGNE — tribord !", "Tout donner à droite !"],
        },
      };
      const block = duo[moment];
      if (block) return player === "player1" ? block.p1 : block.p2;
    }
    return LINES[moment];
  }
}
