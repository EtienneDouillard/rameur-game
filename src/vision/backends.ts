import * as tf from "@tensorflow/tfjs";
import "@tensorflow/tfjs-backend-webgl";

const BACKENDS = ["webgl", "wasm", "cpu"] as const;

function isIOS(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

export async function initTfBackend(): Promise<string> {
  const order = isIOS() ? (["webgl", "cpu"] as const) : BACKENDS;

  for (const backend of order) {
    try {
      const ok = await tf.setBackend(backend);
      if (!ok) continue;
      await tf.ready();
      return backend;
    } catch {
      continue;
    }
  }
  throw new Error("Aucun backend TensorFlow.js disponible.");
}
