const listeners = new Set<() => void>();

export function emitMapVehicleChanged() {
  listeners.forEach((listener) => listener());
}

export function subscribeMapVehicleChanged(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
