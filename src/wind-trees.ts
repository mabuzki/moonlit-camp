import type { Rect } from "./scene";

const regions: Rect[] = [[12, 65, 100, 105], [400, 78, 96, 94]];

export class WindTrees {
  private base = document.createElement("canvas");
  private source: HTMLCanvasElement;
  private patches: { source: Rect; destination: Rect }[];

  constructor(source: HTMLCanvasElement, ratio: number) {
    this.source = source;
    this.base.width = source.width;
    this.base.height = source.height;
    const ctx = this.base.getContext("2d")!;
    ctx.drawImage(source, 0, 0);
    this.patches = regions.map(([x, y, width, height]) => {
      const source: Rect = [Math.round(x * ratio), Math.round(y * ratio), Math.round(width * ratio), Math.round(height * ratio)];
      ctx.clearRect(...source);
      return { source, destination: source.map(value => value / ratio) as Rect };
    });
  }

  offsets(time: number): number[] {
    const seconds = time / 1000;
    return [
      2.5 * Math.sin(seconds * Math.PI * 2 / 24) + 0.7 * Math.sin(seconds * Math.PI * 2 / 14),
      2 * Math.sin(seconds * Math.PI * 2 / 28 + 0.7) + 0.5 * Math.sin(seconds * Math.PI * 2 / 16 + 1.1),
    ];
  }

  draw(ctx: CanvasRenderingContext2D, time: number) {
    ctx.drawImage(this.base, 0, 0, 500, 300);
    const offsets = this.offsets(time);
    this.patches.forEach((patch, index) => {
      const [, y, , height] = patch.destination;
      const shear = offsets[index] / height;
      ctx.save();
      // Keep the tree bases planted; the displacement increases towards the tips.
      ctx.transform(1, 0, -shear, 1, shear * (y + height), 0);
      ctx.drawImage(this.source, ...patch.source, ...patch.destination);
      ctx.restore();
    });
  }
}
