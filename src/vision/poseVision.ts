import * as poseDetection from "@tensorflow-models/pose-detection";
import type { PlayerId, PlayerPoseFrame, PoseLandmark } from "../types/events";
import { initTfBackend } from "./backends";
import type { PlayerCount } from "../types/gameMode";
import { ROI_LEFT, ROI_RIGHT, ROI_SOLO } from "../types/gameMode";

export type PoseFrameCallback = (frames: PlayerPoseFrame[]) => void;

/** Au-delà, la pose mémorisée est périmée (le joueur a quitté le cadre) */
const STALE_POSE_MS = 1200;
/** Points fiables minimum pour accepter une pose (évite les fantômes sur fond vide) */
const MIN_STRONG_KEYPOINTS = 6;
const STRONG_SCORE = 0.3;

/** Une vraie personne montre un torse : sinon c'est du bruit de fond. */
function strongKeypoints(keypoints: poseDetection.Keypoint[]): poseDetection.Keypoint[] {
  const strong = keypoints.filter((k) => (k.score ?? 0) >= STRONG_SCORE);
  if (strong.length < MIN_STRONG_KEYPOINTS) return [];
  const hasTorso = strong.some(
    (k) => k.name === "left_shoulder" || k.name === "right_shoulder",
  );
  return hasTorso ? strong : [];
}

interface RoiResult {
  landmarks: PoseLandmark[];
  /** Centre horizontal de la pose dans l'image affichée (0 = bord gauche) */
  centerX: number;
}

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
  private lastSeenAt: Record<PlayerId, number> = { player1: 0, player2: 0 };
  private lastCenterX: Record<PlayerId, number> = { player1: -1, player2: -1 };
  private busy = false;
  /** La vidéo est affichée en miroir (option « Retourner la vidéo ») */
  private mirrored = false;

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

  /** Position écran du joueur détecté, -1 si absent (diagnostic ?debug=1) */
  getCenterX(player: PlayerId): number {
    return this.lastCenterX[player];
  }

  isMirrored(): boolean {
    return this.mirrored;
  }

  setPlayerCount(count: PlayerCount): void {
    this.playerCount = count;
  }

  /**
   * Doit suivre l'option d'affichage. L'image analysée est retournée comme
   * la vidéo à l'écran : la moitié gauche du canvas est donc toujours la
   * moitié gauche vue par les joueurs, miroir ou non.
   */
  setFlipHorizontal(on: boolean): void {
    if (this.mirrored === on) return;
    this.mirrored = on;
    this.lastLandmarks = { player1: [], player2: [] };
    this.lastSeenAt = { player1: 0, player2: 0 };
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

    // Le canvas reproduit exactement ce que voient les joueurs.
    ctx.save();
    if (this.mirrored) {
      ctx.translate(vw, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(this.video, 0, 0, vw, vh);
    ctx.restore();

    if (this.multipose) {
      const poses = await detector.estimatePoses(this.fullCanvas, {
        flipHorizontal: false,
        maxPoses: this.playerCount,
      });
      for (const [player, landmarks] of this.assignMultipose(poses, vw, vh)) {
        if (landmarks.length) {
          this.lastLandmarks[player] = landmarks;
          this.lastSeenAt[player] = timestamp;
        }
      }
    } else if (this.playerCount === 1) {
      const res = await this.estimateRoi(ctx, vw, vh, ROI_SOLO, detector);
      if (res) {
        this.lastLandmarks.player1 = res.landmarks;
        this.lastSeenAt.player1 = timestamp;
      }
    } else {
      // Alternance gauche / droite : ~2× FPS effectif par joueur.
      this.dualToggle = 1 - this.dualToggle;
      const roi = this.dualToggle === 0 ? ROI_LEFT : ROI_RIGHT;
      const res = await this.estimateRoi(ctx, vw, vh, roi, detector);
      if (res) {
        // Le joueur vient de la position réelle dans l'image affichée :
        // moitié gauche = bâbord (HUD gauche), moitié droite = tribord.
        const player: PlayerId = res.centerX < 0.5 ? "player1" : "player2";
        this.lastLandmarks[player] = res.landmarks;
        this.lastSeenAt[player] = timestamp;
        this.lastCenterX[player] = res.centerX;
      }
    }

    const frames: PlayerPoseFrame[] = [];
    for (const player of ["player1", "player2"] as const) {
      if (this.playerCount === 1 && player === "player2") continue;
      const lm = this.lastLandmarks[player];
      if (!lm.length) continue;
      if (timestamp - this.lastSeenAt[player] > STALE_POSE_MS) continue;
      frames.push({ player, landmarks: lm, timestamp });
    }

    if (frames.length) this.onFrame(frames);
  }

  private async estimateRoi(
    srcCtx: CanvasRenderingContext2D,
    vw: number,
    vh: number,
    roi: { x0: number; x1: number },
    detector: poseDetection.PoseDetector,
  ): Promise<RoiResult | null> {
    const sx = Math.floor(roi.x0 * vw);
    const sw = Math.max(1, Math.floor((roi.x1 - roi.x0) * vw));
    const cropCtx = this.cropCanvas.getContext("2d");
    if (!cropCtx) return null;

    cropCtx.drawImage(srcCtx.canvas, sx, 0, sw, vh, 0, 0, 192, 192);

    const poses = await detector.estimatePoses(this.cropCanvas, {
      flipHorizontal: false,
    });
    const pose = poses[0];
    if (!pose?.keypoints) return null;

    const strong = strongKeypoints(pose.keypoints);
    if (!strong.length) return null;

    const meanX = strong.reduce((s, k) => s + (k.x ?? 0), 0) / strong.length / 192;

    return {
      landmarks: pose.keypoints.map((kp) => ({
        x: kp.x / 192,
        y: kp.y / 192,
        score: kp.score ?? 0,
        name: kp.name,
      })),
      centerX: (sx + meanX * sw) / vw,
    };
  }

  private assignMultipose(
    poses: poseDetection.Pose[],
    frameWidth: number,
    frameHeight: number,
  ): Map<PlayerId, PoseLandmark[]> {
    const result = new Map<PlayerId, PoseLandmark[]>([
      ["player1", []],
      ["player2", []],
    ]);

    const scored = poses
      .map((p) => {
        const kps = p.keypoints ?? [];
        const strong = strongKeypoints(kps);
        if (!strong.length) return null;
        const cx = strong.reduce((s, k) => s + (k.x ?? 0), 0) / strong.length;
        return { kps, centerX: cx / frameWidth };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)
      .sort((a, b) => a.centerX - b.centerX);

    const norm = (kp: poseDetection.Keypoint): PoseLandmark => ({
      x: (kp.x ?? 0) / frameWidth,
      y: (kp.y ?? 0) / frameHeight,
      score: kp.score ?? 0,
      name: kp.name,
    });

    if (this.playerCount === 1) {
      if (scored.length) result.set("player1", scored[0].kps.map(norm));
      return result;
    }

    const left = scored.filter((s) => s.centerX < 0.5);
    const right = scored.filter((s) => s.centerX >= 0.5);
    if (left.length) result.set("player1", left[0].kps.map(norm));
    if (right.length) result.set("player2", right[right.length - 1].kps.map(norm));

    return result;
  }
}
