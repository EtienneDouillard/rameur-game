/** Effets caméra subtils sur la scène vidéo */
export class CameraRig {
  private stage: HTMLElement;

  constructor(stage: HTMLElement) {
    this.stage = stage;
  }

  update(maxFlow: number, anyOverdrive: boolean, finalRush: boolean): void {
    const zoom = 1 + maxFlow * 0.035 + (anyOverdrive ? 0.02 : 0);
    this.stage.style.setProperty("--cam-zoom", zoom.toFixed(4));
    this.stage.classList.toggle("rb-cam-flow", maxFlow >= 0.52);
    this.stage.classList.toggle("rb-cam-overdrive", anyOverdrive);
    this.stage.classList.toggle("rb-cam-rush", finalRush);
    this.stage.style.setProperty("--flow-pulse", String(0.4 + maxFlow * 0.6));
  }

  pulseHit(): void {
    this.stage.classList.remove("rb-cam-hit");
    void this.stage.offsetWidth;
    this.stage.classList.add("rb-cam-hit");
  }
}
