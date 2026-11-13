import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(path.resolve(path.dirname(process.execPath), "../node_modules/package.json"));
const { chromium } = require("playwright");
const native = process.argv.includes("--native");
const runtime = JSON.parse(fs.readFileSync(path.join(root, "output/runtime/" + (native ? "desktop-diagnostic.json" : "preview-server.json")), "utf8"));
const browser = native
  ? await chromium.connectOverCDP("http://127.0.0.1:" + runtime.debugPort)
  : await chromium.launch({ channel: "msedge", headless: true });
let page, original, saved, originalNativePause;
const errors = [];
const command = id => page.evaluate(id => window.__CAMP__.command(id), id);
const sample = () => page.evaluate(() => {
  const app = window.__CAMP__, state = app.state, light = app.dayNight();
  return {
    light, clock: state.clock, firePhase: state.firePhase,
    clouds: app.cloudPositions(state.clock), trees: app.treeOffsets(state.clock),
    moonPixel: app.skySample(state.clock, light.body.x, light.body.y, false, false),
  };
});
const sameTime = (before, after) => {
  assert.ok(Math.abs(before.phase - after.phase) < 1e-10, "Game time jumped");
  assert.equal(before.gameDay, after.gameDay, "Game day changed");
  assert.equal(before.body.kind, after.body.kind, "Celestial body changed");
  assert.ok(Math.abs(before.body.x - after.body.x) < 1e-6, "Celestial body jumped");
  assert.ok(Math.abs(before.fire.flame - after.fire.flame) < 1e-8, "Fire stage changed");
  assert.ok(Math.abs(before.fire.smoke - after.fire.smoke) < 1e-8, "Smoke stage changed");
  for (const id of ["main", "rear", "right"]) {
    assert.equal(before.tents[id].visual, after.tents[id].visual);
    assert.deepEqual(before.tents[id].times, after.tents[id].times, "Tent routines changed");
    for (const visual of Object.keys(before.tents[id].weights))
      assert.ok(Math.abs(before.tents[id].weights[visual] - after.tents[id].weights[visual]) < 1e-8);
  }
};

