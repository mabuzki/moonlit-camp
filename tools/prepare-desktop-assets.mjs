import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const source = path.join(root, "assets/export/moonlit-camp-v1");
const output = path.join(root, "public");
const scene = JSON.parse(
  fs.readFileSync(path.join(source, "scene.json"), "utf8"),
);
const weather = JSON.parse(
  fs.readFileSync(path.join(source, "weather.json"), "utf8"),
);
const tentVariants = JSON.parse(
  fs.readFileSync(path.join(source, "tent-variants.json"), "utf8"),
);
const dayNightAssets = JSON.parse(
  fs.readFileSync(path.join(source, "day-night-assets.json"), "utf8"),
);
const rearTentStates = JSON.parse(
  fs.readFileSync(path.join(source, "rear-tent-states.json"), "utf8"),
);
const rightCampProps = JSON.parse(
  fs.readFileSync(path.join(source, "right-camp-props.json"), "utf8"),
);
const tentStructure = JSON.parse(
  fs.readFileSync(path.join(source, "tent-structure.json"), "utf8"),
);
const sharedTentStates = { ...rearTentStates, closedUnlit: tentVariants.background };
const sky = scene.layers.find((layer) => layer.id === "sky");
Object.assign(sky, weather.sky);
Object.assign(sky, dayNightAssets.sky, { label: "无固定日月的天空" });
const tent = scene.layers.find((layer) => layer.id === "tent");
const originalTentRect = [...tent.drawRect];
const tentShiftX = 40;
tent.file = sharedTentStates.closedLit.file;
tent.sourceRect = sharedTentStates.closedLit.sourceRect;
tent.interactive = false;
tent.tentId = "main";
tent.label = "带完整外侧帷幔与内层门帘的主帐篷";
// The original main sprite included a bedroll to the left of the tent body.
tent.drawRect = [originalTentRect[0] + tentShiftX + originalTentRect[2] * 0.1,
  originalTentRect[1], originalTentRect[2] * 0.9, originalTentRect[3]];
