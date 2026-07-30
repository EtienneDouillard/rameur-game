/** Effets caméra subtils sur la scène vidéo */
export class CameraRig {
  private stage: HTMLElement;

  constructor(stage: HTMLElement) {
    this.stage = stage;
  }

  update(maxIntensity: number, anyInFlow: boolean, finalRush: boolean): void {
    const zoom = 1 + maxIntensity * 0.04 + (anyInFlow ? 0.02 : 0);
    this.stage.style.setProperty("--cam-zoom", zoom.toFixed(4));
    this.stage.classList.toggle("rb-cam-flow", anyInFlow || maxIntensity >= 0.45);
    this.stage.classList.toggle("rb-cam-overdrive", anyInFlow);
    this.stage.classList.toggle("rb-cam-rush", finalRush);
    this.stage.style.setProperty("--flow-pulse", String(0.4 + maxIntensity * 0.6));
  }

  pulseHit(): void {
    this.stage.classList.remove("rb-cam-hit");
    void this.stage.offsetWidth;
    this.stage.classList.add("rb-cam-hit");
  }
}
