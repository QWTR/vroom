let nowMs = Date.now();
let timer: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<() => void>();

function stopIfIdle() {
  if (listeners.size === 0 && timer) {
    clearInterval(timer);
    timer = null;
  }
}

function startIfNeeded() {
  if (timer || listeners.size === 0) return;
  timer = setInterval(() => {
    nowMs = Date.now();
    listeners.forEach((listener) => listener());
  }, 1000);
}

export const sharedSecondClock = {
  getSnapshot: () => nowMs,
  subscribe(listener: () => void) {
    listeners.add(listener);
    nowMs = Date.now();
    startIfNeeded();
    return () => {
      listeners.delete(listener);
      stopIfIdle();
    };
  },
  activeSubscriberCount: () => listeners.size,
};
