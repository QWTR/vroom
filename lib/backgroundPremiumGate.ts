import * as Notifications from 'expo-notifications';

const THROTTLE_MS = 5 * 60_000;
let lastNotifiedAt = 0;

/**
 * Lokalny push gdy free user zminimalizuje appkę podczas jazdy / nawigacji.
 * GPS w tle wymaga Premium — mapa w foreground pozostaje darmowa.
 */
export async function notifyBackgroundPremiumRequired(): Promise<void> {
  const now = Date.now();
  if (now - lastNotifiedAt < THROTTLE_MS) return;
  lastNotifiedAt = now;

  try {
    const { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') return;

    await Notifications.scheduleNotificationAsync({
      content: {
        title: 'VROOM Premium',
        body: 'GPS w tle podczas jazdy i nawigacji — włącz Premium, aby kontynuować trasę po zminimalizowaniu aplikacji.',
        data: { type: 'premium_background_gps' },
      },
      trigger: null,
    });
  } catch {
    /* ignore */
  }
}