scene.hitRegions = scene.hitRegions.filter((region) => region.id !== "tent" && region.id !== "woodpile");
const distantTentScale = 0.58;
const tentGroundY = tent.drawRect[1] + tent.drawRect[3];
const distantTent = {
  ...tent,
  id: "background-tent",
  tentId: "rear",
  label: "左后方按作息开关门的小帐篷",
  file: tentVariants.background.file,
  sourceRect: tentVariants.background.sourceRect,
  z: 45,
  // Keep the tent body in place after removing the bedroll at its left edge.
  drawRect: [22, tentGroundY - originalTentRect[3] * distantTentScale,
    originalTentRect[2] * distantTentScale * 0.9, originalTentRect[3] * distantTentScale],
  interactive: false,
  opacity: 0.92,
  filter: "saturate(0.5) brightness(0.65)",
};
scene.layers.splice(scene.layers.findIndex((layer) => layer.id === "tent"), 0, distantTent);
const mainBedroll = {
  id: "main-bedroll",
  label: "主帐篷旁独立分层的蓝色卷包",
  file: tentStructure.bedroll.file,
  sourceRect: tentStructure.bedroll.sourceRect,
  category: "props",
  z: 54,
  drawRect: [originalTentRect[0] + tentShiftX, tentGroundY - 23, 53, 23],
  interactive: false,
};
scene.layers.splice(scene.layers.findIndex(layer => layer.id === "tent") + 1, 0, mainBedroll);
const rightTent = {
  ...distantTent,
  id: "right-tent",
  tentId: "right",
  label: "右侧随机作息的帐篷",
  z: 50,
  drawRect: [397, tentGroundY - 84, 86, 84],
  opacity: 1,
  filter: "saturate(0.85) brightness(0.9)",
};
const woodpileIndex = scene.layers.findIndex(layer => layer.id === "woodpile");
const rightWoodpile = {
  ...scene.layers[woodpileIndex],
  label: "右帐篷靠篝火一侧的无绳柴堆",
  z: 52,
  drawRect: [354, tentGroundY - 26.24, 44, 26.24],
  interactive: false,
};
const rightBackpack = {
  id: "right-backpack",
  label: "右帐篷旁的橄榄绿直立背包",
  file: rightCampProps.backpack.file,
  sourceRect: rightCampProps.backpack.sourceRect,
  category: "props",
  z: 53,
  drawRect: [468, tentGroundY - 28, 23, 28],
  interactive: false,
};
scene.layers.splice(woodpileIndex, 1, rightTent, rightWoodpile, rightBackpack);
// Scale from the original export on every build, keeping the kettle on the ground.
const kettleScale = 0.5;
const kettle = scene.layers.find((layer) => layer.id === "kettle");
const [kettleX, kettleY, kettleWidth, kettleHeight] = kettle.drawRect;
const scaledKettle = [
  kettleX + (kettleWidth * (1 - kettleScale)) / 2 + 20,
  kettleY + kettleHeight * (1 - kettleScale),
  kettleWidth * kettleScale,
  kettleHeight * kettleScale,
];
kettle.drawRect = scaledKettle;
scene.hitRegions.find((region) => region.id === "kettle").rect = [
  ...scaledKettle,
];
scene.runtimeEffects.steam = {
  ...scene.runtimeEffects.steam,
  origin: [
    scaledKettle[0] + scaledKettle[2] * 0.53,
    scaledKettle[1] + scaledKettle[3] * 0.07,
  ],
  scale: kettleScale,
};
fs.mkdirSync(path.join(output, "art/fire"), { recursive: true });
scene.runtimeEffects.tentStates = { main: {}, rear: {}, right: {} };
for (const id of ["main", "rear", "right"]) {
  for (const [state, sprite] of Object.entries(sharedTentStates)) {
    fs.mkdirSync(path.dirname(path.join(output, "art/", sprite.file)), { recursive: true });
    fs.copyFileSync(path.join(source, sprite.file), path.join(output, "art/", sprite.file));
    scene.runtimeEffects.tentStates[id][state] = { file: "art/" + sprite.file, sourceRect: sprite.sourceRect };
  }
}
scene.layers = scene.layers.map((layer) => {
  const file = "art/" + layer.file;
  fs.mkdirSync(path.dirname(path.join(output, file)), { recursive: true });
  fs.copyFileSync(path.join(source, layer.file), path.join(output, file));
  return {
    id: layer.id,
    label: layer.label,
    file,
    z: layer.z,
    category: layer.category,
    tentId: layer.tentId,
    sourceRect: layer.sourceRect,
    drawRect: layer.drawRect,
    opacity: layer.opacity,
    filter: layer.filter,
  };
});
scene.animations = scene.animations.map((animation) => ({
  ...animation,
  frames: animation.frames.map((file, index) => {
    const bytes = fs.readFileSync(path.resolve(source, file));
    if (
      crypto.createHash("sha256").update(bytes).digest("hex") !==
      animation.frameSha256[index]
    )
      throw new Error("Original fire frame changed");
    const target = `art/fire/frame-${String(index + 1).padStart(2, "0")}.png`;
    fs.writeFileSync(path.join(output, target), bytes);
    return target;
  }),
}));
scene.weather = {
  ...weather,
  sky: { ...weather.sky, ...dayNightAssets.sky, file: "art/" + dayNightAssets.sky.file },
  order: ["sky", "moving-sun-or-moon", "twinkling-stars", "moving-clouds", "far-mountains", "valley-fog", "mid-forest", "near-hills", "camp"],
  source: "Sky without fixed celestial bodies and unlit tent edited with built-in ImageGen; day/night lighting, celestial arcs and valley fog rendered in Canvas.",
  clouds: weather.clouds.map((cloud) => {
    const file = "art/" + cloud.file;
    fs.mkdirSync(path.dirname(path.join(output, file)), { recursive: true });
    fs.copyFileSync(path.join(source, cloud.file), path.join(output, file));
    return { ...cloud, file };
  }),
};
fs.writeFileSync(path.join(output, "scene.json"), JSON.stringify(scene));
fs.writeFileSync(
  path.join(output, "art/fire/SOURCE.txt"),
  "Pixel Art Fire Asset Pack v1.2 — Devkidd\nhttps://devkidd.itch.io/pixel-fire-asset-pack\nOriginal frames used within Moonlit Camp. Personal and commercial project use permitted; attribution optional. Do not resell, redistribute or repackage the source assets as standalone files.\n",
);
const fireReadme = fs.readFileSync(path.join(root,
  "assets/third-party/devkidd-pixel-fire/Pixel fire asset pack v1.2/Thank you.txt"), "utf8");
const originalLicense = fireReadme.match(/📜 License\s*:\s*([\s\S]*?)(?=🙏 Thank You!)/)?.[1]?.trim();
if (!originalLicense) throw new Error("Original fire license was not found");
fs.writeFileSync(path.join(output, "art/fire/LICENSE.txt"),
  "Pixel Art Fire Asset Pack v1.2 — Devkidd\nOriginal license bundled with the downloaded asset pack:\n\n"
  + originalLicense + "\n\nSource: https://devkidd.itch.io/pixel-fire-asset-pack\n");
console.log(`Prepared ${scene.layers.length} static layers and 8 original fire frames.`);
