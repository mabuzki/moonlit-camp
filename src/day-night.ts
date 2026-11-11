import { tentScheduleAt, type TentId } from "./tent-schedule";
import { fireScheduleAt } from "./fire-schedule";

export const CYCLE_MINUTES = [20, 30, 45, 60, 90, 120] as const;
export const DEFAULT_CYCLE_MINUTES = 20;
export const DAY_NIGHT_DURATION = DEFAULT_CYCLE_MINUTES * 60_000;
const START_PHASE = 0.15;
export const LIGHT_PHASES = ["night", "dawn", "day", "dusk"] as const;
export type LightPhase = typeof LIGHT_PHASES[number];
type RGB = [number, number, number];
export interface CelestialBody {
  kind: "moon" | "sun";
  progress: number;
  x: number;
  y: number;
}
export interface DayNight {
  phase: number;
  durationMs: number;
  daylight: number;
  stars: number;
  tentLight: number;
  gameHour: number;
  gameDay: number;
  tent: ReturnType<typeof tentScheduleAt>;
  tents: Record<TentId, ReturnType<typeof tentScheduleAt>>;
  fire: ReturnType<typeof fireScheduleAt>;
  weights: Record<LightPhase, number>;
  body: CelestialBody;
  fogColor: RGB;
  fogDensity: number;
}
const clamp = (value: number) => Math.max(0, Math.min(1, value));
const smooth = (low: number, high: number, value: number) => {
  const t = clamp((value - low) / (high - low));
  return t * t * (3 - 2 * t);
};

export function dayNightAt(time: number, cycleMinutes = DEFAULT_CYCLE_MINUTES, cycleOffset = 0, tentSeed = 0): DayNight {
  const durationMs = cycleMinutes * 60_000;
  const rawPhase = time / durationMs + START_PHASE + cycleOffset;
  // Equivalent pause/speed calculations must choose the same side of dawn and midnight.
  const quarterPhase = Math.round(rawPhase * 4) / 4;
  const absolutePhase = Math.abs(rawPhase - quarterPhase) < 1e-12 ? quarterPhase : rawPhase;
  const phase = ((absolutePhase % 1) + 1) % 1;
  const elevation = -Math.sin(phase * Math.PI * 2);
  const daylight = smooth(-0.12, 0.32, elevation);
  const twilight = (1 - smooth(0, 0.38, Math.abs(elevation))) * (1 - daylight);
  const dawn = phase > 0.25 && phase < 0.75;
  const weights = { night: Math.max(0, 1 - daylight - twilight), dawn: dawn ? twilight : 0, day: daylight, dusk: dawn ? 0 : twilight };
  const moon = phase < 0.5;
  const progress = moon ? phase * 2 : (phase - 0.5) * 2;
  const gameHour = (18 + phase * 24) % 24;
  const gameDay = Math.floor(absolutePhase + 0.75);
  const tent = tentScheduleAt(gameHour, "main", gameDay, tentSeed);
  const fog: Record<LightPhase, RGB> = {
    night: [163, 181, 204], dawn: [235, 193, 168], day: [211, 233, 219], dusk: [208, 166, 177],
  };
  return {
    phase, durationMs, daylight,
    stars: 1 - smooth(-0.18, 0.12, elevation),
    tentLight: tent.light, gameHour, gameDay, tent,
    tents: { main: tent, rear: tentScheduleAt(gameHour, "rear", gameDay, tentSeed), right: tentScheduleAt(gameHour, "right", gameDay, tentSeed) },
    fire: fireScheduleAt(gameHour),
    weights,
    body: { kind: moon ? "moon" : "sun", progress, x: 68 + 364 * progress, y: 164 - 90 * Math.sin(progress * Math.PI) },
    fogColor: [0, 1, 2].map(channel => Math.round(LIGHT_PHASES.reduce((sum, phase) => sum + fog[phase][channel] * weights[phase], 0))) as RGB,
    fogDensity: weights.night * 0.075 + weights.dawn * 0.12 + weights.day * 0.035 + weights.dusk * 0.095,
  };
}

export type LightingRole = "sky" | "far" | "middle" | "near" | "props" | "cloud";

