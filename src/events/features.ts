import type { PoseLandmark } from "../types/events";

const MIN_SCORE = 0.15;
const SOFT_SCORE = 0.08;

function kp(
  landmarks: PoseLandmark[],
  name: string,
  min = MIN_SCORE,
): PoseLandmark | undefined {
  const hit = landmarks.find((l) => l.name === name);
  if (!hit || (hit.score ?? 0) < min) return undefined;
  return hit;
}

function mid(a?: PoseLandmark, b?: PoseLandmark): { x: number; y: number } | null {
  if (a && b) return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  if (a) return { x: a.x, y: a.y };
  if (b) return { x: b.x, y: b.y };
  return null;
}

function dist(p1: { x: number; y: number }, p2: { x: number; y: number }): number {
  return Math.hypot(p1.x - p2.x, p1.y - p2.y);
}

function clampRange(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

export interface MotionFeatures {
  /** Signal orienté : croît pendant la traction, décroît au retour */
  drive: number;
  shoulderWidth: number;
  valid: boolean;
  /** Confiance 0–1 selon landmarks disponibles */
  confidence: number;
}

/**
 * Rameur FILMÉ DE FACE (ergomètre ou mouvement mimé).
 *
 * Toutes les composantes sont orientées dans le MÊME sens : elles montent du
 * catch (buste en avant, bras tendus) vers le finish (traction terminée).
 * Mélanger des signaux en opposition de phase créait deux bosses par cycle,
 * donc un point à l'aller ET au retour.
 */
export function extractFeatures(landmarks: PoseLandmark[]): MotionFeatures {
  if (!landmarks.length) {
    return { drive: 0, shoulderWidth: 0, valid: false, confidence: 0 };
  }

  const ls = kp(landmarks, "left_shoulder") ?? kp(landmarks, "left_shoulder", SOFT_SCORE);
  const rs = kp(landmarks, "right_shoulder") ?? kp(landmarks, "right_shoulder", SOFT_SCORE);
  const lh = kp(landmarks, "left_hip", SOFT_SCORE);
  const rh = kp(landmarks, "right_hip", SOFT_SCORE);
  const nose = kp(landmarks, "nose", SOFT_SCORE);
  const lw = kp(landmarks, "left_wrist", SOFT_SCORE);
  const rw = kp(landmarks, "right_wrist", SOFT_SCORE);
  const le = kp(landmarks, "left_elbow", SOFT_SCORE);
  const re = kp(landmarks, "right_elbow", SOFT_SCORE);

  const shoulders = mid(ls, rs);
  const hips = mid(lh, rh);
  const wrists = mid(lw, rw);

  let shoulderWidth = 0;
  if (ls && rs) shoulderWidth = dist(ls, rs);
  else if (lh && rh) shoulderWidth = dist(lh, rh) * 1.15;
  else if (shoulders && hips) shoulderWidth = Math.abs(shoulders.y - hips.y) * 0.7;

  if (!shoulders && !hips && !nose) {
    return { drive: 0, shoulderWidth: 0, valid: false, confidence: 0 };
  }

  const scale = Math.max(0.04, shoulderWidth || 0.12);

  // 1) Profondeur : au catch le rameur est avancé (plus grand à l'image),
  //    au finish il est reculé (plus petit). Signe négatif → croît au finish.
  const depth = -Math.min(1.6, scale / 0.22);

  // 2) Écartement des coudes : collés au corps au catch, ouverts au finish.
  let elbowSum = 0;
  let elbowN = 0;
  for (const [elbow, shoulder] of [
    [le, ls],
    [re, rs],
  ] as const) {
    if (elbow && shoulder) {
      elbowSum += Math.abs(elbow.x - shoulder.x) / scale;
      elbowN++;
    }
  }
  const elbowSpread = elbowN ? Math.min(1.6, elbowSum / elbowN) : 0;

  // 3) Redressement du buste : tête basse au catch, haute au finish.
  let lean = 0;
  if (nose && shoulders) {
    lean = clampRange((shoulders.y - nose.y) / scale, -1.2, 1.6);
  } else if (shoulders && hips) {
    lean = clampRange((hips.y - shoulders.y) / scale, -1.2, 1.6);
  }

  // 4) Mains ramenées vers le buste (secours quand les coudes manquent).
  let handsIn = 0;
  if (wrists && shoulders) {
    handsIn = clampRange(1 - dist(wrists, shoulders) / (scale * 2.2), -1, 1.4);
  }

  const drive =
    0.42 * depth + 0.28 * elbowSpread + 0.2 * lean + 0.1 * handsIn;

  let parts = 0;
  if (ls || rs) parts++;
  if (lh || rh) parts++;
  if (nose) parts++;
  if (lw || rw || le || re) parts++;
  const confidence = Math.min(1, parts / 3);

  const valid = confidence >= 0.22 && (shoulders != null || hips != null || nose != null);

  return { drive, shoulderWidth: scale, valid, confidence };
}
