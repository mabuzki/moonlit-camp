import type { Rect } from "./scene";

export class SkyEdge {
  private envelope = new Float32Array(500);
  private extension = document.createElement("canvas");
  private cachedTime = -Infinity;
  private cachedPath = new Path2D();

  constructor(image: HTMLImageElement, source: Rect, destination: Rect) {
    const canvas = document.createElement("canvas");
    canvas.width = 500;
    canvas.height = 300;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(image, ...source, ...destination);
    const pixels = ctx.getImageData(0, 0, 500, 300).data;
    const raw = new Float32Array(500).fill(300);
    const top = new Float32Array(500);
    for (let x = 0; x < 500; x++) {
      for (let y = 0; y < 298; y++) {
        if ([0, 1, 2].every(dy => pixels[((y + dy) * 500 + x) * 4 + 3] >= 128)) {
          raw[x] = y;
          break;
        }
      }
    }
    for (let x = 0; x < 500; x++) {
      // Smooth tiny alpha specks while retaining the original large cloud-shaped lobes.
      const neighbors = [-2, -1, 0, 1, 2].map(dx => raw[Math.max(0, Math.min(499, x + dx))]);
      top[x] = neighbors.sort((a, b) => a - b)[2];
    }
    for (let x = 0; x < 500; x++) {
      let total = 0, weights = 0;
      for (let dx = -64; dx <= 64; dx++) {
        const index = Math.max(0, Math.min(499, x + dx));
        if (top[index] >= 240) continue;
        const weight = Math.exp(-dx * dx / (2 * 28 * 28));
        total += top[index] * weight;
        weights += weight;
      }
      const blend = Math.max(0, Math.min(1, (148 - top[x]) / 42));
      const smooth = weights ? total / weights : top[x];
      // Keep the broad arch fixed; replace the baked-in small lobes with moving ones.
      this.envelope[x] = top[x] * (1 - blend) + smooth * blend;
    }
    this.extension.width = 500;
    this.extension.height = 300;
    const extensionContext = this.extension.getContext("2d")!;
    for (let x = 0; x < 500; x++) {
      if (top[x] >= 240) continue;
      const color = [0, 0, 0];
      let samples = 0;
      for (let dx = -2; dx <= 2; dx++) {
        const column = Math.max(0, Math.min(499, x + dx));
        const row = Math.min(299, Math.round(top[column] + 9));
        const offset = (row * 500 + column) * 4;
        if (pixels[offset + 3] < 200) continue;
        for (let channel = 0; channel < 3; channel++) color[channel] += pixels[offset + channel];
        samples++;
      }
      const rgb = samples ? color.map(value => Math.round(value / samples)) : [76, 91, 123];
      extensionContext.fillStyle = `rgb(${rgb.join(",")})`;
      extensionContext.fillRect(x, 0, 1, Math.min(300, top[x] + 12));
    }
  }

  extendTexture(ctx: CanvasRenderingContext2D) {
    ctx.drawImage(this.extension, 0, 0, 500, 300);
  }

  profile(time: number): { x: number; y: number }[] {
    const seconds = Math.floor(time / 100) / 10;
    return Array.from({ length: 251 }, (_, index) => {
      const x = index * 2;
      const base = this.envelope[Math.min(499, x)];
      const blend = Math.max(0, Math.min(1, (148 - base) / 42));
      const envelope = blend * blend * (3 - 2 * blend);
      const travellingX = x - seconds * 0.9;
      // Vary spacing and height in travelling coordinates so the irregular pattern moves as one.
      const warpedX = travellingX
        + 9 * Math.sin(travellingX * Math.PI * 2 / 181 + 0.7)
        + 5 * Math.sin(travellingX * Math.PI * 2 / 307 + 2.1);
      const spacingRate = 1
        + 9 * Math.PI * 2 / 181 * Math.cos(travellingX * Math.PI * 2 / 181 + 0.7)
        + 5 * Math.PI * 2 / 307 * Math.cos(travellingX * Math.PI * 2 / 307 + 2.1);
      // Narrow lobes stay lower and wide lobes rise higher, preserving rounded proportions.
      const height = (5.4
        + 1.3 * Math.sin(travellingX * Math.PI * 2 / 157 + 1.2)
        + 0.7 * Math.sin(travellingX * Math.PI * 2 / 271 + 2.4)) / spacingRate;
      const wave = -height * Math.cos(warpedX * Math.PI * 2 / 52)
        - 0.35 * Math.cos(warpedX * Math.PI * 2 / 38.5 + 1.3)
        + 0.26 * Math.sin(travellingX * Math.PI * 2 / 130 + seconds * Math.PI * 2 / 60);
      return { x, y: Math.min(300, Math.round(base + envelope * (3 + wave))) };
    });
  }

  path(time: number): Path2D {
    const frame = Math.floor(time / 100);
    if (frame === this.cachedTime) return this.cachedPath;
    const points = this.profile(time);
    const path = new Path2D();
    path.moveTo(0, 300);
    path.lineTo(0, points[0].y);
    for (let index = 1; index < points.length; index++) {
      // Two-pixel columns keep a stepped pixel contour rather than a blurred vector edge.
      path.lineTo(points[index].x, points[index - 1].y);
      path.lineTo(points[index].x, points[index].y);
    }
    path.lineTo(500, 300);
    path.closePath();
    this.cachedTime = frame;
    this.cachedPath = path;
    return path;
  }
}
