const STORAGE_KEY = "row-battle-music-bpm";
export const BPM_MIN = 80;
export const BPM_MAX = 160;
export const BPM_DEFAULT = 118;
export const BPM_STEP = 4;

export function loadMusicBpm(): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return BPM_DEFAULT;
    const n = Number(raw);
    if (!Number.isFinite(n)) return BPM_DEFAULT;
    return clampBpm(n);
  } catch {
    return BPM_DEFAULT;
  }
}

export function saveMusicBpm(bpm: number): void {
  try {
    localStorage.setItem(STORAGE_KEY, String(clampBpm(bpm)));
  } catch {
    /* ignore */
  }
}

export function clampBpm(bpm: number): number {
  return Math.min(BPM_MAX, Math.max(BPM_MIN, Math.round(bpm)));
}

/** BPM musical à partir de la période d’un coup (ms). */
export function bpmFromStrokePeriodMs(periodMs: number): number {
  if (periodMs < 400 || periodMs > 2800) return BPM_DEFAULT;
  return clampBpm(Math.round(60000 / periodMs));
}
