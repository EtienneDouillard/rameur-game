import type { PoseLandmark } from "../types/events";

const MIN_SCORE = 0.25;

function kp(landmarks: PoseLandmark[], name: string): PoseLandmark | undefined {
  return landmarks.find((l) => l.name === name && l.score >= MIN_SCORE);
}

function mid(a?: PoseLandmark, b?: PoseLandmark): { x: number; y: number } | null {
  if (!a || !b) return null;
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function dist(p1: { x: number; y: number }, p2: { x: number; y: number }): number {
  return Math.hypot(p1.x - p2.x, p1.y - p2.y);
}

export interface MotionFeatures {
  drive: number;
  shoulderWidth: number;
  valid: boolean;
}

export function extractFeatures(landmarks: PoseLandmark[]): MotionFeatures {
  const nose = kp(landmarks, "nose");
  const ls = kp(landmarks, "left_shoulder");
  const rs = kp(landmarks, "right_shoulder");
  const lw = kp(landmarks, "left_wrist");
  const rw = kp(landmarks, "right_wrist");
  const le = kp(landmarks, "left_elbow");
  const re = kp(landmarks, "right_elbow");
  const lh = kp(landmarks, "left_hip");
  const rh = kp(landmarks, "right_hip");

  const shoulders = mid(ls, rs);
  if (!shoulders || !ls || !rs) {
    return { drive: 0, shoulderWidth: 0, valid: false };
  }

  const shoulderWidth = dist(ls, rs) || 0.001;
  const bust = nose ? dist(nose, shoulders) / shoulderWidth : 0.5;

  let armSum = 0;
  let armN = 0;
  for (const [wrist, elbow, shoulder] of [
    [lw, le, ls],
    [rw, re, rs],
  ] as const) {
    if (wrist && elbow && shoulder) {
      const upper = dist(elbow, shoulder);
      const fore = dist(wrist, elbow);
      armSum += (wrist.y + fore / (upper + 0.001)) / 2;
      armN++;
    }
  }
  const armDrive = armN ? armSum / armN : 0.5;

  const hips = mid(lh, rh);
  const torsoY = hips ? (shoulders.y + hips.y) / 2 : shoulders.y;

  const drive = 0.45 * bust + 0.35 * armDrive + 0.2 * torsoY;

  return { drive, shoulderWidth, valid: true };
}
