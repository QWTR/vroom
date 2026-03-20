import { useCallback, useRef } from 'react';
import * as Notifications from 'expo-notifications';
import { Step }           from './useGoogleDirections';

export const NAV_NOTIFICATION_ID = 'navigation-live';

export function useNavigationNotification() {

  // ── Pokaż/zaktualizuj powiadomienie nawigacji ─────────────────────────
  const showNavigationNotification = useCallback(async (
    step:         Step,
    distanceLeft: string,
    timeLeft:     string,
  ) => {
    const maneuverIcon = getManeuverIcon(step.maneuver);
    const instruction  = stripHtml(step.html_instructions);

    await Notifications.scheduleNotificationAsync({
      identifier: NAV_NOTIFICATION_ID,
      content: {
        title:    `${maneuverIcon} ${instruction}`,
        body:     `Za ${step.distance.text} · Cel za ${distanceLeft} (${timeLeft})`,
        sound:    false, // bez dźwięku — nie chcemy za każdym krokiem
        sticky:   true,  // Android — powiadomienie nie znika po swipe
        data:     { type: 'navigation' },
        android: {
          channelId:   'navigation',
          ongoing:     true,  // ← jak Google Maps — nie można odrzucić
          priority:    'high',
          smallIcon:   'notification_icon',
          color:       '#e33835',
        } as any,
      },
      trigger: null,
    });
  }, []);

  // ── Usuń powiadomienie nawigacji ──────────────────────────────────────
  const dismissNavigationNotification = useCallback(async () => {
    await Notifications.dismissNotificationAsync(NAV_NOTIFICATION_ID);
    await Notifications.cancelScheduledNotificationAsync(NAV_NOTIFICATION_ID);
  }, []);

  return { showNavigationNotification, dismissNavigationNotification };
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();
}

function getManeuverIcon(maneuver?: string): string {
  switch (maneuver) {
    case 'turn-left':              return '⬅️';
    case 'turn-right':             return '➡️';
    case 'turn-slight-left':       return '↖️';
    case 'turn-slight-right':      return '↗️';
    case 'turn-sharp-left':        return '↩️';
    case 'turn-sharp-right':       return '↪️';
    case 'uturn-left':
    case 'uturn-right':            return '🔄';
    case 'roundabout-left':
    case 'roundabout-right':       return '🔃';
    case 'ramp-left':
    case 'ramp-right':             return '🛣️';
    case 'merge':                  return '🔀';
    case 'fork-left':
    case 'fork-right':             return '⑂';
    case 'ferry':                  return '⛴️';
    case 'straight':               return '⬆️';
    default:                       return '🧭';
  }
}