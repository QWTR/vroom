const lastAt: Record<string, number> = {};

/** Throttled GPS diagnostics — visible in `adb logcat` as ReactNativeJS. */
export function vroomGpsLog(
  tag: string,
  payload?: Record<string, unknown>,
  throttleMs = 1800,
): void {
  const now = Date.now();
  const last = lastAt[tag] ?? 0;
  if (now - last < throttleMs) return;
  lastAt[tag] = now;
  try {
    console.log(`[VROOM-GPS] ${tag}`, JSON.stringify({ t: now, ...(payload ?? {}) }));
  } catch {
    console.log(`[VROOM-GPS] ${tag}`);
  }
}
