/** Effets légers sur la vidéo (CSS + anneaux canvas) — pas de re-traitement IA */
export class VideoStageFx {
  private root: HTMLElement;
  private overlay: HTMLElement;
  private ringsCanvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private rings: { x: number; y: number; r: number; life: number; hue: number }[] = [];

  constructor(root: HTMLElement, overlay: HTMLElement, ringsCanvas: HTMLCanvasElement) {
    this.root = root;
    this.overlay = overlay;
    const ctx = ringsCanvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D indisponible");
    this.ringsCanvas = ringsCanvas;
    this.ctx = ctx;
  }

  resize(): void {
    const stage = this.ringsCanvas.parentElement;
    if (!stage) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.ringsCanvas.width = stage.clientWidth * dpr;
    this.ringsCanvas.height = stage.clientHeight * dpr;
    this.ringsCanvas.style.width = `${stage.clientWidth}px`;
    this.ringsCanvas.style.height = `${stage.clientHeight}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  punch(side: "left" | "right" | "center", intensity: number): void {
    this.overlay.classList.remove("rb-video-fx--hit");
    void this.overlay.offsetWidth;
    this.overlay.classList.add("rb-video-fx--hit");
    this.overlay.dataset.side = side;

    this.root.classList.remove("rb-shake");
    void this.root.offsetWidth;
    if (intensity > 0.35) {
      this.root.classList.add("rb-shake");
    }

    const stage = this.ringsCanvas.parentElement;
    if (!stage) return;
    const w = stage.clientWidth;
    const h = stage.clientHeight;
    let x = w * 0.5;
    if (side === "left") x = w * 0.25;
    if (side === "right") x = w * 0.75;
    const y = h * 0.55;
    const hue = side === "right" ? 320 : 195;
    this.rings.push({ x, y, r: 20, life: 1, hue });
    if (intensity > 0.6) {
      this.rings.push({ x, y, r: 10, life: 1, hue: hue + 40 });
    }
  }

  setComboLevel(level: number): void {
    this.root.dataset.comboFx = String(level);
  }

  tick(dt: number): void {
    const stage = this.ringsCanvas.parentElement;
    const w = stage?.clientWidth ?? 800;
    const h = stage?.clientHeight ?? 600;
    this.ctx.clearRect(0, 0, w, h);

    for (const ring of this.rings) {
      ring.life -= dt * 1.8;
      ring.r += dt * 120;
      if (ring.life <= 0) continue;
      this.ctx.strokeStyle = `hsla(${ring.hue}, 100%, 60%, ${ring.life * 0.7})`;
      this.ctx.lineWidth = 3 + (1 - ring.life) * 4;
      this.ctx.beginPath();
      this.ctx.arc(ring.x, ring.y, ring.r, 0, Math.PI * 2);
      this.ctx.stroke();
    }
    this.rings = this.rings.filter((r) => r.life > 0);
  }
}
