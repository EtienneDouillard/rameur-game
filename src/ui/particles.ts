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

interface FloatText {
  x: number;
  y: number;
  vy: number;
  life: number;
  text: string;
  hue: number;
  scale: number;
}

export class ParticleField {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private particles: Particle[] = [];
  private floatTexts: FloatText[] = [];
  private shockwaves: { x: number; y: number; r: number; life: number; hue: number }[] = [];

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

  burst(x: number, y: number, intensity: number, side: "left" | "right" | "center"): void {
    const count = Math.floor(16 + intensity * 40);
    const baseHue = side === "right" ? 320 : side === "left" ? 195 : 45;
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

  shockwave(x: number, y: number, hue: number): void {
    this.shockwaves.push({ x, y, r: 8, life: 1, hue });
  }

  scorePopup(x: number, y: number, text: string, hue: number): void {
    this.floatTexts.push({ x, y, vy: -55, life: 1, text, hue, scale: 1 });
  }

  streak(side: "left" | "right" | "center"): void {
    const w = this.canvas.parentElement?.clientWidth ?? 800;
    const h = this.canvas.parentElement?.clientHeight ?? 600;
    const x = side === "left" ? w * 0.2 : side === "right" ? w * 0.8 : w * 0.5;
    for (let i = 0; i < 8; i++) {
      this.particles.push({
        x: x + (Math.random() - 0.5) * 40,
        y: h * 0.3 + Math.random() * h * 0.4,
        vx: (Math.random() - 0.5) * 2,
        vy: 4 + Math.random() * 8,
        life: 1,
        maxLife: 0.35 + Math.random() * 0.25,
        hue: 50,
        size: 2 + Math.random() * 3,
      });
    }
  }

  tick(dt: number): void {
    const w = this.canvas.parentElement?.clientWidth ?? 800;
    const h = this.canvas.parentElement?.clientHeight ?? 600;

    this.ctx.clearRect(0, 0, w, h);

    for (const t of this.floatTexts) {
      t.life -= dt * 1.2;
      t.y += t.vy * dt;
      t.scale = 1 + (1 - t.life) * 0.4;
      if (t.life <= 0) continue;
      this.ctx.save();
      this.ctx.translate(t.x, t.y);
      this.ctx.scale(t.scale, t.scale);
      this.ctx.font = "800 28px Outfit, sans-serif";
      this.ctx.fillStyle = `hsla(${t.hue}, 100%, 70%, ${t.life})`;
      this.ctx.strokeStyle = `hsla(0, 0%, 0%, ${t.life * 0.5})`;
      this.ctx.lineWidth = 3;
      this.ctx.strokeText(t.text, 0, 0);
      this.ctx.fillText(t.text, 0, 0);
      this.ctx.restore();
    }
    this.floatTexts = this.floatTexts.filter((t) => t.life > 0);

    for (const sw of this.shockwaves) {
      sw.life -= dt * 2.2;
      sw.r += dt * 280;
      if (sw.life <= 0) continue;
      this.ctx.strokeStyle = `hsla(${sw.hue}, 100%, 70%, ${sw.life * 0.85})`;
      this.ctx.lineWidth = 4 + (1 - sw.life) * 6;
      this.ctx.beginPath();
      this.ctx.arc(sw.x, sw.y, sw.r, 0, Math.PI * 2);
      this.ctx.stroke();
    }
    this.shockwaves = this.shockwaves.filter((s) => s.life > 0);

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
