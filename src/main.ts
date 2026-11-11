import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { PhysicalPosition } from "@tauri-apps/api/dpi";
import { CampRenderer, loadScene, type CampState } from "./scene";
import { CampAudio } from "./audio";
import { dayNightAt, CYCLE_MINUTES, DEFAULT_CYCLE_MINUTES } from "./day-night";
import "./style.css";

const DAYTIME_TARGET_HOUR = 11;
const NIGHTTIME_TARGET_HOUR = 22.5;
const NIGHT_START_HOUR = 20.5;
const DAY_NIGHT_TRANSITION_MS = 1800;
const native = isTauri();
const app = document.querySelector<HTMLDivElement>("#app")!;
app.innerHTML = `<canvas id="camp" tabindex="0" aria-label="月下营地；拖动背景移动窗口，点击物件互动，双击篝火切换昼夜；右键系统托盘图标调整设置"></canvas>`;
if (!native) {
  app.insertAdjacentHTML("beforeend", `<div class="toast" role="status" aria-live="polite"></div><div class="loading">正在点燃营火…</div>`);
}
const canvas = document.querySelector<HTMLCanvasElement>("#camp")!,
  toast = document.querySelector<HTMLElement>(".toast"),
  loading = document.querySelector<HTMLElement>(".loading");
const desktop = native ? getCurrentWindow() : null,
  audio = new CampAudio();
const saved = (() => {
  try { return JSON.parse(localStorage.getItem("camp-settings") ?? "{}") ?? {}; }
  catch { return {}; }
})();
interface WindowPlacement {
  monitor: string;
  x: number;
  y: number;
  docked: boolean;
}
const savedPlacement = saved.windowPlacement;
let windowPlacement: WindowPlacement | null = typeof savedPlacement?.monitor === "string"
  && Number.isFinite(savedPlacement.x) && Number.isFinite(savedPlacement.y)
  && typeof savedPlacement.docked === "boolean" ? savedPlacement : null;
const state: CampState = {
  pinned: saved.pinned !== false,
  muted: true,
  paused: false,
  timePausedAt: null,
  steam: saved.steam !== false,
  hovered: null,
  fireUntil: 0,
  steamUntil: 0,
  frameDuration: typeof saved.frameDuration === "number"
    ? Math.min(180, Math.max(70, saved.frameDuration)) : 100,
  clock: 0,
  firePhase: 0,
  frameIndex: 0,
  interactions: 0,
  cycleMinutes: CYCLE_MINUTES.some(minutes => minutes === saved.cycleMinutes) ? saved.cycleMinutes : DEFAULT_CYCLE_MINUTES,
  cycleOffset: 0,
  tentSeed: Number.isInteger(saved.tentSeed) && saved.tentSeed >= 0 && saved.tentSeed <= 0xffffffff
    ? saved.tentSeed : crypto.getRandomValues(new Uint32Array(1))[0],
  zoom: typeof saved.zoom === "number" && Number.isFinite(saved.zoom)
    ? Math.min(150, Math.max(70, Math.round(saved.zoom * 10) * 10)) / 100 : 1,
};
let passthrough = saved.passthrough !== false;
let renderer: CampRenderer,
  ready = false,
  renderCount = 0,
  dragRequests = 0,
  lastFrame = -Infinity,
  lastTime = 0,
  toastTimer: ReturnType<typeof setTimeout>;
