export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  hue: number;
  size: number;
}

export class ParticleField {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private particles: Particle[] = [];

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D indisponible");
    this.ctx = ctx;
  }

  resize(): void {
    const parent = this.canvas.parentElement;
    if (!parent) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = parent.clientWidth * dpr;
    this.canvas.height = parent.clientHeight * dpr;
    this.canvas.style.width = `${parent.clientWidth}px`;
    this.canvas.style.height = `${parent.clientHeight}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  burst(x: number, y: number, intensity: number, side: "left" | "right"): void {
    const count = Math.floor(12 + intensity * 30);
    const baseHue = side === "left" ? 195 : 320;
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count + Math.random() * 0.4;
      const speed = 2 + Math.random() * 6 * intensity;
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 2,
        life: 1,
        maxLife: 0.6 + Math.random() * 0.5,
        hue: baseHue + Math.random() * 40,
        size: 2 + Math.random() * 4 * intensity,
      });
    }
  }

  flashScreen(intensity: number): void {
    const w = this.canvas.width;
    const h = this.canvas.height;
    const count = Math.floor(8 + intensity * 20);
    for (let i = 0; i < count; i++) {
      this.particles.push({
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - 0.5) * 3,
        vy: (Math.random() - 0.5) * 3,
        life: 1,
        maxLife: 0.4 + Math.random() * 0.3,
        hue: 50 + Math.random() * 30,
        size: 3 + Math.random() * 5,
      });
    }
  }

  tick(dt: number): void {
    const w = this.canvas.parentElement?.clientWidth ?? 800;
    const h = this.canvas.parentElement?.clientHeight ?? 600;

    this.ctx.clearRect(0, 0, w, h);

    for (const p of this.particles) {
      p.life -= dt / p.maxLife;
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.15;
      if (p.life <= 0) continue;
      const alpha = Math.max(0, p.life);
      this.ctx.fillStyle = `hsla(${p.hue}, 90%, 65%, ${alpha})`;
      this.ctx.beginPath();
      this.ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      this.ctx.fill();
    }

    this.particles = this.particles.filter((p) => p.life > 0);
  }
}
