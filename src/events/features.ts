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

export interface MotionFeatures {
  /** Signal composite : oscille avec le cycle de rame (face caméra) */
  drive: number;
  shoulderWidth: number;
  valid: boolean;
  /** Confiance 0–1 selon landmarks disponibles */
  confidence: number;
}

/**
 * Features pour rameur FILMÉ DE FACE.
 * Priorité aux bras / traction (signal qui oscille vraiment),
 * profondeur et torse en soutien — moins de biais sur la posture figée.
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
  const elbows = mid(le, re);

  let shoulderWidth = 0;
  if (ls && rs) shoulderWidth = dist(ls, rs);
  else if (lh && rh) shoulderWidth = dist(lh, rh) * 1.15;
  else if (shoulders && hips) shoulderWidth = Math.abs(shoulders.x - hips.x) * 2 + 0.08;

  if (!shoulders && !hips && !nose) {
    return { drive: 0, shoulderWidth: 0, valid: false, confidence: 0 };
  }

  const scale = Math.max(0.04, shoulderWidth || 0.12);

  // 1) Profondeur (avancée → épaules plus larges) — utile mais bruité
  const depth = Math.min(1.35, scale / 0.22);

  // 2) Rocking du torse (nez vs épaules) — oscillatoire
  let bust = 0.5;
  if (nose && shoulders) {
    bust = Math.min(1.25, dist(nose, shoulders) / scale);
  }

  // 3) Traction des bras : hauteur + extension (cœur du signal rame face-cam)
  let armSum = 0;
  let armN = 0;
  for (const [wrist, elbow, shoulder] of [
    [lw, le, ls],
    [rw, re, rs],
  ] as const) {
    if (wrist && shoulder) {
      const reach = dist(wrist, shoulder) / scale;
      const height = (shoulder.y - wrist.y) / scale;
      const elbowBend =
        elbow != null ? dist(elbow, shoulder) / (dist(wrist, elbow) + 0.001) : 1;
      armSum += 0.42 * reach + 0.4 * Math.max(-0.3, height) + 0.18 * Math.min(2, elbowBend);
      armN++;
    } else if (elbow && shoulder) {
      const reach = dist(elbow, shoulder) / scale;
      const height = (shoulder.y - elbow.y) / scale;
      armSum += 0.55 * reach + 0.45 * Math.max(-0.2, height);
      armN++;
    }
  }
  const armDrive = armN ? armSum / armN : 0.5;

  // 4) Poignets / coudes vs centre épaules (pull groupé)
  let pull = 0.5;
  const armAnchor = wrists ?? elbows;
  if (armAnchor && shoulders) {
    const dy = (shoulders.y - armAnchor.y) / scale;
    const dx = Math.abs(armAnchor.x - shoulders.x) / scale;
    pull = Math.min(1.4, 0.65 * Math.max(0, dy + 0.35) + 0.35 * Math.min(1.2, dx));
  }

  // Bras + pull dominent : le drive doit monter/descendre à chaque coup
  const drive =
    0.18 * depth +
    0.18 * bust +
    0.42 * Math.min(1.6, armDrive) +
    0.22 * pull;

  let parts = 0;
  if (ls || rs) parts++;
  if (lh || rh) parts++;
  if (nose) parts++;
  if (lw || rw || le || re) parts++;
  const confidence = Math.min(1, parts / 3);

  const valid = confidence >= 0.22 && (shoulders != null || hips != null || nose != null);

  return { drive, shoulderWidth: scale, valid, confidence };
}
