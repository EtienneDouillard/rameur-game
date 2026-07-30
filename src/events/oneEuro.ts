/** Filtre One Euro — lissage adaptatif faible latence */
export class OneEuroFilter {
  private minCutoff: number;
  private beta: number;
  private dCutoff: number;
  private xPrev: number | null = null;
  private dxPrev = 0;
  private tPrev: number | null = null;

  constructor(minCutoff = 1.2, beta = 0.02, dCutoff = 1) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
  }

  filter(value: number, timestamp: number): number {
    if (this.tPrev === null || this.xPrev === null) {
      this.tPrev = timestamp;
      this.xPrev = value;
      return value;
    }

    const dt = Math.max(1 / 120, (timestamp - this.tPrev) / 1000);
    this.tPrev = timestamp;

    const dx = (value - this.xPrev) / dt;
    const edx = this.smooth(dx, this.dxPrev, dt, this.dCutoff);
    this.dxPrev = edx;

    const cutoff = this.minCutoff + this.beta * Math.abs(edx);
    const filtered = this.smooth(value, this.xPrev, dt, cutoff);
    this.xPrev = filtered;
    return filtered;
  }

  reset(): void {
    this.xPrev = null;
    this.dxPrev = 0;
    this.tPrev = null;
  }

  private smooth(a: number, b: number, dt: number, cutoff: number): number {
    const tau = 1 / (2 * Math.PI * cutoff);
    const alpha = 1 / (1 + tau / dt);
    return alpha * a + (1 - alpha) * b;
  }
}