try {
  if (native) {
    page = browser.contexts()[0].pages().find(page => page.url().includes("tauri.localhost") && !page.url().includes("about"));
    assert.ok(page, "Camp WebView unavailable");
  } else {
    page = await browser.newPage({ viewport: { width: 500, height: 300 } });
    await page.goto(new URL("/dist/index.html", runtime.url).href);
  }
  page.on("pageerror", error => errors.push(error.message));
  await page.waitForFunction(() => window.__CAMP__?.ready);
  if (native) await page.waitForFunction(async () => (await window.__CAMP__.desktopStatus())?.ready);
  if (native) originalNativePause = await page.evaluate(() => window.__TAURI_INTERNALS__.invoke("load_time_pause"));
  ({ state: original, saved } = await page.evaluate(() => ({ state: { ...window.__CAMP__.state }, saved: localStorage.getItem("camp-settings") })));
  await page.evaluate(() => Object.assign(window.__CAMP__.state, {
    paused: true, timePausedAt: null, clock: 0, cycleOffset: 0,
    cycleMinutes: 20, hovered: null, fireUntil: 0, steamUntil: 0,
  }));
  await command("cycle-20");
  await command("pause-time");
  assert.equal(await page.evaluate(() => window.__CAMP__.state.timePausedAt), 0, "Pause failed at clock zero");
  await command("pause");
  const frozen = await sample();
  await page.waitForFunction(clock => window.__CAMP__.state.clock > clock + 400, frozen.clock);
  const moving = await sample();
  assert.deepEqual(moving.light, frozen.light, "Time advanced while paused");
  assert.ok(moving.firePhase > frozen.firePhase, "Fire animation stopped");
  assert.notDeepEqual(moving.clouds, frozen.clouds, "Cloud animation stopped");
  assert.notDeepEqual(moving.trees, frozen.trees, "Tree animation stopped");
  assert.deepEqual(moving.moonPixel, frozen.moonPixel, "Sky lighting or celestial body moved");

  const interactions = await page.evaluate(() => window.__CAMP__.state.interactions);
  const bounds = await page.locator("#camp").boundingBox();
  await page.locator("#camp").click({ position: { x: bounds.width * 240 / 500, y: bounds.height * 210 / 300 } });
  assert.equal(await page.evaluate(() => window.__CAMP__.state.interactions), interactions + 1);
  assert.ok(await page.evaluate(() => window.__CAMP__.state.steamUntil > performance.now()), "Kettle did not respond during time pause");

  await command("pause");
  await page.evaluate(() => { window.__CAMP__.state.clock += 3_000_000; });
  await command("cycle-20");
  const muchLater = await sample();
  assert.deepEqual(muchLater.light, frozen.light, "Paused time crossed a day boundary");
  assert.deepEqual(muchLater.moonPixel, frozen.moonPixel, "Rendered sky ignored the paused time");
  for (const minutes of [30, 45, 60, 90, 120]) {
    const before = await sample();
    await command(`cycle-${minutes}`);
    const after = await sample();
    sameTime(before.light, after.light);
    assert.equal(after.light.durationMs, minutes * 60_000);
    assert.equal(await page.evaluate(() => window.__CAMP__.state.timePausedAt), 0);
  }

  await command("pause");
  const animationResumed = await sample();
  await page.waitForFunction(clock => window.__CAMP__.state.clock > clock + 200, animationResumed.clock);
  assert.deepEqual((await sample()).light, animationResumed.light, "Resuming animations resumed paused time");
  await command("pause");
  const beforeResume = await sample();
  await command("pause-time");
  const resumed = await sample();
  sameTime(beforeResume.light, resumed.light);
  assert.equal(resumed.light.durationMs, 120 * 60_000);
  assert.equal(await page.evaluate(() => window.__CAMP__.state.timePausedAt), null);
  await page.waitForTimeout(150);
  assert.equal((await sample()).clock, resumed.clock, "Time resume overrode animation pause");
  await command("pause");
  await page.waitForFunction(clock => window.__CAMP__.state.clock > clock + 300, resumed.clock);
  const flowing = await sample();
  assert.ok(Math.abs((flowing.light.phase - resumed.light.phase + 1) % 1 - (flowing.clock - resumed.clock) / resumed.light.durationMs) < 1e-10, "Time did not resume at the selected rate");

  await command("pause");
  const beforeRapidToggle = await sample();
  await page.evaluate(() => Promise.all(Array.from({ length: 20 }, () => window.__CAMP__.command("pause-time"))));
  sameTime(beforeRapidToggle.light, (await sample()).light);
  assert.equal(await page.evaluate(() => window.__CAMP__.state.timePausedAt), null);
  await command("cycle-20");
  for (const hour of [23.99, 6, 12, 18.1]) {
    await page.evaluate(hour => Object.assign(window.__CAMP__.state, {
      clock: (2 + hour / 24 - 0.9) * 1_200_000, cycleOffset: 0,
    }), hour);
    await command("pause-time");
    const before = await sample();
    for (const minutes of [30, 120, 20]) {
      await command(`cycle-${minutes}`);
      sameTime(before.light, (await sample()).light);
    }
    const afterSpeedChanges = (await sample()).light;
    await page.evaluate(() => { window.__CAMP__.state.clock += 600_000; });
    await command("cycle-20");
    assert.deepEqual((await sample()).light, afterSpeedChanges, `Time pause failed at hour ${hour}`);
    await command("pause-time");
    sameTime(before.light, (await sample()).light);
  }
  if (!native) {
    await page.evaluate(() => Object.assign(window.__CAMP__.state, {
      clock: 3_750_000, cycleOffset: 0.97,
    }));
    await command("pause-time");
    await command("cycle-45");
    const beforeReload = await sample();
    await page.reload();
    await page.waitForFunction(() => window.__CAMP__?.ready);
    assert.equal(await page.evaluate(() => window.__CAMP__.state.timePausedAt), 0);
    await page.waitForFunction(() => window.__CAMP__.state.clock > 200);
    const afterReload = await sample();
    sameTime(beforeReload.light, afterReload.light);
    assert.equal(afterReload.light.durationMs, 45 * 60_000);
    await command("pause");
    await command("pause-time");
    sameTime(beforeReload.light, (await sample()).light);
    await page.reload();
    await page.waitForFunction(() => window.__CAMP__?.ready);
    assert.equal(await page.evaluate(() => window.__CAMP__.state.timePausedAt), null);
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(await page.evaluate(() => window.__CAMP__.errors), []);
  const result = {
    passed: true, native, pauseAtClockZero: true, timeAndRoutinesFrozen: true,
    fireCloudsAndTreesKeepAnimating: true, skyUsesPausedTime: true, kettleInteraction: true,
    speedChangesWhilePaused: true, independentAnimationPause: true, noCatchUpOnResume: true,
    rapidToggles: true, boundaryHours: [23.99, 6, 12, 18.1], errors,
  };
  fs.mkdirSync(path.join(root, "output/desktop-build"), { recursive: true });
  fs.writeFileSync(path.join(root, `output/desktop-build/time-pause-${native ? "native" : "browser"}-validation.json`), JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify(result, null, 2));
} finally {
  if (original) await page.evaluate(async ({ state, saved, native, originalNativePause }) => {
    Object.assign(window.__CAMP__.state, state);
    await window.__CAMP__.command(`cycle-${state.cycleMinutes}`);
    if (native) await window.__TAURI_INTERNALS__.invoke("save_time_pause", { pausedCycleOffset: originalNativePause });
    if (saved === null) localStorage.removeItem("camp-settings");
    else localStorage.setItem("camp-settings", saved);
  }, { state: original, saved, native, originalNativePause }).catch(error => console.error("Could not restore camp settings:", error));
  await browser.close();
}