let dayNightTransition: { remainingPhase: number; remainingMs: number } | null = null;
let fullscreenPausedAt: number | null = null;
let dragCompletion = Promise.resolve();
let trayNoticeQueue = Promise.resolve();
const debug = {
  state,
  ready: false,
  errors: [] as string[],
  get renderCount() { return renderCount; },
  get dragRequests() { return dragRequests; },
  get passthrough() { return passthrough; },
  get fullscreenPaused() { return fullscreenPausedAt !== null; },
  command: dispatchCommand,
  desktopStatus: () => native ? invoke("desktop_status") : Promise.resolve(null),
  mask: (time = state.clock) => renderer.mask(time),
  edgeProfile: (time: number) => renderer.edgeProfile(time),
  treeOffsets: (time: number) => renderer.treeOffsets(time),
  visibleBottom: () => renderer.visibleBottom(),
  groundBaseline: () => renderer.groundBaseline(),
  skySample: (time: number, x: number, y: number, clouds = true, stars = true) =>
    renderer.sampleSky(time, x, y, clouds, stars),
  cloudPositions: (time: number) => renderer.cloudPositions(time),
  dayNight: currentDayNight,
};
Object.assign(window, { __CAMP__: debug });
function currentDayNight(time = state.timePausedAt ?? state.clock) {
  return dayNightAt(time, state.cycleMinutes, state.cycleOffset, state.tentSeed);
}
function setFullscreenPaused(paused: boolean) {
  const pausedAt = fullscreenPausedAt;
  if (paused === (pausedAt !== null)) return;
  const now = performance.now();
  if (pausedAt !== null) {
    const elapsed = now - pausedAt;
    if (state.fireUntil > pausedAt) state.fireUntil += elapsed;
    if (state.steamUntil > pausedAt) state.steamUntil += elapsed;
  }
  fullscreenPausedAt = paused ? now : null;
  lastTime = 0;
  void audio.setSuspended(paused).catch(fail);
}
function startDayNightTransition() {
  if (dayNightTransition) return;
  const { gameHour } = currentDayNight();
  const toDaytime = gameHour < 6 || gameHour >= NIGHT_START_HOUR;
  const targetHour = toDaytime ? DAYTIME_TARGET_HOUR : NIGHTTIME_TARGET_HOUR;
  const transitionLabel = toDaytime ? "天亮" : "入夜";
  if (fullscreenPausedAt !== null) {
    message(`退出全屏后可加速${transitionLabel}`);
    return;
  }
  if (state.paused || state.timePausedAt !== null) {
    message(`继续${state.paused ? "动画" : "时间"}后可加速${transitionLabel}`);
    return;
  }
  const hoursAhead = (targetHour - gameHour + 24) % 24;
  dayNightTransition = {
    remainingPhase: hoursAhead / 24,
    remainingMs: DAY_NIGHT_TRANSITION_MS,
  };
  message(`正在加速${transitionLabel}…`);
}
function remainingEasedProgress(remainingMs: number) {
  const t = remainingMs / DAY_NIGHT_TRANSITION_MS;
  // Quintic easing brings the extra speed smoothly to zero at both ends.
  return t * t * t * (10 + t * (6 * t - 15));
}
function advanceDayNightTransition(delta: number) {
  if (!dayNightTransition || state.timePausedAt !== null) return;
  const { remainingPhase, remainingMs } = dayNightTransition;
  const cycleDurationMs = state.cycleMinutes * 60_000;
  const extraPhase = remainingPhase - remainingMs / cycleDurationMs;
  if (extraPhase <= 0) {
    dayNightTransition = null;
    return;
  }
  const elapsed = Math.min(delta, remainingMs);
  const nextRemainingMs = remainingMs - elapsed;
  // Distribute only the extra advance over the remaining curve, even if the cycle speed changes.
  const remainingProgress = remainingEasedProgress(remainingMs);
  const nextProgress = remainingEasedProgress(nextRemainingMs);
  const extraAdvance = extraPhase * (1 - nextProgress / remainingProgress);
  state.cycleOffset += extraAdvance;
  dayNightTransition.remainingPhase -= elapsed / cycleDurationMs + extraAdvance;
  dayNightTransition.remainingMs = nextRemainingMs;
  if (nextRemainingMs === 0) dayNightTransition = null;
}
function save() {
  localStorage.setItem("camp-settings", JSON.stringify({
    pinned: state.pinned, steam: state.steam,
    frameDuration: state.frameDuration, passthrough, zoom: state.zoom,
    windowPlacement,
    cycleMinutes: state.cycleMinutes,
    tentSeed: state.tentSeed,
  }));
}
function applyZoomStyle() {
  document.documentElement.style.setProperty("--camp-zoom", String(state.zoom));
  document.documentElement.style.setProperty("--scene-x", (native ? 0 : (window.innerWidth - 500 * state.zoom) / 2) + "px");
  document.documentElement.style.setProperty("--scene-y", (native ? 0 : (window.innerHeight - 300 * state.zoom) / 2) + "px");
  renderer?.resize(state.zoom);
  if (ready) renderer.draw(state);
}
async function syncTray() {
  if (native) await invoke("sync_tray", { settings: {
    pinned: state.pinned, muted: state.muted, paused: state.paused,
    timePaused: state.timePausedAt !== null,
    steam: state.steam, passthrough, zoom: state.zoom,
    frameDuration: state.frameDuration,
    cycleMinutes: state.cycleMinutes,
  }});
}
function message(text: string) {
  if (native) {
    // Click and double-click can both send a notice. Keep them in interaction order.
    trayNoticeQueue = trayNoticeQueue.then(() => invoke<void>("set_tray_notice", { text })).catch(console.error);
    return;
  }
  if (!toast) return;
  toast.textContent = text;
  toast.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("visible"), 1400);
}
function fail(error: unknown) {
  const text = error instanceof Error ? error.message : String(error);
  debug.errors.push(text);
  message(text);
  console.error(error);
}
// Native menu events and keyboard commands share one queue, so checks match the applied settings.
let commandQueue = Promise.resolve();
function dispatchCommand(id: string): Promise<void> {
  commandQueue = commandQueue.then(() => performCommand(id)).catch(async error => {
    fail(error);
    await syncTray().catch(fail);
  });
  return commandQueue;
}
async function performCommand(id: string) {
  if (id === "pin") {
    const next = !state.pinned;
    if (native) await invoke("set_pinned", { pinned: next });
    state.pinned = next;
    message(next ? "营地置顶已开启" : "已取消置顶");
  } else if (id === "sound") {
    const next = !state.muted;
    await audio.setEnabled(!next);
    state.muted = next;
    message(next ? "声音已关闭" : "篝火声已开启");
  } else if (id === "pause") {
    state.paused = !state.paused;
    if (ready) renderer.draw(state);
    message(state.paused ? "动画已暂停" : "动画已继续");
  } else if (id === "pause-time") {
    if (state.timePausedAt === null) {
      state.timePausedAt = state.clock;
    } else {
      // Exclude the paused interval without changing the game hour or daily routines.
      state.cycleOffset += (state.timePausedAt - state.clock) / (state.cycleMinutes * 60_000);
      state.timePausedAt = null;
    }
    if (ready) renderer.draw(state);
    message(state.timePausedAt !== null ? "时间已暂停" : "时间已继续");
  } else if (id === "steam") {
    state.steam = !state.steam;
    message(state.steam ? "水壶蒸汽已开启" : "水壶蒸汽已关闭");
  } else if (id === "passthrough") {
    const next = !passthrough;
    if (native) await invoke("set_cursor_passthrough", { enabled: next });
    passthrough = next;
    message(next ? "空白处鼠标穿透已开启" : "空白处鼠标穿透已关闭");
  } else if (/^zoom-(70|80|90|100|110|120|130|140|150)$/.test(id)) {
    const zoom = Number(id.slice(5)) / 100;
    if (native) {
      await dragCompletion;
      windowPlacement = await invoke<WindowPlacement | null>("set_zoom", { zoom }) ?? windowPlacement;
    }
    state.zoom = zoom;
    applyZoomStyle();
    message(`场景缩放 ${Math.round(zoom * 100)}%`);
  } else if (/^speed-(70|80|90|100|110|120|130|140|150|160|170|180)$/.test(id)) {
    state.frameDuration = Number(id.slice(6));
    message(`火焰节奏 ${(100 / state.frameDuration).toFixed(2)}×`);
  } else if (/^cycle-(20|30|45|60|90|120)$/.test(id)) {
    const minutes = Number(id.slice(6));
    // Preserve the simulated hour while changing how fast future real time advances it.
    state.cycleOffset += (state.timePausedAt ?? state.clock) / 60_000 * (1 / state.cycleMinutes - 1 / minutes);
    state.cycleMinutes = minutes;
    if (ready) renderer.draw(state);
    message(`现实 ${minutes} 分钟 = 游戏一昼夜`);
  } else {
    throw new Error("未知营地操作");
  }
  save();
  await syncTray();
}
app.addEventListener("pointerleave", () => { state.hovered = null; });
const point = (event: PointerEvent) => {
  const r = canvas.getBoundingClientRect();
  return {
    x: ((event.clientX - r.left) * 500) / r.width,
    y: ((event.clientY - r.top) * 300) / r.height,
  };
};
let press: { x: number; y: number; hit: string | null } | null = null;
let clickedFire = false, firstFireClick = false;
interface DragSession {
  origin: Promise<{ x: number; y: number }>;
  startX: number;
  startY: number;
  scale: number;
  dx: number;
  dy: number;
  appliedX: number;
  appliedY: number;
  task: Promise<void> | null;
}
let drag: DragSession | null = null;
function flushDrag(session: DragSession): Promise<void> {
  if (!desktop) return Promise.resolve();
  if (session.task) return session.task;
  session.task = (async () => {
    const origin = await session.origin;
    while (session.appliedX !== session.dx || session.appliedY !== session.dy) {
      const { dx, dy } = session;
      await desktop!.setPosition(
        new PhysicalPosition(origin.x + dx, origin.y + dy),
      );
      session.appliedX = dx;
      session.appliedY = dy;
    }
  })().catch(fail).finally(() => { session.task = null; });
  return session.task;
}
function moveDrag(session: DragSession, event: PointerEvent) {
  session.dx = Math.round((event.screenX - session.startX) * session.scale);
  session.dy = Math.round((event.screenY - session.startY) * session.scale);
  return flushDrag(session);
}
function finishDrag(session: DragSession) {
  dragCompletion = flushDrag(session).then(async () => {
    if (!native) return;
    const placement = await invoke<WindowPlacement | null>("finish_drag");
    if (placement) {
      windowPlacement = placement;
      save();
    }
  }).catch(fail);
}
canvas.addEventListener("pointermove", (event) => {
  if (!ready) return;
  if (drag) {
    void moveDrag(drag, event);
    return;
  }
  const { x, y } = point(event);
  state.hovered = renderer.hit(x, y);
  canvas.style.cursor = state.hovered ? "pointer" : "grab";
});
canvas.addEventListener("pointerdown", (event) => {
  if (!ready || event.button !== 0) return;
  clickedFire = false;
  const { x, y } = point(event),
    hit = renderer.hit(x, y);
  if (!hit || event.shiftKey) {
    press = null;
    dragRequests++;
    drag = {
      origin: desktop
        ? dragCompletion.then(() => invoke("begin_drag")).then(() => desktop.outerPosition())
        : Promise.resolve({ x: 0, y: 0 }),
      startX: event.screenX,
      startY: event.screenY,
      scale: window.devicePixelRatio || 1,
      dx: 0,
      dy: 0,
      appliedX: 0,
      appliedY: 0,
      task: null,
    };
    canvas.setPointerCapture(event.pointerId);
    canvas.style.cursor = "grabbing";
    return;
  }
  press = { x, y, hit };
  canvas.setPointerCapture(event.pointerId);
});
canvas.addEventListener("pointerup", (event) => {
  if (drag) {
    const session = drag;
    void moveDrag(session, event);
    drag = null;
    canvas.style.cursor = "grab";
    finishDrag(session);
    return;
  }
  if (!press) return;
  const { x, y } = point(event),
    target = press;
  press = null;
  if (Math.hypot(x - target.x, y - target.y) > 5) return;
  clickedFire = target.hit === "fire" && renderer.hit(x, y) === "fire";
  state.interactions++;
  const fire = currentDayNight().fire;
  if (target.hit === "kettle") {
    if (!fire.heat) {
      state.steamUntil = 0;
      message("水已经凉了，傍晚再烧");
      return;
    }
    state.steam = true;
    save();
    void syncTray().catch(fail);
    state.steamUntil = (fullscreenPausedAt ?? performance.now()) + 3000;
    message("咕嘟——水开了");
  } else {
    if (!fire.flame) {
      state.fireUntil = 0;
      message(fire.smoke ? "篝火还有余烟，双击可加速入夜" : "篝火正在休息，双击可加速入夜");
      return;
    }
    state.fireUntil = (fullscreenPausedAt ?? performance.now()) + 2200;
    message("火星轻轻升起");
  }
});
canvas.addEventListener("click", (event) => {
  // Use the platform click count, and require both completed clicks to hit the fire.
  const doubleClickedFire = event.detail === 2 && firstFireClick && clickedFire;
  firstFireClick = event.detail === 1 && clickedFire;
  clickedFire = false;
  if (doubleClickedFire) startDayNightTransition();
});
canvas.addEventListener("pointercancel", () => {
  press = null;
  clickedFire = firstFireClick = false;
  if (drag) finishDrag(drag);
  drag = null;
});
window.addEventListener("contextmenu", (event) => event.preventDefault());
window.addEventListener("keydown", (event) => {
  if (event.code === "Space" && event.target === canvas) {
    event.preventDefault();
    void dispatchCommand("pause");
  }
});
window.addEventListener("resize", applyZoomStyle);
let maskBusy = false, lastMaskClock = -Infinity;
function updateDynamicMask() {
  if (!native || !ready || !passthrough || maskBusy || state.clock - lastMaskClock < 500) return;
  lastMaskClock = state.clock;
  maskBusy = true;
  void invoke("update_hit_mask", { rows: renderer.mask(state.clock) })
    .catch(fail).finally(() => { maskBusy = false; });
}
function loop(now: number) {
  requestAnimationFrame(loop);
  const delta = lastTime ? Math.min(now - lastTime, 100) : 0;
  lastTime = now;
  if (!ready || document.hidden || fullscreenPausedAt !== null) return;
  if (!state.paused) {
    state.clock += delta;
    advanceDayNightTransition(delta);
    if (currentDayNight().fire.flame > 0)
      state.firePhase += delta / (state.fireUntil > now ? 65 : state.frameDuration);
  }
  if (now - lastFrame < 1000 / 30) return;
  lastFrame = now;
  audio.setIntensity(currentDayNight().fire.flame);
  renderer.draw(state);
  updateDynamicMask();
  renderCount++;
}
loadScene()
  .then(async ({ scene, images }) => {
    renderer = new CampRenderer(canvas, scene, images);
    applyZoomStyle();
    if (saved.zoom !== state.zoom || saved.tentSeed !== state.tentSeed) save();
    renderer.draw(state);
    if (native) {
      await listen<string>("camp-menu", event => { void dispatchCommand(event.payload); });
      await listen<boolean>("camp-fullscreen", event => setFullscreenPaused(event.payload));
    }
    ready = true;
    debug.ready = true;
    loading?.remove();
    if (native) {
      await invoke("ready_window", {
        rows: renderer.mask(), pinned: state.pinned, passthrough, zoom: state.zoom,
        placement: windowPlacement,
        sceneBottom: renderer.visibleBottom(),
        groundBaseline: renderer.groundBaseline(),
      });
      await syncTray();
    }
  })
  .catch((error) => {
    if (loading) loading.textContent = "营地载入失败，请重新启动";
    fail(error);
  });
requestAnimationFrame(loop);
