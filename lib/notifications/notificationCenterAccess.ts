const DEFAULT_WINDOW_MS = 10_000;
let allowedUntil = 0;

/** Opens the notification center only after an explicit bell tap or push action. */
export function allowNotificationCenterEntry(windowMs = DEFAULT_WINDOW_MS): void {
  allowedUntil = Date.now() + Math.max(1_000, windowMs);
}

/** One-shot guard against router/Android restoring /notifications on app start. */
export function consumeNotificationCenterEntry(now = Date.now()): boolean {
  const allowed = allowedUntil >= now;
  allowedUntil = 0;
  return allowed;
}
