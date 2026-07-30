export type PlayerId = "player1" | "player2";

export interface PlayerRhythmProfile {
  periodMs: number;
  amplitudeNorm: number;
  thresholds: { stroke: number; idle: number };
}

export type GameEvent =
  | { type: "StrokeDetected"; player: PlayerId; strength: number; at: number }
  | { type: "ComboLost"; player: PlayerId; at: number }
  | { type: "PlayerIdle"; player: PlayerId; at: number }
  | { type: "PlayerActive"; player: PlayerId; at: number }
  | { type: "CalibrationProgress"; player: PlayerId; progress: number }
  | { type: "CalibrationDone"; player: PlayerId; profile: PlayerRhythmProfile };

export type GameEventListener = (event: GameEvent) => void;

export interface PoseLandmark {
  x: number;
  y: number;
  score: number;
  name?: string;
}

export interface PlayerPoseFrame {
  player: PlayerId;
  landmarks: PoseLandmark[];
  timestamp: number;
}
