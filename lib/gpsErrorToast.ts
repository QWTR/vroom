import Toast from 'react-native-toast-message';

export const GPS_ERROR_TOAST_COOLDOWN_MS = 15_000;

let lastGpsLocationErrorToastAt = 0;

/** Throttled GPS location error — max once per 15 s (tunnels, watchdog restarts). */
export function showGpsLocationErrorToast(
  text2 = 'Nie można pobrać lokalizacji',
): boolean {
  const now = Date.now();
  if (now - lastGpsLocationErrorToastAt < GPS_ERROR_TOAST_COOLDOWN_MS) {
    return false;
  }
  lastGpsLocationErrorToastAt = now;
  Toast.show({ type: 'error', text1: 'BŁĄD GPS', text2 });
  return true;
}
