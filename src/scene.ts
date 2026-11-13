import { SkyEdge } from "./sky-edge";
import { WindTrees } from "./wind-trees";
import { dayNightAt, celestialSprite, LightingLayer, lightingVariants, LIGHT_PHASES, ValleyFog, type DayNight, type LightPhase, type LightingRole } from "./day-night";
import { TENT_VISUALS, TENT_IDS, type TentVisual, type TentId } from "./tent-schedule";
import { t } from "./i18n";

export type Rect = [number, number, number, number];
export interface Layer {
  id: string;
  label: string;
  file: string;
  z: number;
  category: string;
  sourceRect: Rect;
  drawRect: Rect;
  opacity?: number;
  filter?: string;
  tentId?: TentId;
}
export interface Scene {
  layers: Layer[];
  animations: { frames: string[]; frameDurationMs: number; drawRect: Rect }[];
  hitRegions: { id: string; rect: Rect }[];
  runtimeEffects: {
    steam: { origin: [number, number]; scale?: number };
    tentStates: Record<TentId, Record<TentVisual, { file: string; sourceRect: Rect }>>;
  };
  weather: {
    clouds: {
      file: string;
      sourceRect: Rect;
      width: number;
      height: number;
      y: number;
      initialX: number;
      speed: number;
      flip: boolean;
    }[];
    stars: {
      x: number;
      y: number;
      size: number;
      phase: number;
      period: number;
    }[];
  };
}
export interface CampState {
  pinned: boolean;
  muted: boolean;
  paused: boolean;
  timePausedAt: number | null;
  steam: boolean;
  hovered: string | null;
  fireUntil: number;
  steamUntil: number;
  frameDuration: number;
  clock: number;
  firePhase: number;
  frameIndex: number;
  interactions: number;
  zoom: number;
  cycleMinutes: number;
  cycleOffset: number;
  tentSeed: number;
}

export async function loadScene(): Promise<{
  scene: Scene;
  images: Map<string, HTMLImageElement>;
}> {
  const response = await fetch("./scene.json");
  if (!response.ok) throw new Error(t("sceneConfigFailed"));
  const scene: Scene = await response.json();
  const images = new Map<string, HTMLImageElement>();
  await Promise.all(
    [
      ...new Set([
        ...scene.layers.map((layer) => layer.file),
        ...scene.animations[0].frames,
        ...scene.weather.clouds.map((cloud) => cloud.file),
        ...Object.values(scene.runtimeEffects.tentStates).flatMap(variants => Object.values(variants).map(variant => variant.file)),
      ]),
    ].map(
      (file) =>
        new Promise<void>((resolve, reject) => {
          const image = new Image();
          image.onload = () => {
            images.set(file, image);
            resolve();
          };
          image.onerror = () => reject(new Error(t("assetLoadFailed", file)));
          image.src = new URL(file, document.baseURI).href;
        }),
    ),
  );
  return { scene, images };
}

