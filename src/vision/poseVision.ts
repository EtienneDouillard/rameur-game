import * as poseDetection from "@tensorflow-models/pose-detection";
import type { PlayerId, PlayerPoseFrame, PoseLandmark } from "../types/events";
import { initTfBackend } from "./backends";
import type { PlayerCount } from "../types/gameMode";
import { ROI_LEFT, ROI_RIGHT, ROI_SOLO } from "../types/gameMode";

export type PoseFrameCallback = (frames: PlayerPoseFrame[]) => void;

export class PoseVision {
  private detector: poseDetection.PoseDetector | null = null;
  private multipose = false;
  private running = false;
  private video: HTMLVideoElement;
  private fullCanvas: HTMLCanvasElement;
  private cropCanvas: HTMLCanvasElement;
  private onFrame: PoseFrameCallback;
  private backend = "";
  private playerCount: PlayerCount = 2;
  /** En dual-ROI, alterne les joueurs pour doubler le FPS par joueur */
  private dualToggle = 0;
  private lastLandmarks: Record<PlayerId, PoseLandmark[]> = {
    player1: [],
    player2: [],
  };
  private busy = false;
  private flipHorizontal = false;

  constructor(video: HTMLVideoElement, onFrame: PoseFrameCallback) {
    this.video = video;
    this.onFrame = onFrame;
    this.fullCanvas = document.createElement("canvas");
    this.cropCanvas = document.createElement("canvas");
    this.cropCanvas.width = 192;
    this.cropCanvas.height = 192;
  }

  getBackend(): string {
    return this.backend;
  }

  setPlayerCount(count: PlayerCount): void {
    this.playerCount = count;
  }

  /** Aligné sur l’option « retourner la vidéo » (miroir d’affichage) */
  setFlipHorizontal(on: boolean): void {
    if (this.flipHorizontal === on) return;
    this.flipHorizontal = on;
    // Évite d’attribuer l’ancienne pose au mauvais côté juste après un bascule.
    this.lastLandmarks = { player1: [], player2: [] };
  }

  /**
   * Côté ÉCRAN : player1 = bâbord (gauche), player2 = tribord (droite).
   * Avec miroir CSS, la gauche du canvas brut apparaît à droite de l’écran —
   * on inverse donc le mapping ROI → joueur.
   */
  private screenSideRois(): {
    left: { player: PlayerId; roi: typeof ROI_LEFT };
    right: { player: PlayerId; roi: typeof ROI_RIGHT };
  } {
    if (this.flipHorizontal) {
      return {
        left: { player: "player1", roi: ROI_RIGHT },
        right: { player: "player2", roi: ROI_LEFT },
      };
    }
    return {
      left: { player: "player1", roi: ROI_LEFT },
      right: { player: "player2", roi: ROI_RIGHT },
    };
  }

  async init(): Promise<void> {
    this.backend = await initTfBackend();
    await this.createDualRoiDetector();
  }

  private async createDualRoiDetector(): Promise<void> {
    this.detector?.dispose?.();
    this.multipose = false;
    this.detector = await poseDetection.createDetector(
      poseDetection.SupportedModels.MoveNet,
      {
        modelType: poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING,
        enableSmoothing: true,
      },
    );
  }

  async fallbackToMultipose(): Promise<void> {
    this.detector?.dispose?.();
    this.multipose = true;
    this.detector = await poseDetection.createDetector(
      poseDetection.SupportedModels.MoveNet,
      {
        modelType: poseDetection.movenet.modelType.MULTIPOSE_LIGHTNING,
        enableTracking: true,
        trackerType: poseDetection.TrackerType.BoundingBox,
      },
    );
  }

  start(): void {
    if (!this.detector || this.running) return;
    this.running = true;
    this.loop();
  }

  stop(): void {
    this.running = false;
  }

  dispose(): void {
    this.stop();
    this.detector?.dispose?.();
    this.detector = null;
  }

  private loop = (): void => {
    if (!this.running || !this.detector) return;
    const vw = this.video.videoWidth;
    const vh = this.video.videoHeight;
    if (vw === 0) {
      requestAnimationFrame(this.loop);
      return;
    }

    if (this.busy) {
      requestAnimationFrame(this.loop);
      return;
    }

    const now = performance.now();
    this.busy = true;
    void this.processFrame(vw, vh, now)
      .catch(() => {})
      .finally(() => {
        this.busy = false;
        if (this.running) requestAnimationFrame(this.loop);
      });
  };

