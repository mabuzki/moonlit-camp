import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(
  path.resolve(path.dirname(process.execPath), "../node_modules/package.json"),
);
const { chromium } = require("playwright");
const server = JSON.parse(
  fs.readFileSync(
    path.join(root, "output/runtime/preview-server.json"),
    "utf8",
  ),
);
const url = new URL("/dist/index.html", server.url).href;
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 500, height: 300 },
    deviceScaleFactor: 1,
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(url);
  await page.waitForFunction(() => window.__CAMP__?.ready);
  assert.deepEqual(
    await page
      .locator("#app")
      .evaluate((el) => [el.clientWidth, el.clientHeight]),
    [500, 300],
  );
  assert.equal(
    await page
      .locator("body")
      .evaluate((el) => getComputedStyle(el).backgroundColor),
    "rgba(0, 0, 0, 0)",
  );
  assert.equal(
    await page
      .locator("#camp")
      .evaluate((el) => el.getContext("2d").getImageData(0, 0, 1, 1).data[3]),
    0,
  );
  let before = await page.evaluate(() => window.__CAMP__.state.frameIndex);
  await page.waitForTimeout(230);
  assert.notEqual(
    await page.evaluate(() => window.__CAMP__.state.frameIndex),
    before,
  );
  await page.mouse.move(290, 160);
  await page.mouse.click(290, 160);
  assert.equal(
    await page.evaluate(() => window.__CAMP__.state.interactions),
    1,
  );
  assert.ok(
    await page.evaluate(
      () => window.__CAMP__.state.fireUntil > performance.now(),
    ),
  );
  await page.mouse.click(240, 210);
  assert.ok(
    await page.evaluate(
      () => window.__CAMP__.state.steamUntil > performance.now(),
    ),
  );
  await page.evaluate(() => { window.__CAMP__.state.paused = true; });
  await page.waitForTimeout(80);
  const litTentPixel = await page.locator("#camp").evaluate(canvas => [...canvas.getContext("2d").getImageData(132, 190, 1, 1).data]);
  assert.ok(litTentPixel[0] > litTentPixel[2], "Main tent does not have a warm light by default");
  const tentInteractions = await page.evaluate(() => window.__CAMP__.state.interactions);
  await page.mouse.move(132, 190);
  assert.equal(await page.evaluate(() => window.__CAMP__.state.hovered), null);
  await page.mouse.click(132, 190);
  await page.waitForTimeout(80);
  assert.equal(await page.evaluate(() => window.__CAMP__.state.interactions), tentInteractions);
  assert.deepEqual(await page.locator("#camp").evaluate(canvas => [...canvas.getContext("2d").getImageData(132, 190, 1, 1).data]), litTentPixel, "Tent click changed the default lighting");
  await page.evaluate(() => { window.__CAMP__.state.paused = false; });
  // Commands are shared by the native tray handler and this browser preview.
  const command = id => page.evaluate(id => window.__CAMP__.command(id), id);
  const initialPin = await page.evaluate(() => window.__CAMP__.state.pinned);
  await command("pin");
  assert.notEqual(await page.evaluate(() => window.__CAMP__.state.pinned), initialPin);
  await command("steam");
  assert.equal(await page.evaluate(() => window.__CAMP__.state.steam), false);
  await command("passthrough");
  assert.equal(await page.evaluate(() => window.__CAMP__.passthrough), false);
  await command("passthrough");
  await command("speed-70");
  assert.equal(await page.evaluate(() => window.__CAMP__.state.frameDuration), 70);
  await command("speed-100");
  await command("pause");
  const paused = await page.evaluate(() => window.__CAMP__.state.frameIndex);
  await page.waitForTimeout(2400);
  assert.equal(await page.evaluate(() => window.__CAMP__.state.frameIndex), paused);
  await command("pause");
  await page.mouse.move(400, 40);
  assert.equal(await page.locator(".toolbar, .settings, #toolbar-art").count(), 0);
  const drags = await page.evaluate(() => window.__CAMP__.dragRequests);
  await page.mouse.move(340, 170);
  await page.mouse.down();
  await page.mouse.move(360, 175);
  await page.mouse.up();
  assert.equal(
    await page.evaluate(() => window.__CAMP__.dragRequests),
    drags + 1,
  );
  const mask = await page.evaluate(() => window.__CAMP__.mask());
  assert.equal(await page.evaluate(() => window.__CAMP__.visibleBottom()), 230);
  assert.equal(await page.evaluate(() => window.__CAMP__.groundBaseline()), 230);
  assert.equal(mask.length, 300);
  assert.equal(mask[0].length, 0);
  assert.ok(mask.slice(230).every(row => row.length === 0), "Clipped foreground still catches the mouse");
  assert.ok(mask[200].some(([a, b]) => a <= 440 && b > 440));
  assert.ok(!mask[40].some(([a, b]) => a <= 400 && b > 400));
  await page.setViewportSize({ width: 1000, height: 600 });
  await command("zoom-150");
  assert.equal(await page.evaluate(() => window.__CAMP__.state.zoom), 1.5);
  assert.deepEqual(await page.locator("#camp").evaluate(el => [el.getBoundingClientRect().width, el.getBoundingClientRect().height]), [750, 450]);
  const interactions = await page.evaluate(() => window.__CAMP__.state.interactions);
  await page.locator("#camp").click({ position: { x: 435, y: 240 } });
  assert.equal(await page.evaluate(() => window.__CAMP__.state.interactions), interactions + 1);
  for (const zoom of [70, 80, 90, 100, 110, 120, 130, 140, 150]) {
    await command(`zoom-${zoom}`);
    assert.equal(await page.evaluate(() => window.__CAMP__.state.zoom), zoom / 100);
    assert.ok(Math.abs(await page.evaluate(() => window.__CAMP__.visibleBottom()) - 230) <= 1);
    assert.equal(await page.evaluate(() => window.__CAMP__.groundBaseline()), 230);
    assert.equal(await page.evaluate(() => {
      const canvas = document.querySelector("#camp"), app = window.__CAMP__;
      const top = Math.ceil(app.groundBaseline() * Math.max(0.5, devicePixelRatio * app.state.zoom));
      const data = canvas.getContext("2d").getImageData(0, top, canvas.width, canvas.height - top).data;
      for (let index = 3; index < data.length; index += 4) if (data[index]) return false;
      return true;
    }), true, "Foreground decorations remain below the ground clip");
  }
  await command("zoom-100");
  await page.setViewportSize({ width: 500, height: 300 });
  await command("pause");
  await page.evaluate(() => {
    window.__CAMP__.state.clock = 0;
    window.__CAMP__.state.steam = false;
    window.__CAMP__.state.hovered = null;
  });
  await page.waitForTimeout(80);
  const motionFrame = () => page.evaluate(() => {
    const canvas = document.querySelector("#camp"), ctx = canvas.getContext("2d");
    const alpha = [];
    const pixels = ctx.getImageData(110, 20, 300, 105).data;
    for (let i = 3; i < pixels.length; i += 4) alpha.push(pixels[i]);
    const skyTops = [];
    const profile = window.__CAMP__.edgeProfile(window.__CAMP__.state.clock);
    const treePixels = ctx.getImageData(45, 74, 35, 25).data;
    let protrudingTreePixels = 0;
    for (let y = 0; y < 25; y++) for (let x = 0; x < 35; x++) {
      if (treePixels[(y * 35 + x) * 4 + 3] > 128 && y + 74 < profile[Math.floor((x + 45) / 2)].y - 2) protrudingTreePixels++;
    }
    for (let x = 110; x <= 390; x += 2) {
      let top = 300;
      for (let y = 0; y < 105; y++) {
        if (pixels[(y * 300 + x - 110) * 4 + 3] >= 128) { top = y + 20; break; }
      }
      skyTops.push(top);
    }
    return {
      alpha,
      protrudingTreePixels,
      canvasSize: [canvas.width, canvas.height],
      renderCount: window.__CAMP__.renderCount,
      skyTops,
      expectedSkyTops: window.__CAMP__.edgeProfile(window.__CAMP__.state.clock)
        .filter(point => point.x >= 110 && point.x <= 390).map(point => point.y),
      trees: [...ctx.getImageData(45, 74, 35, 25).data],
      ground: [...ctx.getImageData(0, 224, 500, 12).data],
      treeAlpha: ctx.getImageData(60, 80, 1, 1).data[3],
      skyAlpha: window.__CAMP__.skySample(0, 60, 80, false, false)[3],
    };
  });
  const motionStart = await motionFrame();
  assert.ok(motionStart.protrudingTreePixels > 50 && motionStart.skyAlpha === 0, "Foreground pine was clipped to the sky boundary: " + JSON.stringify({ count: motionStart.protrudingTreePixels, sky: motionStart.skyAlpha, canvasSize: motionStart.canvasSize, renderCount: motionStart.renderCount }));
  await page.evaluate(() => { window.__CAMP__.state.clock = 3000; });
  await page.waitForTimeout(80);
  const motionTrees = await motionFrame();
  assert.notDeepEqual(motionTrees.trees, motionStart.trees, "Pine tips did not sway");
  assert.deepEqual(motionTrees.ground, motionStart.ground, "Ground moved with the trees");
  await page.evaluate(() => { window.__CAMP__.state.clock = 12000; });
  await page.waitForTimeout(80);
  const motionEnd = await motionFrame();
  const changedEdgePixels = motionStart.alpha.filter((alpha, index) => alpha !== motionEnd.alpha[index]).length;
  assert.ok(changedEdgePixels > 100, "Upper sky alpha contour did not move");
  assert.deepEqual(motionEnd.ground, motionStart.ground);
  await page.waitForTimeout(120);
  assert.deepEqual((await motionFrame()).alpha, motionEnd.alpha, "Paused contour kept moving");
  await page.evaluate(() => { window.__CAMP__.state.clock = 20000; });
  await page.waitForTimeout(80);
  const rollingFrame = await motionFrame();
  for (const frame of [motionStart, motionEnd, rollingFrame])
    assert.deepEqual(frame.skyTops, frame.expectedSkyTops, "Original PNG edge blocked the moving silhouette");
  const contours = await page.evaluate(() => {
    const app = window.__CAMP__, a = app.edgeProfile(0), b = app.edgeProfile(1000), c = app.edgeProfile(12000), d = app.edgeProfile(20000);
    const first = app.mask(0), last = app.mask(12000);
    const highPass = profile => profile.map((point, index) => {
      const neighbors = profile.slice(Math.max(0, index - 16), Math.min(profile.length, index + 17));
      return point.y - neighbors.reduce((sum, point) => sum + point.y, 0) / neighbors.length;
    });
    const start = highPass(a), end = highPass(d);
    let bestShift = 0, bestCorrelation = -Infinity;
    for (let shift = -15; shift <= 20; shift++) {
      let xy = 0, xx = 0, yy = 0;
      for (let index = 60; index < 185; index++) {
        const x = start[index], y = end[index + shift];
        xy += x * y; xx += x * x; yy += y * y;
      }
      const correlation = xy / Math.sqrt(xx * yy);
      if (correlation > bestCorrelation) { bestCorrelation = correlation; bestShift = shift * 2; }
    }
    return {
      maxOneSecondChange: Math.max(...a.map((point, index) => Math.abs(point.y - b[index].y))),
      maxTwelveSecondChange: Math.max(...a.map((point, index) => Math.abs(point.y - c[index].y))),
      changedMaskRows: first.filter((row, index) => JSON.stringify(row) !== JSON.stringify(last[index])).length,
      visibleBottom: app.visibleBottom(),
      groundBaseline: app.groundBaseline(),
      rightwardShiftInTwentySeconds: bestShift,
      rollingCorrelation: bestCorrelation,
    };
  });
  assert.ok(contours.maxOneSecondChange <= 2, "Contour motion is too abrupt");
  assert.ok(contours.maxTwelveSecondChange >= 4 && contours.maxTwelveSecondChange <= 14);
  assert.ok(contours.changedMaskRows > 10, "Input mask did not follow the moving contour");
  assert.equal(contours.visibleBottom, 230);
  assert.ok(contours.rightwardShiftInTwentySeconds >= 14 && contours.rightwardShiftInTwentySeconds <= 22, "Sky lobes did not roll to the right");
  assert.ok(contours.rollingCorrelation > 0.95, "Rolling lobes lost their shape");
  await command("pause");
  const weather = await page.evaluate(() => {
    const app = window.__CAMP__,
      luma = (p) => (p[0] + p[1] + p[2]) / 3;
    let maxMoonOcclusion = 0,
      cloudTime = 0,
      maxStarOcclusion = 0;
    for (let time = 0; time <= 180000; time += 2000) {
      const body = app.dayNight(time).body;
      const x = Math.round(body.x) - 7, y = Math.round(body.y);
      const clear = luma(app.skySample(time, x, y, false, false));
      const covered = luma(app.skySample(time, x, y, true, false));
      if (clear - covered > maxMoonOcclusion) {
        maxMoonOcclusion = clear - covered;
        cloudTime = time;
      }
      maxStarOcclusion = Math.max(
        maxStarOcclusion,
        luma(app.skySample(time, 196, 57, false, true)) -
          luma(app.skySample(time, 196, 57, true, true)),
      );
    }
    const starBrightness = [0, 900, 1800, 2700].map((time) =>
      luma(app.skySample(time, 196, 57, false, true)),
    );
    const before = app.cloudPositions(0)[0].x,
      after = app.cloudPositions(10000)[0].x;
    return {
      maxMoonOcclusion,
      cloudTime,
      maxStarOcclusion,
      starRange: Math.max(...starBrightness) - Math.min(...starBrightness),
      cloudDelta: after - before,
    };
  });
  assert.ok(
    weather.maxMoonOcclusion > 30,
    "Cloud did not occlude moon",
  );
  assert.ok(weather.maxStarOcclusion > 30, "Cloud did not occlude stars");
  assert.ok(weather.starRange > 60, "Star brightness did not twinkle");
  assert.equal(weather.cloudDelta, -20);
  const dayNight = await page.evaluate(() => {
    const app = window.__CAMP__, luma = pixel => (pixel[0] + pixel[1] + pixel[2]) / 3;
    const moon = [0, 120000, 320000].map(time => app.dayNight(time).body);
    const sun = [480000, 720000, 960000].map(time => app.dayNight(time).body);
    const night = app.dayNight(0), day = app.dayNight(720000);
    const cloudLuma = time => {
      const cloud = app.cloudPositions(time)[0];
      return luma(app.skySample(time, cloud.x + cloud.width / 2, cloud.y + cloud.height / 2, true, false));
    };
    let maxSunOcclusion = 0;
    for (let time = 500000; time <= 940000; time += 8000) {
      const body = app.dayNight(time).body;
      const clear = app.skySample(time, body.x, body.y, false, false);
      const covered = app.skySample(time, body.x, body.y, true, false);
      maxSunOcclusion = Math.max(maxSunOcclusion, ...clear.slice(0, 3).map((value, channel) => Math.abs(value - covered[channel])));
    }
    const transitions = [420000, 1020000, 1200000].map(time => ({
      time,
      lightDelta: Math.abs(app.dayNight(time - 1).daylight - app.dayNight(time + 1).daylight),
      skyDelta: Math.max(...app.skySample(time - 1, 300, 92, false, false).map((value, index) =>
        Math.abs(value - app.skySample(time + 1, 300, 92, false, false)[index]))),
    }));
    const noon = app.dayNight(720000).body;
    let topClearance = Infinity;
    for (let time = 0; time <= 1200000; time += 1000) {
      const body = app.dayNight(time).body;
      if (body.progress <= 0.25 || body.progress >= 0.75) continue;
      const top = Math.max(...app.edgeProfile(time).filter(point => Math.abs(point.x - body.x) <= 12).map(point => point.y));
      topClearance = Math.min(topClearance, body.y - 12 - top);
    }
    return {
      durationMs: night.durationMs, moon, sun,
      nextBody: app.dayNight(420000).body.kind,
      loopBody: app.dayNight(1020000).body.kind,
      loopMatches: JSON.stringify(app.dayNight(0).body) === JSON.stringify(app.dayNight(1200000).body) && app.dayNight(0).daylight === app.dayNight(1200000).daylight,
      dayStars: day.stars, nightStars: night.stars,
      dayTentLight: day.tentLight, nightTentLight: night.tentLight,
      starsInvisibleInDay: JSON.stringify(app.skySample(720000, 196, 57, false, true)) === JSON.stringify(app.skySample(720000, 196, 57, false, false)),
      dayCloudLuma: cloudLuma(720000), nightCloudLuma: cloudLuma(0),
      fogColorChanged: JSON.stringify(day.fogColor) !== JSON.stringify(night.fogColor),
      dayFogDensity: day.fogDensity, nightFogDensity: night.fogDensity,
      sunClearsTop: noon.y - 12 > app.edgeProfile(720000)[Math.round(noon.x / 2)].y,
      maxSunOcclusion, transitions, topClearance,
    };
  });
  for (const arc of [dayNight.moon, dayNight.sun]) {
    assert.ok(arc[0].x < arc[1].x && arc[1].x < arc[2].x, "Celestial body did not travel left to right");
    assert.ok(arc[1].y < arc[0].y && arc[1].y < arc[2].y, "Celestial trajectory did not rise then set");
  }
  assert.equal(dayNight.nextBody, "sun");
  assert.equal(dayNight.durationMs, 1200000);
  assert.equal(dayNight.loopBody, "moon");
  assert.ok(dayNight.loopMatches && dayNight.sunClearsTop);
  assert.ok(dayNight.topClearance > 4, "The upper silhouette clipped a celestial body");
  assert.equal(dayNight.dayStars, 0);
  assert.equal(dayNight.nightStars, 1);
  assert.equal(dayNight.dayTentLight, 0);
  assert.equal(dayNight.nightTentLight, 1);
  assert.ok(dayNight.starsInvisibleInDay && dayNight.fogColorChanged);
  assert.ok(dayNight.dayCloudLuma - dayNight.nightCloudLuma > 40, "Clouds kept their night palette in daylight");
  assert.ok(dayNight.dayFogDensity < dayNight.nightFogDensity);
  assert.ok(dayNight.maxSunOcclusion > 20, "Clouds did not occlude the sun");
  assert.ok(dayNight.transitions.every(transition => transition.lightDelta < 0.001 && transition.skyDelta <= 2), "Day/night transition jumped");
  await command("pause");
  const phaseFrames = {};
  fs.mkdirSync(path.join(root, "output/desktop-build"), { recursive: true });
  for (const [phase, time] of [["night", 0], ["dawn", 420000], ["day", 840000], ["dusk", 1020000]]) {
    await page.evaluate(time => { window.__CAMP__.state.clock = time; }, time);
    await page.waitForTimeout(100);
    phaseFrames[phase] = await page.locator("#camp").evaluate(canvas => {
      const ctx = canvas.getContext("2d");
      return { tent: [...ctx.getImageData(132, 190, 1, 1).data], valley: [...ctx.getImageData(350, 135, 1, 1).data], corner: ctx.getImageData(0, 0, 1, 1).data[3], belowGround: ctx.getImageData(250, 231, 1, 1).data[3] };
    });
    await page.locator("#camp").screenshot({ path: path.join(root, `output/desktop-build/day-night-${phase}.png`), omitBackground: true });
  }
  assert.ok(phaseFrames.night.tent[0] > phaseFrames.night.tent[2]);
  assert.ok(phaseFrames.day.tent[0] < phaseFrames.night.tent[0] - 30, "Tent lamp stayed on during daylight");
  assert.notDeepEqual(phaseFrames.day.valley, phaseFrames.night.valley, "Valley and mist did not change with daylight");
  assert.ok(Object.values(phaseFrames).every(frame => frame.corner === 0 && frame.belowGround === 0));
  const pausedCycle = await page.evaluate(() => window.__CAMP__.dayNight());
  await page.waitForTimeout(250);
  assert.deepEqual(await page.evaluate(() => window.__CAMP__.dayNight()), pausedCycle, "Paused day/night cycle kept advancing");
  const tentIds = ["main", "rear", "right"];
  const probe = { main: [132, 190], rear: [56, 205], right: [440, 200] };
  const atGameHour = (hour, day = 1) => (day + hour / 24 - 0.9) * 1200000;
  const manifest = await page.evaluate(async () => (await fetch("./scene.json")).json());
  const rightTentLayer = manifest.layers.find(layer => layer.tentId === "right");
  const woodpileLayer = manifest.layers.find(layer => layer.id === "woodpile");
  const backpackLayer = manifest.layers.find(layer => layer.id === "right-backpack");
  assert.ok(woodpileLayer && backpackLayer);
  assert.ok(woodpileLayer.drawRect[0] > 328 && woodpileLayer.drawRect[0] + woodpileLayer.drawRect[2] <= rightTentLayer.drawRect[0] + 2);
  assert.ok(backpackLayer.drawRect[0] > rightTentLayer.drawRect[0] + rightTentLayer.drawRect[2] / 2);
  assert.ok(backpackLayer.drawRect[0] + backpackLayer.drawRect[2] < 495);
  assert.ok([woodpileLayer, backpackLayer].every(layer => Math.abs(layer.drawRect[1] + layer.drawRect[3] - 222.76) < 0.001));
  assert.ok(!manifest.hitRegions.some(region => region.id === "woodpile"));
  const tentLayers = manifest.layers.filter(layer => layer.tentId);
  assert.deepEqual(tentLayers.map(layer => layer.tentId).sort(), [...tentIds].sort());
  assert.ok(tentLayers.every(layer => Math.abs(layer.drawRect[1] + layer.drawRect[3] - 222.76) < 0.001));
  const sampleTents = () => page.evaluate(probe => {
    const app = window.__CAMP__, ctx = document.querySelector("#camp").getContext("2d");
    return { tents: app.dayNight().tents, pixels: Object.fromEntries(Object.entries(probe).map(([id, [x, y]]) => [id, [...ctx.getImageData(x, y, 1, 1).data]])) };
  }, probe);
  const tentRoutine = [];
  for (const [name, hour, expected] of [
    ["closed-lit", 22.99, "closedLit"], ["late-night", 23.99, "closedUnlit"],
    ["early-morning", 6.5, "closedUnlit"], ["morning", 8, "openUnlit"],
    ["day", 12, "openUnlit"], ["evening", 19, "openLit"],
  ]) {
    await page.evaluate(time => { window.__CAMP__.state.clock = time; }, atGameHour(hour));
    await page.waitForTimeout(100);
    const frame = await sampleTents();
    for (const id of tentIds) assert.ok(Math.abs(frame.tents[id].weights[expected] - 1) < 1e-8, id + " has the wrong daily state");
    tentRoutine.push({ name, hour, expected, ...frame });
    await page.locator("#camp").screenshot({ path: path.join(root, `output/desktop-build/tent-${name}.png`), omitBackground: true });
  }
  for (const id of tentIds) {
    assert.ok(tentRoutine[0].pixels[id][0] > tentRoutine[1].pixels[id][0] + 20, id + " lamp did not switch off");
    assert.ok(tentRoutine[5].pixels[id][0] > tentRoutine[4].pixels[id][0] + 25, id + " open doorway did not light up");
    assert.ok(tentRoutine[4].pixels[id][0] > tentRoutine[4].pixels[id][2], id + " door did not stay open during daytime");
  }
  assert.ok(tentRoutine[5].pixels.rear[0] < tentRoutine[5].pixels.main[0], "Rear tent lost its darker appearance");
  const today = await page.evaluate(time => window.__CAMP__.dayNight(time).tents, atGameHour(12));
  const staggeredTents = [];
  const tentTransition = [];
  for (const [event, before, after] of [["open", "closedUnlit", "openUnlit"], ["close", "openLit", "closedLit"], ["off", "closedLit", "closedUnlit"]]) {
    const order = [...tentIds].sort((a, b) => today[a].times[event] - today[b].times[event]);
    for (let rank = 0; rank < order.length; rank++) {
      const hour = today[order[rank]].times[event] + 0.26;
      await page.evaluate(time => { window.__CAMP__.state.clock = time; }, atGameHour(hour));
      await page.waitForTimeout(80);
      const sample = await sampleTents();
      for (let i = 0; i < order.length; i++) assert.ok(Math.abs(sample.tents[order[i]].weights[i <= rank ? after : before] - 1) < 1e-8);
      staggeredTents.push({ event, rank, hour, order, ...sample });
      await page.locator("#camp").screenshot({ path: path.join(root, `output/desktop-build/tents-${event}-${rank}.png`), omitBackground: true });
    }
  }
  for (const id of tentIds) for (const event of ["open", "light", "close", "off"]) {
    const transition = await page.evaluate(({ id, time }) => {
      const app = window.__CAMP__, start = app.dayNight(time).tents[id].weights;
      const middle = app.dayNight(time + 6250).tents[id].weights;
      return { id, middle, delta: Math.max(...Object.keys(start).map(key => Math.abs(start[key] - app.dayNight(time - 1).tents[id].weights[key]))) };
    }, { id, time: atGameHour(today[id].times[event]) });
    tentTransition.push({ event, ...transition });
  }
  assert.ok(tentTransition.every(transition => transition.delta < 0.001 && Object.values(transition.middle).filter(weight => Math.abs(weight - 0.5) < 0.001).length === 2), "Tent transition jumped");
  const randomDays = await page.evaluate(() => {
    const app = window.__CAMP__;
    return Array.from({ length: 12 }, (_, day) => {
      const sample = app.dayNight((day + 0.5 - 0.9) * 1200000);
      return { day: sample.gameDay, times: Object.fromEntries(Object.entries(sample.tents).map(([id, tent]) => [id, tent.times])) };
    });
  });
  for (const day of randomDays) for (const id of tentIds) {
    const times = day.times[id];
    for (const [event, start, end] of [["open", 7, 8], ["light", 18, 19], ["close", 21, 23], ["off", 23, 24]]) {
      assert.ok(times[event] >= start && times[event] + 0.25 <= end, "Random routine escaped its time window");
    }
  }
  for (const event of ["open", "close", "off"]) {
    const orders = randomDays.map(day => [...tentIds].sort((a, b) => day.times[a][event] - day.times[b][event]).join(","));
    assert.ok(new Set(orders).size > 1, "Tent order did not vary between days");
  }
  const repeated = await page.evaluate(time => window.__CAMP__.dayNight(time).tents, atGameHour(12));
  for (const id of tentIds) assert.deepEqual(repeated[id].times, today[id].times, "Routine changed during the same game day");
  const interactionsBeforeTents = await page.evaluate(() => window.__CAMP__.state.interactions);
  for (const [x, y] of Object.values(probe)) {
    await page.mouse.move(x, y);
    assert.equal(await page.evaluate(() => window.__CAMP__.state.hovered), null);
    await page.mouse.click(x, y);
  }
  assert.equal(await page.evaluate(() => window.__CAMP__.state.interactions), interactionsBeforeTents);
  const fireRoutine = [];
  const firePixels = () => page.locator("#camp").evaluate(canvas => {
    const ctx = canvas.getContext("2d"), pixels = ctx.getImageData(259, 117, 65, 62).data;
    let warmPixels = 0, top = 179;
    for (let y = 0; y < 62; y++) for (let x = 0; x < 65; x++) {
      const index = (y * 65 + x) * 4;
      if (pixels[index] > 150 && pixels[index] > pixels[index + 1] * 1.2 && pixels[index] > pixels[index + 2] * 1.5) {
        warmPixels++;
        top = Math.min(top, y + 117);
      }
    }
    return { warmPixels, top, smokePixels: [...ctx.getImageData(280, 140, 36, 39).data] };
  });
  for (const [name, hour, expected] of [["night", 21, "burning"], ["late-night", 3, "low"], ["morning", 6.5, "smoking"], ["day", 12, "out"], ["evening", 19, "burning"]]) {
    await page.evaluate(hour => {
      const state = window.__CAMP__.state;
      state.clock = (((hour - 18 + 24) % 24) / 24 * 1200000 - 180000 + 1200000) % 1200000;
      state.firePhase = 0;
      state.fireUntil = 0;
      state.steam = false;
      state.hovered = null;
    }, hour);
    await page.waitForTimeout(100);
    const first = await firePixels();
    const fire = await page.evaluate(() => window.__CAMP__.dayNight().fire);
    assert.equal(fire.stage, expected);
    assert.ok(first.warmPixels > 0 || fire.flame === 0, "A burning stage rendered no flame");
    await page.locator("#camp").screenshot({ path: path.join(root, `output/desktop-build/fire-${name}.png`), omitBackground: true });
    let smokeMotion = 0;
    if (name === "morning" || name === "day") {
      await page.evaluate(() => { window.__CAMP__.state.clock += 900; });
      await page.waitForTimeout(100);
      const second = await firePixels();
      for (let i = 0; i < first.smokePixels.length; i += 4)
        if (Math.max(...[0, 1, 2].map(channel => Math.abs(first.smokePixels[i + channel] - second.smokePixels[i + channel]))) > 12) smokeMotion++;
      assert.equal(second.warmPixels, 0, "Extinguished campfire still showed flames");
      await page.mouse.click(440, 200);
      assert.equal(await page.evaluate(() => window.__CAMP__.state.fireUntil), 0, "Right tent click relit an extinguished campfire");
      await page.mouse.click(290, 160);
      assert.equal(await page.evaluate(() => window.__CAMP__.state.fireUntil), 0, "Clicking the empty fire pit relit it");
      await page.mouse.move(340, 170);
    }
    fireRoutine.push({ name, hour, ...fire, warmPixels: first.warmPixels, top: first.top, smokeMotion });
  }
  assert.ok(fireRoutine[0].warmPixels > fireRoutine[1].warmPixels * 2, "Late-night fire did not shrink");
  assert.ok(fireRoutine[1].top > fireRoutine[0].top + 15, "Low fire did not stay near the wood");
  assert.equal(fireRoutine[2].warmPixels, 0);
  assert.ok(fireRoutine[2].smokeMotion > 8, "Morning smoke did not rise");
  assert.equal(fireRoutine[3].warmPixels, 0);
  assert.equal(fireRoutine[3].smokeMotion, 0, "Smoke continued during daytime");
  const fireContinuity = await page.evaluate(() => {
    const app = window.__CAMP__;
    const atHour = hour => (((hour - 18 + 24) % 24) / 24 * 1200000 - 180000 + 1200000) % 1200000;
    return [0, 2, 5.5, 6, 7, 8, 18, 18.25].map(hour => {
      const a = app.dayNight(atHour(hour) - 1).fire, b = app.dayNight(atHour(hour) + 1).fire;
      return { hour, delta: Math.max(Math.abs(a.flame - b.flame), Math.abs(a.smoke - b.smoke)) };
    });
  });
  assert.ok(fireContinuity.every(transition => transition.delta < 0.001), "Campfire transition jumped");
  await page.evaluate(time => { window.__CAMP__.state.clock = time; }, atGameHour(19, 7));
  const cycleOptions = [];
  for (const minutes of [20, 30, 45, 60, 90, 120]) {
    const before = await page.evaluate(() => window.__CAMP__.dayNight());
    await command(`cycle-${minutes}`);
    const after = await page.evaluate(() => window.__CAMP__.dayNight());
    assert.ok(Math.abs(before.phase - after.phase) < 1e-10, "Changing cycle speed jumped the game hour");
    assert.ok(Math.abs(before.body.x - after.body.x) < 1e-6);
    assert.equal(before.tent.visual, after.tent.visual);
    assert.equal(before.gameDay, after.gameDay, "Cycle speed changed the simulated day");
    for (const id of ["main", "rear", "right"]) {
      assert.deepEqual(before.tents[id].times, after.tents[id].times, "Cycle speed reshuffled tent routines");
      assert.ok(Math.abs(before.tents[id].light - after.tents[id].light) < 1e-8);
    }
    assert.equal(before.tents.rear.visual, after.tents.rear.visual);
    assert.ok(Math.abs(before.tents.rear.light - after.tents.rear.light) < 1e-8);
    assert.ok(Math.abs(before.fire.flame - after.fire.flame) < 1e-8 && Math.abs(before.fire.smoke - after.fire.smoke) < 1e-8, "Cycle speed changed the fire stage");
    assert.equal(after.durationMs, minutes * 60000);
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("camp-settings")).cycleMinutes), minutes);
    await page.evaluate(() => { window.__CAMP__.state.clock += 60000; });
    const advanced = await page.evaluate(() => window.__CAMP__.dayNight());
    assert.ok(Math.abs((advanced.phase - after.phase + 1) % 1 - 1 / minutes) < 1e-10, "Real minute did not match the selected cycle speed");
    cycleOptions.push({ minutesPerDay: minutes, hourPreserved: true, saved: true });
  }
  const savedTentSeed = await page.evaluate(() => window.__CAMP__.state.tentSeed);
  await page.reload();
  await page.waitForFunction(() => window.__CAMP__?.ready);
  assert.equal(await page.evaluate(() => window.__CAMP__.state.cycleMinutes), 120);
  assert.equal(await page.evaluate(() => window.__CAMP__.state.tentSeed), savedTentSeed);
  const cycleSample = () => page.evaluate(() => ({
    light: window.__CAMP__.dayNight(), clock: window.__CAMP__.state.clock,
  }));
  await page.evaluate(time => { window.__CAMP__.state.clock = time; }, atGameHour(12) * 6);
  await page.mouse.click(290, 207);
  await page.mouse.dblclick(240, 210);
  await command("pause-time");
  await page.mouse.dblclick(290, 207);
  await command("pause-time");
  await page.waitForTimeout(200);
  const beforeNightfall = (await cycleSample()).light;
  assert.ok(beforeNightfall.gameHour < 12.05, "A single click, kettle click, or paused click started nightfall");

  await page.mouse.dblclick(290, 207);
  await page.waitForFunction(() => window.__CAMP__.dayNight().gameHour > 14);
  await command("pause-time");
  const midNightfall = (await cycleSample()).light;
  assert.ok(midNightfall.gameHour < 22.5, "Double-click skipped the transition");
  await page.waitForTimeout(150);
  assert.deepEqual((await cycleSample()).light, midNightfall, "Nightfall ignored time pause");
  await command("pause-time");
  await page.waitForFunction(() => window.__CAMP__.dayNight().gameHour >= 22.5, null, { timeout: 4500 });
  const atNight = await cycleSample();
  assert.equal(atNight.light.gameDay, beforeNightfall.gameDay);
  assert.ok(atNight.light.gameHour < 22.55);
  assert.equal(atNight.light.body.kind, "moon");
  assert.equal(atNight.light.weights.night, 1);
  assert.equal(atNight.light.fire.flame, 1);
  assert.ok(Object.values(atNight.light.tents).every(tent => tent.light === 1));
  await page.mouse.click(290, 207);
  await page.waitForTimeout(150);
  const afterNightfall = await cycleSample();
  assert.equal(afterNightfall.light.durationMs, 120 * 60_000);
  assert.ok(Math.abs(afterNightfall.light.phase - atNight.light.phase - (afterNightfall.clock - atNight.clock) / atNight.light.durationMs) < 1e-10, "Normal cycle speed did not resume after nightfall");

  // Double-clicking at 21:30 should still go to daytime after moving the night target later.
  await page.evaluate(() => { window.__CAMP__.state.cycleOffset -= 1 / 24; });
  const beforeDaybreak = await cycleSample();
  await page.mouse.dblclick(290, 207);
  const transitionMs = 1800;
  const sampleDuringDaybreak = async progress => {
    await page.waitForFunction(clock => window.__CAMP__.state.clock >= clock, beforeDaybreak.clock + transitionMs * progress, { timeout: 4500 });
    return cycleSample();
  };
  const afterStart = await sampleDuringDaybreak(0.15);
  const midStart = await sampleDuringDaybreak(0.4);
  const nextDay = atNight.light.gameDay + 1;
  await page.waitForFunction(day => {
    const light = window.__CAMP__.dayNight();
    return light.gameDay === day && light.body.kind === "sun" && light.daylight < 1;
  }, nextDay, { timeout: 4500 });
  const midEnd = await sampleDuringDaybreak(0.6);
  const beforeFinish = await sampleDuringDaybreak(0.85);
  await page.waitForFunction(day => {
    const light = window.__CAMP__.dayNight();
    return light.gameDay === day && light.gameHour >= 11;
  }, nextDay, { timeout: 4500 });
  const atDay = await cycleSample();
  assert.ok(atDay.clock - beforeDaybreak.clock <= transitionMs + 100, "Fast-forward exceeded 1.8 seconds plus frame and sampling time");
  const gameTime = ({ light }) => light.gameDay * 24 + light.gameHour;
  const rate = (start, end) => (gameTime(end) - gameTime(start)) / (end.clock - start.clock);
  const middleRate = rate(midStart, midEnd);
  assert.ok(middleRate > 5 * rate(beforeDaybreak, afterStart), "Fast-forward did not start slowly");
  assert.ok(middleRate > 5 * rate(beforeFinish, atDay), "Fast-forward did not slow before arrival");
  assert.ok(atDay.light.gameHour < 11.05);
  assert.equal(atDay.light.weights.day, 1);
  assert.equal(atDay.light.fire.stage, "out");
  assert.ok(Object.values(atDay.light.tents).every(tent => tent.weights.openUnlit === 1));
  await page.waitForTimeout(150);
  const afterDaybreak = await cycleSample();
  assert.equal(afterDaybreak.light.durationMs, 120 * 60_000);
  assert.ok(Math.abs(afterDaybreak.light.phase - atDay.light.phase - (afterDaybreak.clock - atDay.clock) / atDay.light.durationMs) < 1e-10, "Normal cycle speed did not resume after daybreak");

  await command("cycle-20");
  await page.evaluate(() => Object.assign(window.__CAMP__.state, { clock: 0, cycleOffset: 0 }));
  await page.waitForTimeout(80);
  await command("pause");
  assert.deepEqual(errors, []);
  assert.deepEqual(await page.evaluate(() => window.__CAMP__.errors), []);
  fs.mkdirSync(path.join(root, "output/desktop-build"), { recursive: true });
  await page.mouse.move(340, 170);
  await page.screenshot({
    path: path.join(root, "output/desktop-build/desktop-ui.png"),
    omitBackground: true,
  });
  const zoomMigrations = [];
  for (const [savedZoom, expectedZoom] of [[0.5, 0.7], [0.75, 0.8], [1.25, 1.3], [2, 1.5]]) {
    const migrationPage = await browser.newPage({ viewport: { width: 500, height: 300 } });
    await migrationPage.addInitScript(zoom => {
      localStorage.setItem("camp-settings", JSON.stringify({ zoom }));
    }, savedZoom);
    await migrationPage.goto(url);
    await migrationPage.waitForFunction(() => window.__CAMP__?.ready);
    assert.equal(await migrationPage.evaluate(() => window.__CAMP__.state.zoom), expectedZoom);
    assert.equal(await migrationPage.evaluate(() => JSON.parse(localStorage.getItem("camp-settings")).zoom), expectedZoom);
    zoomMigrations.push({ previous: savedZoom, current: expectedZoom });
    await migrationPage.close();
  }
  const result = {
    passed: true,
    logicalSize: [500, 300],
    transparentCorners: true,
    fireAnimation: true,
    nightLitMainTent: true,
    tentInteractionRemoved: true,
    kettleInteraction: true,
    campfireInteraction: true,
    campfireNightfall: true,
    campfireDaybreak: true,
    rightTentProps: true,
    pinStateToggle: true,
    trayCommandHandlers: true,
    pause: true,
    dragRouting: true,
    hitMask: true,
    zoomAndScaledInteraction: true,
    zoomRangePercent: [70, 150],
    zoomStepPercent: 10,
    zoomMigrations,
    noHoverControls: true,
    twinklingStars: true,
    movingClouds: true,
    celestialOcclusion: weather,
    dayNight: { ...dayNight, phaseFrames, pauseFreezesCycle: true },
    tentRoutine: { stages: tentRoutine, transitions: tentTransition },
    staggeredTents: { stages: staggeredTents, randomDays, noTentInteraction: true },
    fireRoutine: { stages: fireRoutine, transitions: fireContinuity },
    cycleOptions,
    dynamicUpperContour: { changedEdgePixels, ...contours },
    foregroundPinesOutsideClip: true,
    gentleTreeSway: true,
    stationaryGround: true,
    browserErrors: [],
  };
  fs.writeFileSync(
    path.join(root, "output/desktop-build/ui-validation.json"),
    JSON.stringify(result, null, 2) + "\n",
  );
  console.log(JSON.stringify({
    passed: result.passed,
    report: "output/desktop-build/ui-validation.json",
    tents: tentIds,
    rightTentProps: true,
    dailyRandomSchedulesChecked: randomDays.length,
    cycleOptions: cycleOptions.map(option => option.minutesPerDay),
    browserErrors: errors,
  }, null, 2));
} finally {
  await browser.close();
}

