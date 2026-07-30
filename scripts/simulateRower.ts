/**
 * Banc d'essai hors navigateur : un rameur synthétique alimente le RhythmEngine
 * pour vérifier que la calibration puis la partie détectent bien les coups.
 *
 *   npx tsx scripts/simulateRower.ts
 */
import { RhythmEngine, CALIBRATION_STROKES } from "../src/events/rhythmEngine";
import type { GameEvent, PlayerPoseFrame, PoseLandmark } from "../src/types/events";

const FPS = 30;
const DT = 1000 / FPS;

let clock = 0;
(globalThis as { performance?: { now(): number } }).performance = {
  now: () => clock,
};

interface Scenario {
  name: string;
  periodMs: number;
  amplitude: number;
  noise: number;
  /** Le joueur s'agite pendant les 15 s de préparation */
  restlessWait?: boolean;
  /** Rythme réellement joué en partie (défaut : celui de la calibration) */
  playPeriodMs?: number;
  /** Le joueur ne bouge plus du tout pendant la partie */
  freezeInGame?: boolean;
}

function makeLandmarks(phase: number, amp: number, noise: number): PoseLandmark[] {
  const n = () => (Math.random() - 0.5) * noise;
  // Cycle de rame : les poignets montent/descendent, le torse oscille.
  const pull = (Math.sin(phase) + 1) / 2;
  const wristY = 0.55 - pull * amp;
  const elbowY = 0.58 - pull * amp * 0.6;
  const shoulderY = 0.42 - pull * amp * 0.12;
  const kp = (name: string, x: number, y: number): PoseLandmark => ({
    name,
    x: x + n(),
    y: y + n(),
    score: 0.85,
  });
  return [
    kp("nose", 0.5, 0.3 - pull * amp * 0.2),
    kp("left_shoulder", 0.42, shoulderY),
    kp("right_shoulder", 0.58, shoulderY),
    kp("left_elbow", 0.38, elbowY),
    kp("right_elbow", 0.62, elbowY),
    kp("left_wrist", 0.44, wristY),
    kp("right_wrist", 0.56, wristY),
    kp("left_hip", 0.44, 0.72),
    kp("right_hip", 0.56, 0.72),
  ];
}

function run(scn: Scenario): { ok: boolean; detail: string } {
  clock = 0;
  const engine = new RhythmEngine();
  let calibStrokes = 0;
  let playStrokes = 0;
  let calibrationDone = false;

  engine.on((ev: GameEvent) => {
    if (ev.type === "CalibrationProgress" && ev.phase === "strokes") {
      calibStrokes = Math.max(calibStrokes, ev.strokesDone);
    }
    if (ev.type === "CalibrationDone") calibrationDone = true;
    if (ev.type === "StrokeDetected") playStrokes++;
  });

  engine.startCalibration(1);

  let phase = 0;
  const step = (periodMs: number, amplitude: number) => {
    if (amplitude > 0) phase += (2 * Math.PI * DT) / periodMs;
    const frame: PlayerPoseFrame = {
      player: "player1",
      landmarks: makeLandmarks(phase, amplitude, scn.noise),
      timestamp: clock,
    };
    engine.ingest([frame]);
    clock += DT;
  };

  // 15 s d'attente : installation, parfois agitée.
  for (let i = 0; i < 15 * FPS; i++) {
    step(2200, scn.restlessWait ? scn.amplitude * 1.3 : 0);
  }
  // Coups de calibration.
  for (let i = 0; i < 40 * FPS && !calibrationDone; i++) step(scn.periodMs, scn.amplitude);

  if (!calibrationDone) {
    return { ok: false, detail: `calibration incomplète (${calibStrokes}/${CALIBRATION_STROKES})` };
  }

  const playPeriod = scn.playPeriodMs ?? scn.periodMs;
  const expected = scn.freezeInGame ? 0 : Math.floor((30 * 1000) / playPeriod);
  for (let i = 0; i < 30 * FPS; i++) {
    step(playPeriod, scn.freezeInGame ? 0 : scn.amplitude);
  }

  const ok = scn.freezeInGame
    ? playStrokes === 0
    : playStrokes / expected >= 0.7 && playStrokes / expected <= 1.3;
  return {
    ok,
    detail: `calib ${calibStrokes}/${CALIBRATION_STROKES} · jeu ${playStrokes} coups (attendu ~${expected})`,
  };
}

