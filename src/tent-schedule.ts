export type TentVisual = "closedUnlit" | "openUnlit" | "openLit" | "closedLit";
export const TENT_VISUALS: TentVisual[] = ["closedUnlit", "openUnlit", "openLit", "closedLit"];
export const TENT_IDS = ["main", "rear", "right"] as const;
export type TentId = typeof TENT_IDS[number];
export type TentTimes = { open: number; light: number; close: number; off: number };
const profiles = new Map<string, Record<TentId, TentTimes>>();

function randomStream(seed: number) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let mixed = Math.imul(value ^ value >>> 15, value | 1);
    mixed ^= mixed + Math.imul(mixed ^ mixed >>> 7, mixed | 61);
    return ((mixed ^ mixed >>> 14) >>> 0) / 4294967296;
  };
}

export function tentTimesForDay(day: number, seed = 0): Record<TentId, TentTimes> {
  const key = `${seed}:${day}`;
  const cached = profiles.get(key);
  if (cached) return cached;
  const times = Object.fromEntries(TENT_IDS.map(id => [id, {}])) as Record<TentId, TentTimes>;
  const events = [
    { key: "open", start: 7, spacing: 0.33, jitter: 0.04 },
    { key: "light", start: 18, spacing: 0.33, jitter: 0.04 },
    { key: "close", start: 21, spacing: 0.8, jitter: 0.1 },
    { key: "off", start: 23, spacing: 0.33, jitter: 0.04 },
  ] as const;
  events.forEach((event, index) => {
    const random = randomStream((seed ^ Math.imul(day, 0x9e3779b1) ^ Math.imul(index + 1, 0x85ebca6b)) >>> 0);
    const order: TentId[] = [...TENT_IDS];
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    order.forEach((id, rank) => { times[id][event.key] = event.start + rank * event.spacing + random() * event.jitter; });
  });
  profiles.set(key, times);
  if (profiles.size > 12) profiles.delete(profiles.keys().next().value!);
  return times;
}

export function tentScheduleAt(hour: number, id: TentId = "main", day = 0, seed = 0) {
  const times = tentTimesForDay(day, seed)[id];
  const schedule: { hour: number; visual: TentVisual }[] = [
    { hour: 0, visual: "closedUnlit" },
    { hour: times.open, visual: "openUnlit" },
    { hour: times.light, visual: "openLit" },
    { hour: times.close, visual: "closedLit" },
    { hour: times.off, visual: "closedUnlit" },
  ];
  let current = 0;
  for (let index = 1; index < schedule.length; index++) if (hour >= schedule[index].hour) current = index;
  const target = schedule[current], previous = schedule[(current + schedule.length - 1) % schedule.length];
  // Fade over a quarter of an in-game hour, independently of the chosen cycle length.
  const elapsed = Math.min(1, Math.max(0, (hour - target.hour) / 0.25));
  const blend = elapsed * elapsed * (3 - 2 * elapsed);
  const weights: Record<TentVisual, number> = { closedUnlit: 0, openUnlit: 0, openLit: 0, closedLit: 0 };
  weights[previous.visual] += 1 - blend;
  weights[target.visual] += blend;
  const period = target.visual === "closedUnlit" ? (hour >= 6 && hour < 8 ? "清晨未起" : "深夜休息")
    : target.visual === "openUnlit" ? (hour < 11 ? "晨间通风" : "日间开门")
    : target.visual === "openLit" ? "夜间亮灯" : "睡前闭门";
  return { hour, day, times, period, visual: target.visual, weights, light: weights.openLit + weights.closedLit };
}
