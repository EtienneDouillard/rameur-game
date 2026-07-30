export const AUDIO_PREF_KEY = "row-battle-audio-prefs";

export interface AudioPrefs {
  music: boolean;
  sfx: boolean;
}

const DEFAULT: AudioPrefs = { music: true, sfx: true };

export function loadAudioPrefs(): AudioPrefs {
  try {
    const raw = localStorage.getItem(AUDIO_PREF_KEY);
    if (!raw) return { ...DEFAULT };
    const parsed = JSON.parse(raw) as Partial<AudioPrefs>;
    return {
      music: parsed.music !== false,
      sfx: parsed.sfx !== false,
    };
  } catch {
    return { ...DEFAULT };
  }
}

export function saveAudioPrefs(prefs: AudioPrefs): void {
  try {
    localStorage.setItem(AUDIO_PREF_KEY, JSON.stringify(prefs));
  } catch {
    /* ignore */
  }
}