const scenarios: Scenario[] = [
  { name: "rythme lent, grande amplitude", periodMs: 1600, amplitude: 0.22, noise: 0.004 },
  { name: "rythme normal", periodMs: 1100, amplitude: 0.16, noise: 0.005 },
  { name: "rythme rapide", periodMs: 750, amplitude: 0.12, noise: 0.005 },
  { name: "petite amplitude", periodMs: 1100, amplitude: 0.07, noise: 0.004 },
  { name: "caméra bruitée", periodMs: 1100, amplitude: 0.16, noise: 0.012 },
  {
    name: "s'agite pendant l'attente",
    periodMs: 1100,
    amplitude: 0.16,
    noise: 0.005,
    restlessWait: true,
  },
  {
    name: "accélère après la calibration",
    periodMs: 1400,
    amplitude: 0.16,
    noise: 0.005,
    playPeriodMs: 850,
  },
  {
    name: "ralentit après la calibration",
    periodMs: 800,
    amplitude: 0.14,
    noise: 0.005,
    playPeriodMs: 1500,
  },
  {
    name: "immobile en partie (aucun point)",
    periodMs: 1100,
    amplitude: 0.16,
    noise: 0.006,
    freezeInGame: true,
  },
];

/** Duo : les deux marins doivent finir la calibration puis marquer chacun. */
function runDuo(): { ok: boolean; detail: string } {
  clock = 0;
  const engine = new RhythmEngine();
  const done = { player1: false, player2: false };
  const strokes = { player1: 0, player2: 0 };

  engine.on((ev: GameEvent) => {
    if (ev.type === "CalibrationDone") done[ev.player] = true;
    if (ev.type === "StrokeDetected") strokes[ev.player]++;
  });

  engine.startCalibration(2);

  const periods = { player1: 1100, player2: 1500 };
  const phases = { player1: 0, player2: 1.2 };
  const step = (amplitude: number) => {
    const frames: PlayerPoseFrame[] = [];
    for (const id of ["player1", "player2"] as const) {
      if (amplitude > 0) phases[id] += (2 * Math.PI * DT) / periods[id];
      frames.push({
        player: id,
        landmarks: makeLandmarks(phases[id], amplitude, 0.005),
        timestamp: clock,
      });
    }
    engine.ingest(frames);
    clock += DT;
  };

  for (let i = 0; i < 15 * FPS; i++) step(0);
  for (let i = 0; i < 40 * FPS && !(done.player1 && done.player2); i++) step(0.16);
  if (!done.player1 || !done.player2) {
    return { ok: false, detail: "calibration duo incomplète" };
  }
  for (let i = 0; i < 30 * FPS; i++) step(0.16);

  const exp1 = Math.floor(30000 / periods.player1);
  const exp2 = Math.floor(30000 / periods.player2);
  const ok =
    strokes.player1 / exp1 >= 0.7 &&
    strokes.player1 / exp1 <= 1.3 &&
    strokes.player2 / exp2 >= 0.7 &&
    strokes.player2 / exp2 <= 1.3;
  if (process.env.DEBUG_PROFILES) {
    console.log("P1", engine.getProfile("player1"));
    console.log("P2", engine.getProfile("player2"));
  }
  return {
    ok,
    detail: `bâbord ${strokes.player1}/~${exp1} · tribord ${strokes.player2}/~${exp2}`,
  };
}

let failures = 0;
for (const scn of scenarios) {
  const { ok, detail } = run(scn);
  if (!ok) failures++;
  console.log(`${ok ? "OK  " : "FAIL"} ${scn.name.padEnd(32)} ${detail}`);
}

const duo = runDuo();
if (!duo.ok) failures++;
console.log(`${duo.ok ? "OK  " : "FAIL"} ${"duo, rythmes différents".padEnd(32)} ${duo.detail}`);

if (failures > 0) {
  console.error(`\n${failures} scénario(s) en échec`);
  process.exit(1);
}
console.log("\nTous les scénarios passent.");
