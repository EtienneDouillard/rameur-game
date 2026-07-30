/** Durées de partie proposées (secondes) */
export const MATCH_DURATION_OPTIONS = [30, 60, 90, 120] as const;
export type MatchDurationSec = (typeof MATCH_DURATION_OPTIONS)[number];

export const DEFAULT_MATCH_DURATION_SEC: MatchDurationSec = 90;

export function formatMatchTimer(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}