  private async processFrame(vw: number, vh: number, timestamp: number): Promise<void> {
    const detector = this.detector;
    if (!detector) return;

    if (this.fullCanvas.width !== vw || this.fullCanvas.height !== vh) {
      this.fullCanvas.width = vw;
      this.fullCanvas.height = vh;
    }
    const ctx = this.fullCanvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;
    ctx.drawImage(this.video, 0, 0, vw, vh);

    const frames: PlayerPoseFrame[] = [];

    if (this.multipose) {
      const poses = await detector.estimatePoses(this.fullCanvas, {
        flipHorizontal: this.flipHorizontal,
        maxPoses: this.playerCount,
      });
      const assigned = assignMultipose(
        poses,
        vw,
        vh,
        this.playerCount,
        this.flipHorizontal,
      );
      for (const [player, landmarks] of assigned) {
        if (landmarks.length) {
          this.lastLandmarks[player] = landmarks;
          frames.push({ player, landmarks, timestamp });
        } else if (this.lastLandmarks[player].length) {
          frames.push({ player, landmarks: this.lastLandmarks[player], timestamp });
        }
      }
    } else if (this.playerCount === 1) {
      const landmarks = await this.estimateRoi(ctx, vw, vh, ROI_SOLO, detector);
      if (landmarks.length) this.lastLandmarks.player1 = landmarks;
      if (this.lastLandmarks.player1.length) {
        frames.push({
          player: "player1",
          landmarks: landmarks.length ? landmarks : this.lastLandmarks.player1,
          timestamp,
        });
      }
    } else {
      // Alternate ROI : 1 joueur par frame → ~2× FPS effectif par joueur
      // Mapping selon le côté ÉCRAN (miroir ou non).
      this.dualToggle = 1 - this.dualToggle;
      const sides = this.screenSideRois();
      const active =
        this.dualToggle === 0 ? sides.left : sides.right;

      const landmarks = await this.estimateRoi(ctx, vw, vh, active.roi, detector);
      if (landmarks.length) this.lastLandmarks[active.player] = landmarks;

      for (const player of ["player1", "player2"] as const) {
        const lm =
          player === active.player && landmarks.length
            ? landmarks
            : this.lastLandmarks[player];
        if (lm.length) frames.push({ player, landmarks: lm, timestamp });
      }
    }

    if (frames.length) this.onFrame(frames);
  }

  private async estimateRoi(
    srcCtx: CanvasRenderingContext2D,
    vw: number,
    vh: number,
    roi: { x0: number; x1: number },
    detector: poseDetection.PoseDetector,
  ): Promise<PoseLandmark[]> {
    const sx = Math.floor(roi.x0 * vw);
    const sw = Math.max(1, Math.floor((roi.x1 - roi.x0) * vw));
    const cropCtx = this.cropCanvas.getContext("2d");
    if (!cropCtx) return [];

    cropCtx.drawImage(srcCtx.canvas, sx, 0, sw, vh, 0, 0, 192, 192);

    const poses = await detector.estimatePoses(this.cropCanvas, {
      flipHorizontal: this.flipHorizontal,
    });
    const pose = poses[0];
    if (!pose?.keypoints) return [];

    // Rejeter les poses trop peu fiables (bruit / fond)
    const avgScore =
      pose.keypoints.reduce((s, k) => s + (k.score ?? 0), 0) / pose.keypoints.length;
    if (avgScore < 0.1) return [];

    return pose.keypoints.map((kp) => ({
      x: kp.x / 192,
      y: kp.y / 192,
      score: kp.score ?? 0,
      name: kp.name,
    }));
  }
}

function assignMultipose(
  poses: poseDetection.Pose[],
  frameWidth: number,
  frameHeight: number,
  playerCount: PlayerCount,
  _flipHorizontal: boolean,
): Map<PlayerId, PoseLandmark[]> {
  const result = new Map<PlayerId, PoseLandmark[]>([
    ["player1", []],
    ["player2", []],
  ]);

  // Avec flipHorizontal aligné sur le miroir CSS, les x TF sont déjà
  // en coordonnées écran (gauche = petit x). Tri croissant = bâbord → tribord.
  const scored = poses
    .map((p) => {
      const kps = p.keypoints ?? [];
      const valid = kps.filter((k) => (k.score ?? 0) > 0.15);
      if (!valid.length) return null;
      const cx = valid.reduce((s, k) => s + (k.x ?? 0), 0) / valid.length;
      return { kps, screenX: cx / frameWidth };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .sort((a, b) => a.screenX - b.screenX);

  const norm = (kp: poseDetection.Keypoint): PoseLandmark => ({
    x: (kp.x ?? 0) / frameWidth,
    y: (kp.y ?? 0) / frameHeight,
    score: kp.score ?? 0,
    name: kp.name,
  });

  if (scored.length >= 1) {
    result.set("player1", scored[0].kps.map(norm));
  }
  if (playerCount === 2 && scored.length >= 2) {
    result.set("player2", scored[1].kps.map(norm));
  } else if (playerCount === 2 && scored.length === 1) {
    if (scored[0].screenX > 0.55) {
      result.set("player1", []);
      result.set("player2", scored[0].kps.map(norm));
    }
  }

  return result;
}
