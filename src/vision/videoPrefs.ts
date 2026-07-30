export const VIDEO_PREF_KEY = "row-battle-video-prefs";

export interface VideoPrefs {
  /** Retourne l'affichage vidéo (miroir type selfie) */
  mirror: boolean;
}

const DEFAULT: VideoPrefs = { mirror: false };

export function loadVideoPrefs(): VideoPrefs {
  try {
    const raw = localStorage.getItem(VIDEO_PREF_KEY);
    if (!raw) return { ...DEFAULT };
    const parsed = JSON.parse(raw) as Partial<VideoPrefs>;
    return { mirror: parsed.mirror === true };
  } catch {
    return { ...DEFAULT };
  }
}

export function saveVideoPrefs(prefs: VideoPrefs): void {
  try {
    localStorage.setItem(VIDEO_PREF_KEY, JSON.stringify(prefs));
  } catch {
    /* ignore */
  }
}
