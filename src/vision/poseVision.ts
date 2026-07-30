import * as poseDetection from "@tensorflow-models/pose-detection";
import type { PlayerId, PlayerPoseFrame, PoseLandmark } from "../types/events";
import { initTfBackend } from "./backends";

const ROI_LEFT = { x0: 0, x1: 0.48 };
const ROI_RIGHT = { x0: 0.52, x1: 1 };

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

    const now = performance.now();
    void this.processFrame(vw, vh, now).finally(() => {
      if (this.running) requestAnimationFrame(this.loop);
    });
  };

  private async processFrame(vw: number, vh: number, timestamp: number): Promise<void> {
    const detector = this.detector;
    if (!detector) return;

    this.fullCanvas.width = vw;
    this.fullCanvas.height = vh;
    const ctx = this.fullCanvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;
    ctx.drawImage(this.video, 0, 0, vw, vh);

    const frames: PlayerPoseFrame[] = [];

    if (this.multipose) {
      const poses = await detector.estimatePoses(this.fullCanvas, { flipHorizontal: true });
      const assigned = assignMultipose(poses, vw, vh);
      for (const [player, landmarks] of assigned) {
        if (landmarks.length) frames.push({ player, landmarks, timestamp });
      }
    } else {
      const players: { player: PlayerId; roi: typeof ROI_LEFT }[] = [
        { player: "player1", roi: ROI_LEFT },
        { player: "player2", roi: ROI_RIGHT },
      ];
      for (const { player, roi } of players) {
        const landmarks = await this.estimateRoi(ctx, vw, vh, roi, detector);
        frames.push({ player, landmarks, timestamp });
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
    const sw = Math.floor((roi.x1 - roi.x0) * vw);
    const cropCtx = this.cropCanvas.getContext("2d");
    if (!cropCtx) return [];

    cropCtx.drawImage(srcCtx.canvas, sx, 0, sw, vh, 0, 0, 192, 192);

    const poses = await detector.estimatePoses(this.cropCanvas, { flipHorizontal: true });
    const pose = poses[0];
    if (!pose?.keypoints) return [];

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
): Map<PlayerId, PoseLandmark[]> {
  const result = new Map<PlayerId, PoseLandmark[]>([
    ["player1", []],
    ["player2", []],
  ]);

  const scored = poses
    .map((p) => {
      const kps = p.keypoints ?? [];
      const valid = kps.filter((k) => (k.score ?? 0) > 0.2);
      if (!valid.length) return null;
      const cx = valid.reduce((s, k) => s + (k.x ?? 0), 0) / valid.length;
      return { kps, normX: cx / frameWidth };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .sort((a, b) => a.normX - b.normX);

  const norm = (kp: poseDetection.Keypoint): PoseLandmark => ({
    x: (kp.x ?? 0) / frameWidth,
    y: (kp.y ?? 0) / frameHeight,
    score: kp.score ?? 0,
    name: kp.name,
  });

  if (scored.length >= 1) {
    result.set("player1", scored[0].kps.map(norm));
  }
  if (scored.length >= 2) {
    result.set("player2", scored[1].kps.map(norm));
  }

  return result;
}
