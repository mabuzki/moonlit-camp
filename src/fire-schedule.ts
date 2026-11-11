const smooth = (start: number, end: number, value: number) => {
  const t = Math.max(0, Math.min(1, (value - start) / (end - start)));
  return t * t * (3 - 2 * t);
};

export function fireScheduleAt(hour: number) {
  let flame = 0;
  if (hour >= 18) flame = smooth(18, 18.25, hour);
  else if (hour < 2) flame = 1 - 0.64 * smooth(0, 2, hour);
  else if (hour < 6) flame = 0.36 * (1 - smooth(5.5, 6, hour));
  const smoke = smooth(5.5, 6, hour) * (1 - smooth(7, 8, hour));
  const heat = Math.min(1, flame + smoke * 0.2);
  const stage = flame > 0 ? (hour < 6 ? "low" : "burning") : smoke > 0 ? "smoking" : "out";
  return { stage, flame, smoke, heat };
}
