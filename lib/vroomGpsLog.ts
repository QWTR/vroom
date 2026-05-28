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

function safePayloadJson(t: number, payload: Record<string, unknown> | undefined): string {
  try {
    return JSON.stringify({ t, ...(payload ?? {}) });
  } catch {
    return JSON.stringify({ t, serializeError: true });
  }
}

/** Ten sam format co logTelemetry — widoczny w: adb logcat -d | findstr "[VROOM-TEL]" */
function emitVroomTelLogcatLine(tag: string, t: number, payload: Record<string, unknown> | undefined): void {
  const iso = new Date(t).toISOString();
  const json = safePayloadJson(t, payload);
  try {
    console.log(`[VROOM-TEL] ${iso} | ${tag} | ${json}`);
  } catch {
    console.log(`[VROOM-TEL] ${iso} | ${tag} | {}`);
  }
}

function emitVroomGpsLog(
  tag: string,
  payload: Record<string, unknown> | undefined,
  throttleMs: number,
): void {
  const now = Date.now();
  if (throttleMs > 0) {
    const last = lastAt[tag] ?? 0;
    if (now - last < throttleMs) return;
    lastAt[tag] = now;
  }
  const entry = { t: now, tag, payload };
  emitVroomTelLogcatLine(tag, now, payload);
  for (const listener of listeners) {
    try {
      listener(entry);
    } catch {
      // Log subscribers must never break local diagnostics.
    }
  }
}

/** Throttled — adb: logcat -d -v time | findstr /C:"[VROOM-TEL]" */
export function vroomGpsLog(
  tag: string,
  payload?: Record<string, unknown>,
  throttleMs = 1800,
): void {
  emitVroomGpsLog(tag, payload, throttleMs);
}

/** Bez throttlingu — resume, feed reject, nagłe skoki (nie gubi zdarzeń). */
export function vroomGpsLogNow(
  tag: string,
  payload?: Record<string, unknown>,
): void {
  emitVroomGpsLog(tag, payload, 0);
}
