import {
  DEFAULT_MATCH_DURATION_SEC,
  isMatchDuration,
  type MatchDurationSec,
} from "../types/matchDuration";

export const DURATION_PREF_KEY = "row-battle-duration";

/** La durée choisie à la roulette est retenue d'une séance à l'autre. */
export function loadDurationPref(): MatchDurationSec {
  try {
    const raw = localStorage.getItem(DURATION_PREF_KEY);
    const sec = raw === null ? NaN : Number(raw);
    return isMatchDuration(sec) ? sec : DEFAULT_MATCH_DURATION_SEC;
  } catch {
    return DEFAULT_MATCH_DURATION_SEC;
  }
}

export function saveDurationPref(sec: MatchDurationSec): void {
  try {
    localStorage.setItem(DURATION_PREF_KEY, String(sec));
  } catch {
    /* ignore */
  }
}
