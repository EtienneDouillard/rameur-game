/** Durées de séance proposées dans la roulette (secondes) */
export const MATCH_DURATION_OPTIONS = [
  30, 45, 60, 90, 120, 180, 240, 300, 360, 420, 480, 600, 720, 900, 1200, 1500,
  1800,
] as const;
export type MatchDurationSec = (typeof MATCH_DURATION_OPTIONS)[number];

export const DEFAULT_MATCH_DURATION_SEC: MatchDurationSec = 90;

/** Compte à rebours en jeu : 1:30, 12:00… */
export function formatMatchTimer(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/** Libellé lisible pour la roulette : « 45 s », « 1 min 30 », « 20 min » */
export function formatDurationLabel(sec: number): string {
  if (sec < 60) return `${sec} s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return s === 0 ? `${m} min` : `${m} min ${s}`;
}

export function isMatchDuration(sec: number): sec is MatchDurationSec {
  return (MATCH_DURATION_OPTIONS as readonly number[]).includes(sec);
}

/** Sur une longue séance le score grimpe : on l'espace pour rester lisible. */
export function formatScore(score: number): string {
  return score.toLocaleString("fr-FR").replace(/\u202f|\u00a0/g, "\u2009");
}
