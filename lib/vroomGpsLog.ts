const lastAt: Record<string, number> = {};

export type VroomGpsLogEntry = {
  t: number;
  tag: string;
  payload?: Record<string, unknown>;
};

const listeners = new Set<(entry: VroomGpsLogEntry) => void>();

export function subscribeVroomGpsLog(listener: (entry: VroomGpsLogEntry) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

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
  const entry = { t: now, tag, payload };
  try {
    console.log(`[VROOM-GPS] ${tag}`, JSON.stringify({ t: now, ...(payload ?? {}) }));
  } catch {
    console.log(`[VROOM-GPS] ${tag}`);
  }
  for (const listener of listeners) {
    try {
      listener(entry);
    } catch {
      // Log subscribers must never break local diagnostics.
    }
  }
}
