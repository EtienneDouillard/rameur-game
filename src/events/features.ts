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
  /** Signal composite 0–1+ : monte quand le joueur avance / tire */
  drive: number;
  shoulderWidth: number;
  valid: boolean;
  /** Confiance 0–1 selon landmarks disponibles */
  confidence: number;
}

/**
 * Features pour rameur FILMÉ DE FACE (mouvement principal en profondeur).
 * Combine : largeur d’épaules (échelle), hauteur torse, extension des bras.
 * Ne dépend jamais d’un seul point.
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

  // Largeur de référence (épaules > hanches)
  let shoulderWidth = 0;
  if (ls && rs) shoulderWidth = dist(ls, rs);
  else if (lh && rh) shoulderWidth = dist(lh, rh) * 1.15;
  else if (shoulders && hips) shoulderWidth = Math.abs(shoulders.x - hips.x) * 2 + 0.08;

  if (!shoulders && !hips && !nose) {
    return { drive: 0, shoulderWidth: 0, valid: false, confidence: 0 };
  }

  const scale = Math.max(0.04, shoulderWidth || 0.12);

  // 1) Échelle / profondeur (avancée vers la caméra → épaules plus larges)
  const depth = Math.min(1.4, scale / 0.22);

  // 2) Position verticale du torse (recul / avance relative)
  const torsoAnchor = shoulders ?? hips ?? nose!;
  const torsoLift = 1 - Math.min(1, Math.max(0, torsoAnchor.y));

  // 3) Compression buste (nez ↔ épaules), normalisée
  let bust = 0.5;
  if (nose && shoulders) {
    bust = Math.min(1.2, dist(nose, shoulders) / scale);
  }

  // 4) Bras : hauteur poignets relative + extension
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
      armSum += 0.45 * reach + 0.35 * Math.max(0, height) + 0.2 * Math.min(2, elbowBend);
      armN++;
    } else if (elbow && shoulder) {
      armSum += dist(elbow, shoulder) / scale;
      armN++;
    }
  }
  const armDrive = armN ? armSum / armN : 0.55;

  // Pondération : profondeur (face) prioritaire, bras en renfort
  const drive =
    0.38 * depth + 0.22 * torsoLift + 0.2 * bust + 0.2 * Math.min(1.5, armDrive);

  let parts = 0;
  if (ls || rs) parts++;
  if (lh || rh) parts++;
  if (nose) parts++;
  if (lw || rw || le || re) parts++;
  const confidence = Math.min(1, parts / 3);

  // Valide dès qu’on a au moins un ancrage torse + un minimum de confiance
  const valid = confidence >= 0.25 && (shoulders != null || hips != null || nose != null);

  return { drive, shoulderWidth: scale, valid, confidence };
}