export class CampRenderer {
  readonly canvas: HTMLCanvasElement;
  readonly scene: Scene;
  readonly images: Map<string, HTMLImageElement>;
  private ctx: CanvasRenderingContext2D;
  private background = document.createElement("canvas");
  private skyBase = document.createElement("canvas");
  private skyFrame = document.createElement("canvas");
  private nearSource = document.createElement("canvas");
  private windTrees!: WindTrees;
  private litTrees!: Record<LightPhase, WindTrees>;
  private nearFrame = document.createElement("canvas");
  private skyLighting!: LightingLayer;
  private litLayers = new Map<string, LightingLayer>();
  private litClouds: LightingLayer[] = [];
  private tentStates = new Map<TentId, Map<TentVisual, LightingLayer>>();
  private tentFrames = new Map<TentId, HTMLCanvasElement>();
  private fog = new ValleyFog();
  private celestial = { moon: celestialSprite("moon"), sun: celestialSprite("sun") };
  private skyEdge: SkyEdge;
  private skyContext: CanvasRenderingContext2D;
  private ratio = 1;
  private zoom = 1;
  private groundLine = 300;
  private cycleMinutes = 20;
  private cycleOffset = 0;
  private timePausedAt: number | null = null;
  private tentSeed = 0;
  constructor(
    canvas: HTMLCanvasElement,
    scene: Scene,
    images: Map<string, HTMLImageElement>,
  ) {
    this.canvas = canvas;
    this.scene = scene;
    this.images = images;
    this.groundLine = this.measureGroundBaseline();
    const sky = scene.layers.find(layer => layer.id === "sky")!;
    this.skyEdge = new SkyEdge(images.get(sky.file)!, sky.sourceRect, sky.drawRect);
    this.ctx = canvas.getContext("2d", { alpha: true })!;
    this.skyContext = this.skyFrame.getContext("2d", {
      willReadFrequently: true,
    })!;
  }
  resize(zoom = this.zoom) {
    this.zoom = zoom;
    this.ratio = Math.max(0.5, (window.devicePixelRatio || 1) * zoom);
    this.canvas.width = Math.round(500 * this.ratio);
    this.canvas.height = Math.round(300 * this.ratio);
    this.background.width = this.canvas.width;
    this.background.height = this.canvas.height;
    this.skyBase.width = this.skyFrame.width = this.canvas.width;
    this.skyBase.height = this.skyFrame.height = this.canvas.height;
    this.nearSource.width = this.canvas.width;
    this.nearSource.height = this.canvas.height;
    this.nearFrame.width = this.canvas.width;
    this.nearFrame.height = this.canvas.height;
    const skyContext = this.skyBase.getContext("2d")!;
    skyContext.setTransform(this.ratio, 0, 0, this.ratio, 0, 0);
    skyContext.imageSmoothingEnabled = false;
    this.skyEdge.extendTexture(skyContext);
    this.layer(
      skyContext,
      this.scene.layers.find((layer) => layer.id === "sky")!,
    );
    this.skyLighting = new LightingLayer(this.skyBase, "sky");
    this.litLayers.clear();
    for (const layer of this.scene.layers.filter(layer => layer.id !== "sky" && layer.id !== "near" && layer.id !== "toolbar")) {
      const role: LightingRole = layer.id === "far" ? "far" : layer.id === "middle" ? "middle" : "props";
      this.litLayers.set(layer.id, this.cacheLayer(layer, role));
    }
    this.tentStates.clear();
    this.tentFrames.clear();
    for (const id of TENT_IDS) {
      const tent = this.scene.layers.find(layer => layer.tentId === id)!;
      const states = new Map<TentVisual, LightingLayer>();
      for (const visual of TENT_VISUALS) {
        states.set(visual, this.cacheLayer({ ...tent, ...this.scene.runtimeEffects.tentStates[id][visual] }, "props"));
      }
      const frame = document.createElement("canvas");
      frame.width = states.get("closedLit")!.variants.night.width;
      frame.height = states.get("closedLit")!.variants.night.height;
      this.tentStates.set(id, states);
      this.tentFrames.set(id, frame);
    }
    this.litClouds = this.scene.weather.clouds.map(cloud => this.cacheLayer({
      id: "cloud", label: "cloud", category: "weather", z: 0,
      file: cloud.file, sourceRect: cloud.sourceRect, drawRect: [0, 0, cloud.width, cloud.height],
    }, "cloud"));
    const ctx = this.background.getContext("2d")!;
    ctx.setTransform(this.ratio, 0, 0, this.ratio, 0, 0);
    ctx.imageSmoothingEnabled = false;
    for (const layer of this.scene.layers.filter(
      (layer) =>
        layer.category === "background" &&
        layer.id !== "near" &&
        layer.id !== "sky",
    ))
      this.layer(ctx, layer);
    const nearContext = this.nearSource.getContext("2d")!;
    nearContext.setTransform(this.ratio, 0, 0, this.ratio, 0, 0);
    nearContext.imageSmoothingEnabled = false;
    this.layer(
      nearContext,
      this.scene.layers.find((layer) => layer.id === "near")!,
    );
    this.windTrees = new WindTrees(this.nearSource, this.ratio);
    const nearVariants = lightingVariants(this.nearSource, "near");
    this.litTrees = Object.fromEntries(LIGHT_PHASES.map(phase => [phase,
      phase === "night" ? this.windTrees : new WindTrees(nearVariants[phase], this.ratio),
    ])) as Record<LightPhase, WindTrees>;
  }
  private cacheLayer(layer: Layer, role: LightingRole): LightingLayer {
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(layer.drawRect[2] * this.ratio));
    canvas.height = Math.max(1, Math.round(layer.drawRect[3] * this.ratio));
    const ctx = canvas.getContext("2d")!;
    ctx.imageSmoothingEnabled = false;
    this.layer(ctx, { ...layer, drawRect: [0, 0, canvas.width, canvas.height] });
    return new LightingLayer(canvas, role);
  }
  private litLayer(ctx: CanvasRenderingContext2D, layer: Layer, light: DayNight) {
    const id = layer.tentId;
    if (id) {
      const frame = this.tentFrames.get(id)!;
      const states = this.tentStates.get(id)!;
      const weights = light.tents[id].weights;
      const target = frame.getContext("2d")!;
      target.clearRect(0, 0, frame.width, frame.height);
      target.globalCompositeOperation = "lighter";
      for (const visual of TENT_VISUALS) {
        if (!weights[visual]) continue;
        target.globalAlpha = weights[visual];
        target.drawImage(states.get(visual)!.frame(light), 0, 0);
      }
      target.globalAlpha = 1;
      target.globalCompositeOperation = "source-over";
      ctx.drawImage(frame, ...layer.drawRect);
    } else ctx.drawImage(this.litLayers.get(layer.id)!.frame(light), ...layer.drawRect);
  }
  private drawTrees(ctx: CanvasRenderingContext2D, time: number, light: DayNight) {
    const target = this.nearFrame.getContext("2d")!;
    target.setTransform(this.ratio, 0, 0, this.ratio, 0, 0);
    target.clearRect(0, 0, 500, 300);
    target.imageSmoothingEnabled = false;
    target.globalCompositeOperation = "lighter";
    for (const phase of LIGHT_PHASES) {
      if (!light.weights[phase]) continue;
      target.globalAlpha = light.weights[phase];
      this.litTrees[phase].draw(target, time);
    }
    target.globalAlpha = 1;
    target.globalCompositeOperation = "source-over";
    ctx.drawImage(this.nearFrame, 0, 0, 500, 300);
  }
  cloudPositions(time: number) {
    return this.scene.weather.clouds.map((cloud) => {
      const span = 500 + cloud.width + 40;
      const x =
        ((((cloud.initialX + (time / 1000) * cloud.speed + cloud.width + 20) %
          span) +
          span) %
          span) -
        cloud.width -
        20;
      return { ...cloud, x };
    });
  }
  private renderSky(time: number, clouds = true, stars = true) {
    const light = dayNightAt(this.timePausedAt ?? time, this.cycleMinutes, this.cycleOffset, this.tentSeed);
    const ctx = this.skyContext;
    ctx.setTransform(this.ratio, 0, 0, this.ratio, 0, 0);
    ctx.clearRect(0, 0, 500, 300);
    ctx.save();
    ctx.clip(this.skyEdge.path(time));
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.skyLighting.frame(light), 0, 0, 500, 300);
    const body = light.body;
    ctx.drawImage(this.celestial[body.kind], Math.round(body.x - 12), Math.round(body.y - 12));
    if (stars)
      for (const star of this.scene.weather.stars) {
        const pulse =
          (Math.sin((time / star.period) * Math.PI * 2 + star.phase) + 1) / 2;
        ctx.fillStyle = `rgba(249,239,207,${(0.16 + 0.84 * pulse * pulse) * light.stars})`;
        ctx.fillRect(star.x, star.y, star.size, star.size);
        if (star.size > 1) {
          ctx.fillRect(star.x - 1, star.y, star.size + 2, 1);
          ctx.fillRect(star.x, star.y - 1, 1, star.size + 2);
        }
      }
    // Clouds are drawn after the celestial lights, so their opaque cores occlude them.
    if (clouds)
      for (const [index, cloud] of this.cloudPositions(time).entries()) {
        ctx.save();
        if (cloud.flip) {
          ctx.translate(cloud.x + cloud.width, cloud.y);
          ctx.scale(-1, 1);
          ctx.drawImage(
            this.litClouds[index].frame(light),
            0,
            0,
            cloud.width,
            cloud.height,
          );
        } else
          ctx.drawImage(
            this.litClouds[index].frame(light),
            cloud.x,
            cloud.y,
            cloud.width,
            cloud.height,
          );
        ctx.restore();
      }
    ctx.restore();
    return this.skyFrame;
  }
  edgeProfile(time: number) { return this.skyEdge.profile(time); }
  treeOffsets(time: number) { return this.windTrees.offsets(time); }
  sampleSky(time: number, x: number, y: number, clouds = true, stars = true) {
    this.renderSky(time, clouds, stars);
    return [
      ...this.skyContext.getImageData(
        Math.round(x * this.ratio),
        Math.round(y * this.ratio),
        1,
        1,
      ).data,
    ];
  }
  private layer(ctx: CanvasRenderingContext2D, layer: Layer) {
    const styled = layer.opacity !== undefined || layer.filter !== undefined;
    if (styled) {
      ctx.save();
      ctx.globalAlpha *= layer.opacity ?? 1;
      ctx.filter = layer.filter ?? "none";
    }
    ctx.drawImage(
      this.images.get(layer.file)!,
      ...layer.sourceRect,
      ...layer.drawRect,
    );
    if (styled) ctx.restore();
  }
  hit(x: number, y: number): string | null {
    if (y >= this.groundLine) return null;
    return (
      this.scene.hitRegions.find(
        ({ rect: [a, b, w, h] }) =>
          x >= a && x <= a + w && y >= b && y <= b + h,
      )?.id ?? null
    );
  }
  private drawFlame(ctx: CanvasRenderingContext2D, image: HTMLImageElement, rect: Rect, flame: number, opacity: number) {
    if (flame <= 0) return;
    const [x, y, width, height] = rect;
    const scaledWidth = width * Math.pow(flame, 0.28);
    const scaledHeight = height * Math.sqrt(flame);
    ctx.save();
    ctx.globalAlpha = opacity * Math.min(1, flame / 0.08);
    // Shrink towards the wood, with a shared bottom-center pivot for both flame layers.
    ctx.drawImage(image, x + (width - scaledWidth) / 2, y + height - scaledHeight, scaledWidth, scaledHeight);
    ctx.restore();
  }
  private drawFireSmoke(ctx: CanvasRenderingContext2D, time: number, light: DayNight) {
    if (light.fire.smoke <= 0) return;
    const [x, y, width, height] = this.scene.animations[0].drawRect;
    const originX = x + width / 2, originY = y + height - 15;
    for (let index = 0; index < 14; index++) {
      const life = (time / 4200 + index / 14) % 1;
      const drift = Math.sin(life * 5 + index * 1.7) * (2 + life * 5) + life * 7;
      const px = Math.round((originX + drift - 2) / 2) * 2;
      const py = Math.round((originY - life * 58) / 2) * 2;
      const size = 2 + Math.floor(life * 3) * 2;
      const alpha = light.fire.smoke * Math.sin(life * Math.PI) * 0.28;
      ctx.fillStyle = `rgba(159,166,167,${alpha})`;
      ctx.fillRect(px, py, size + 2, size);
      ctx.fillRect(px - 2, py + 2, size + 4, Math.max(2, size - 2));
    }
  }
  draw(state: CampState) {
    this.cycleMinutes = state.cycleMinutes;
    this.cycleOffset = state.cycleOffset;
    this.timePausedAt = state.timePausedAt;
    this.tentSeed = state.tentSeed;
    const light = dayNightAt(state.timePausedAt ?? state.clock, this.cycleMinutes, this.cycleOffset, this.tentSeed);
    const ctx = this.ctx;
    ctx.setTransform(this.ratio, 0, 0, this.ratio, 0, 0);
    ctx.clearRect(0, 0, 500, 300);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, 500, this.groundLine);
    ctx.clip();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.renderSky(state.clock), 0, 0, 500, 300);
    ctx.save();
    ctx.clip(this.skyEdge.path(state.clock));
    for (const layer of this.scene.layers.filter(layer => layer.category === "background" && layer.id !== "sky" && layer.id !== "near")) {
      this.litLayer(ctx, layer, light);
      this.fog.draw(ctx, state.clock, light, layer.id === "far" ? 0 : 1);
    }
    ctx.restore();
    this.drawTrees(ctx, state.clock, light);
    if (state.steam && light.fire.heat > 0) {
      const boost = state.steamUntil > performance.now();
      const {
        origin: [steamX, steamY],
        scale: steamScale = 1,
      } = this.scene.runtimeEffects.steam;
      for (let i = 0; i < (boost ? 12 : 8); i++) {
        const phase = (state.clock / 2100 + i / 8) % 1;
        ctx.fillStyle = `rgba(197,198,198,${(1 - phase) * (boost ? 0.6 : 0.4) * light.fire.heat})`;
        ctx.fillRect(
          Math.round(steamX + Math.sin(phase * 8 + i * 0.3) * 2 * steamScale),
          Math.round(steamY - phase * (boost ? 44 : 32) * steamScale),
          Math.max(1, Math.round(2 * steamScale)),
          Math.max(1, Math.round(3 * steamScale)),
        );
      }
    }
    for (const layer of this.scene.layers.filter(
      (layer) =>
        layer.category !== "background" &&
        layer.id !== "toolbar" &&
        layer.z < 55,
    ))
      this.litLayer(ctx, layer, light);
    const fire = this.scene.animations[0];
    state.frameIndex = Math.floor(state.firePhase) % fire.frames.length;
    const fireFrame = this.images.get(fire.frames[state.frameIndex])!;
    this.drawFlame(ctx, fireFrame, fire.drawRect, light.fire.flame, 1);
    this.drawFireSmoke(ctx, state.clock, light);
    for (const layer of this.scene.layers.filter(
      (layer) =>
        layer.category !== "background" &&
        layer.id !== "toolbar" &&
        layer.z >= 55,
    ))
      this.litLayer(ctx, layer, light);

    // Share one frame and transform so both sides of the logs stay synchronized.
    this.drawFlame(ctx, fireFrame, fire.drawRect, light.fire.flame, 0.4);

    if (state.hovered) {
      const rect = this.scene.hitRegions.find(
        (region) => region.id === state.hovered,
      )?.rect;
      if (rect) {
        const [x, y, w, h] = rect;
        ctx.strokeStyle = "#e9be79";
        ctx.lineWidth = 0.65;
        ctx.beginPath();
        for (const [a, b, s, t] of [
          [x, y, 1, 1],
          [x + w, y, -1, 1],
          [x, y + h, 1, -1],
          [x + w, y + h, -1, -1],
        ]) {
          ctx.moveTo(a + s * 4, b);
          ctx.lineTo(a, b);
          ctx.lineTo(a, b + t * 4);
        }
        ctx.stroke();
      }
    }
    ctx.restore();
  }
  private footprint(time: number): HTMLCanvasElement {
    const mask = document.createElement("canvas");
    mask.width = 500;
    mask.height = 300;
    const ctx = mask.getContext("2d", { willReadFrequently: true })!;
    ctx.beginPath();
    ctx.rect(0, 0, 500, this.groundLine);
    ctx.clip();
    ctx.imageSmoothingEnabled = false;
    // Use the same moving silhouette for rendering and native cursor hit testing.
    ctx.drawImage(this.renderSky(time, false, false), 0, 0, 500, 300);
    ctx.save();
    ctx.clip(this.skyEdge.path(time));
    ctx.drawImage(this.background, 0, 0, 500, 300);
    ctx.restore();
    this.windTrees.draw(ctx, time);
    for (const layer of this.scene.layers.filter(
      (layer) => layer.category !== "background" && layer.id !== "toolbar",
    ))
      this.layer(ctx, layer);
    return mask;
  }
  visibleBottom(): number {
    const canvas = this.footprint(0);
    const pixels = canvas.getContext("2d")!.getImageData(0, 0, 500, 300).data;
    for (let y = 299; y >= 0; y--)
      for (let x = 0; x < 500; x++)
        if (pixels[(y * 500 + x) * 4 + 3] > 0) return y + 1;
    return 300;
  }
  private measureGroundBaseline(): number {
    const ground = this.scene.layers.find(layer => layer.id === "ground");
    if (!ground) return 300;
    const canvas = document.createElement("canvas");
    canvas.width = 500;
    canvas.height = 300;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    ctx.imageSmoothingEnabled = false;
    this.layer(ctx, ground);
    const pixels = ctx.getImageData(0, 0, 500, 300).data;
    const coverage = Array.from({ length: 300 }, (_, y) => {
      let width = 0;
      for (let x = 0; x < 500; x++)
        if (pixels[(y * 500 + x) * 4 + 3] >= 128) width++;
      return width;
    });
    // Use the continuous platform, excluding isolated rocks and hanging grass tips.
    const threshold = Math.max(...coverage) * 0.7;
    if (!threshold) return 300;
    for (let y = 299; y >= 0; y--)
      if (coverage[y] >= threshold) return y + 1;
    return 300;
  }
  groundBaseline(): number { return this.groundLine; }
  mask(time = 0): number[][][] {
    const mask = this.footprint(time);
    const ctx = mask.getContext("2d", { willReadFrequently: true })!;
    ctx.fillStyle = "#fff";
    ctx.fillRect(252, 117, 80, 107);

    const pixels = ctx.getImageData(0, 0, 500, 300).data;
    return Array.from({ length: 300 }, (_, y) => {
      const spans: number[][] = [];
      let start = -1;
      for (let x = 0; x <= 500; x++) {
        const hit = x < 500 && pixels[(y * 500 + x) * 4 + 3] >= 16;
        if (hit && start < 0) start = x;
        if (!hit && start >= 0) {
          spans.push([start, x]);
          start = -1;
        }
      }
      return spans;
    });
  }
}
