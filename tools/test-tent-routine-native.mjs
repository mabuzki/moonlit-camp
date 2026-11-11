import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(path.resolve(path.dirname(process.execPath), "../node_modules/package.json"));
const { chromium } = require("playwright");
const diagnostic = JSON.parse(fs.readFileSync("output/runtime/desktop-diagnostic.json", "utf8"));
const browser = await chromium.connectOverCDP("http://127.0.0.1:" + diagnostic.debugPort);
const ids = ["main", "rear", "right"];
let page, original;
try {
  for (let attempt = 0; attempt < 100; attempt++) {
    page = browser.contexts()[0].pages().find(page => page.url().includes("tauri.localhost") && !page.url().includes("about"));
    if (page) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(page, "Camp WebView unavailable");
  await page.waitForFunction(async () => window.__CAMP__?.ready && (await window.__CAMP__.desktopStatus())?.ready);
  original = await page.evaluate(() => ({ zoom: window.__CAMP__.state.zoom, cycle: window.__CAMP__.state.cycleMinutes, paused: window.__CAMP__.state.paused }));
  const manifest = await page.evaluate(async () => (await fetch("./scene.json")).json());
  const rightTent = manifest.layers.find(layer => layer.tentId === "right");
  const woodpile = manifest.layers.find(layer => layer.id === "woodpile");
  const backpack = manifest.layers.find(layer => layer.id === "right-backpack");
  assert.ok(woodpile && backpack);
  assert.ok(woodpile.drawRect[0] > 328 && woodpile.drawRect[0] + woodpile.drawRect[2] <= rightTent.drawRect[0] + 2);
  assert.ok(backpack.drawRect[0] + backpack.drawRect[2] < 495);
  assert.ok([woodpile, backpack].every(layer => Math.abs(layer.drawRect[1] + layer.drawRect[3] - 222.76) < 0.001));
  assert.ok(!manifest.hitRegions.some(region => region.id === "woodpile"));
  const layers = manifest.layers.filter(layer => layer.tentId);
  assert.equal(layers.length, 3);
  assert.ok(layers.every(layer => Math.abs(layer.drawRect[1] + layer.drawRect[3] - 222.76) < 0.001));
  const duration = await page.evaluate(() => window.__CAMP__.dayNight().durationMs);
  const atHour = (hour, day = 1) => (day + hour / 24 - 0.9) * duration;
  const today = await page.evaluate(time => window.__CAMP__.dayNight(time).tents, atHour(12));
  const scenarios = [
    { name: "morning-closed", hour: 6.5, expected: Object.fromEntries(ids.map(id => [id, "closedUnlit"])) },
    { name: "day-open", hour: 12, expected: Object.fromEntries(ids.map(id => [id, "openUnlit"])) },
    { name: "evening-lit", hour: 19, expected: Object.fromEntries(ids.map(id => [id, "openLit"])) },
    { name: "night-closed-lit", hour: 22.99, expected: Object.fromEntries(ids.map(id => [id, "closedLit"])) },
    { name: "night-dark", hour: 23.99, expected: Object.fromEntries(ids.map(id => [id, "closedUnlit"])) },
  ];
  for (const [event, before, after] of [["open", "closedUnlit", "openUnlit"], ["close", "openLit", "closedLit"], ["off", "closedLit", "closedUnlit"]]) {
    const order = [...ids].sort((a, b) => today[a].times[event] - today[b].times[event]);
    scenarios.push({ name: event + "-first", hour: today[order[0]].times[event] + 0.26,
      expected: Object.fromEntries(ids.map(id => [id, id === order[0] ? after : before])) });
  }
  const stages = [];
  for (const scenario of scenarios) {
    await page.evaluate(time => {
      const state = window.__CAMP__.state;
      state.paused = true; state.cycleOffset = 0; state.clock = time; state.hovered = null;
    }, atHour(scenario.hour));
    await page.waitForTimeout(120);
    const sample = await page.evaluate(() => {
      const app = window.__CAMP__, canvas = document.querySelector("#camp"), ctx = canvas.getContext("2d"), ratio = canvas.width / 500;
      const probes = { main: [132, 190], rear: [56, 205], right: [440, 200] };
      const pixels = Object.fromEntries(Object.entries(probes).map(([id, [x, y]]) => {
        const size = Math.max(1, Math.round(5 * ratio));
        const data = ctx.getImageData(Math.round((x - 2) * ratio), Math.round((y - 2) * ratio), size, size).data;
        const average = [0, 0, 0, 0];
        for (let index = 0; index < data.length; index++) average[index % 4] += data[index] / (size * size);
        return [id, average];
      }));
      return { tents: app.dayNight().tents, pixels };
    });
    for (const id of ids) assert.ok(Math.abs(sample.tents[id].weights[scenario.expected[id]] - 1) < 1e-8);
    stages.push({ ...scenario, ...sample });
    await page.screenshot({ path: "output/desktop-build/native-three-tents-" + scenario.name + ".png", omitBackground: true });
  }
  for (const id of ids) {
    assert.ok(stages[2].pixels[id][0] > stages[1].pixels[id][0] + 25, id + " lamp did not light the open door");
    assert.ok(stages[3].pixels[id][0] > stages[4].pixels[id][0] + 20, id + " lamp did not turn off behind the closed door");
  }
  await page.evaluate(time => { window.__CAMP__.state.clock = time; }, atHour(19, 7));
  const beforeSpeed = await page.evaluate(() => window.__CAMP__.dayNight());
  await page.evaluate(() => window.__CAMP__.command("cycle-120"));
  const afterSpeed = await page.evaluate(() => window.__CAMP__.dayNight());
  assert.equal(afterSpeed.gameDay, beforeSpeed.gameDay);
  assert.ok(Math.abs(afterSpeed.phase - beforeSpeed.phase) < 1e-10);
  for (const id of ids) assert.deepEqual(afterSpeed.tents[id].times, beforeSpeed.tents[id].times);
  await page.evaluate(() => window.__CAMP__.command("zoom-150"));
  const status = await page.evaluate(() => window.__CAMP__.desktopStatus());
  assert.equal(status.physicalY + Math.round(status.height * status.scaleFactor), status.workAreaBottomPhysical);
  const paused = await page.evaluate(() => window.__CAMP__.dayNight().tents);
  await page.waitForTimeout(180);
  assert.deepEqual(await page.evaluate(() => window.__CAMP__.dayNight().tents), paused);
  const errors = await page.evaluate(() => window.__CAMP__.errors);
  assert.deepEqual(errors, []);
  const result = { passed: true, scaleFactor: status.scaleFactor, stages, rightTentProps: true,
    cycle120PreservesDayAndRoutines: true, zoom150GroundAtTaskbar: true, pauseFreezesAllTents: true, errors };
  fs.writeFileSync("output/desktop-build/tent-routine-native-validation.json", JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify({ passed: true, tents: ids, scenarios: stages.length, rightTentProps: true, scaleFactor: status.scaleFactor, errors }, null, 2));
} finally {
  if (original) await page.evaluate(async value => {
    await window.__CAMP__.command("zoom-" + Math.round(value.zoom * 100));
    await window.__CAMP__.command("cycle-" + value.cycle);
    window.__CAMP__.state.paused = value.paused;
  }, original).catch(() => {});
  await browser.close();
}