// Relight the existing pixel textures once per resize; the animation only blends cached palettes.
export function lightingVariants(source: HTMLCanvasElement, role: LightingRole): Record<LightPhase, HTMLCanvasElement> {
  const original = source.getContext("2d", { willReadFrequently: true })!.getImageData(0, 0, source.width, source.height);
  const variants = { night: source } as Record<LightPhase, HTMLCanvasElement>;
  const transforms: Record<LightingRole, [RGB, RGB]> = {
    sky: [[1, 1, 1], [0, 0, 0]],
    far: [[0.74, 0.83, 0.74], [63, 62, 51]],
    middle: [[0.82, 0.93, 0.79], [28, 42, 26]],
    near: [[1.04, 1.18, 0.99], [12, 21, 8]],
    props: [[1.05, 1.07, 1.0], [6, 8, 3]],
    cloud: [[0.67, 0.7, 0.7], [125, 132, 124]],
  };
  const [gain, offset] = transforms[role];
  const depth = role === "far" ? 1 : role === "cloud" ? 1.7 : role === "middle" ? 0.65 : role === "near" ? 0.25 : 0.12;
  for (const phase of ["dawn", "day", "dusk"] as const) {
    const canvas = document.createElement("canvas");
    canvas.width = source.width;
    canvas.height = source.height;
    const ctx = canvas.getContext("2d")!;
    const output = ctx.createImageData(canvas.width, canvas.height);
    output.data.set(original.data);
    const top: RGB = phase === "day" ? [102, 166, 196] : phase === "dawn" ? [102, 116, 155] : [92, 92, 139];
    const bottom: RGB = phase === "day" ? [207, 226, 210] : phase === "dawn" ? [239, 193, 156] : [226, 155, 139];
    const tint: RGB = phase === "dawn" ? [38, 13, 4] : [29, 0, 14];
    const skyRows = Array.from({ length: canvas.height }, (_, row) => {
      const gradient = smooth(0.08, 0.75, row / canvas.height);
      return top.map((value, channel) => value + (bottom[channel] - value) * gradient);
    });
    for (let index = 0; index < output.data.length; index += 4) {
      if (!output.data[index + 3]) continue;
      const color: RGB = [original.data[index], original.data[index + 1], original.data[index + 2]];
      let result: RGB;
      if (role === "sky") {
        const y = Math.floor(index / 4 / canvas.width) / canvas.height;
        const detail = (color[0] * 0.25 + color[1] * 0.5 + color[2] * 0.25 - (91 + y * 36)) * 0.42;
        result = skyRows[Math.floor(index / 4 / canvas.width)].map(value => value + detail) as RGB;
      } else {
        if (phase === "day") {
          result = color.map((value, channel) => value * gain[channel] + offset[channel]) as RGB;
        } else {
          result = color.map((value, channel) => value * (1 - depth * 0.08) + tint[channel] * depth) as RGB;
        }
      }
      for (let channel = 0; channel < 3; channel++) output.data[index + channel] = Math.round(result[channel]);
    }
    ctx.putImageData(output, 0, 0);
    variants[phase] = canvas;
  }
  return variants;
}

export class LightingLayer {
  readonly variants: Record<LightPhase, HTMLCanvasElement>;
  private blended = document.createElement("canvas");
  private key = "";
  constructor(source: HTMLCanvasElement, role: LightingRole) {
    this.variants = lightingVariants(source, role);
    this.blended.width = source.width;
    this.blended.height = source.height;
  }
  frame(light: DayNight): HTMLCanvasElement {
    for (const phase of LIGHT_PHASES) if (light.weights[phase] >= 0.9999) return this.variants[phase];
    const key = LIGHT_PHASES.map(phase => light.weights[phase].toFixed(3)).join(":");
    if (key !== this.key) {
      const ctx = this.blended.getContext("2d")!;
      ctx.clearRect(0, 0, this.blended.width, this.blended.height);
      ctx.globalCompositeOperation = "lighter";
      for (const phase of LIGHT_PHASES) {
        if (!light.weights[phase]) continue;
        ctx.globalAlpha = light.weights[phase];
        ctx.drawImage(this.variants[phase], 0, 0);
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
      this.key = key;
    }
    return this.blended;
  }
}

export class ValleyFog {
  private frames = [document.createElement("canvas"), document.createElement("canvas")];
  private keys = ["", ""];
  constructor() {
    for (const canvas of this.frames) { canvas.width = 500; canvas.height = 300; }
  }
  draw(ctx: CanvasRenderingContext2D, time: number, light: DayNight, depth: number) {
    const key = `${Math.floor(time / 250)}:${light.fogColor.join()}:${light.fogDensity.toFixed(3)}`;
    const canvas = this.frames[depth];
    if (this.keys[depth] !== key) {
      const fog = canvas.getContext("2d")!;
      fog.clearRect(0, 0, 500, 300);
      const center = depth ? 178 : 145;
      const density = light.fogDensity * (depth ? 0.38 : 1);
      const drift = time / (depth ? 950 : 650);
      for (let row = -7; row <= 7; row++) {
        fog.fillStyle = `rgba(${light.fogColor.join(",")},${density * Math.exp(-row * row / 17)})`;
        for (let x = 0; x < 500; x += 4) {
          const wave = Math.sin((x - drift) / 61 + depth) * 4 + Math.sin((x + drift * 0.4) / 33) * 1.5;
          fog.fillRect(x, Math.round((center + wave) / 2) * 2 + row * 2, 4, 2);
        }
      }
      this.keys[depth] = key;
    }
    ctx.drawImage(canvas, 0, 0);
  }
}

export function celestialSprite(kind: CelestialBody["kind"]): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 24;
  const ctx = canvas.getContext("2d")!;
  for (let y = 0; y < 24; y++) for (let x = 0; x < 24; x++) {
    const distance = Math.hypot(x - 11.5, y - 11.5);
    if (distance > 11 || (kind === "moon" && Math.hypot(x - 16, y - 8.5) < 10.5)) continue;
    ctx.fillStyle = kind === "moon" ? (distance > 9.5 ? "#eee1c9" : "#fff1d5")
      : distance > 9.5 ? "#eda451" : distance > 7.5 ? "#f7c16c" : "#ffe4a0";
    ctx.fillRect(x, y, 1, 1);
  }
  return canvas;
}

