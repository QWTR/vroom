import { usePathname } from 'expo-router';
import { useEffect, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import {
  flushAnalytics,
  initAnalytics,
  startAnalyticsSession,
  track,
} from '../../lib/analytics/client';
import { logicalScreenName } from '../../lib/analytics/routes';

const NEW_SESSION_AFTER_MS = 30 * 60 * 1000;
const SCREEN_CHECKPOINT_MS = 30 * 1000;

export function AnalyticsBootstrap() {
  const pathname = usePathname();
  const activeScreen = useRef<{ name: string; startedAt: number } | null>(null);
  const backgroundedAt = useRef<number | null>(null);

  useEffect(() => {
    void initAnalytics();
  }, []);

  useEffect(() => {
    const now = Date.now();
    const previous = activeScreen.current;
    if (previous) {
      track({
        eventName: 'screen_engagement',
        screenName: previous.name,
        durationMs: now - previous.startedAt,
        priority: 'medium',
      });
    }
    const name = logicalScreenName(pathname);
    activeScreen.current = { name, startedAt: now };
    track({ eventName: 'screen_viewed', screenName: name, priority: 'medium' });
  }, [pathname]);

  useEffect(() => {
    const timer = setInterval(() => {
      if (AppState.currentState !== 'active') return;
      const current = activeScreen.current;
      if (!current) return;
      const now = Date.now();
      const durationMs = now - current.startedAt;
      if (durationMs < 1000) return;
      track({
        eventName: 'screen_engagement',
        screenName: current.name,
        durationMs,
        priority: 'medium',
      });
      current.startedAt = now;
      void flushAnalytics();
    }, SCREEN_CHECKPOINT_MS);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const onChange = (state: AppStateStatus) => {
      const now = Date.now();
      if (state !== 'active') {
        const current = activeScreen.current;
        if (current) {
          track({ eventName: 'screen_engagement', screenName: current.name, durationMs: now - current.startedAt, priority: 'medium' });
          activeScreen.current = null;
        }
        backgroundedAt.current = now;
        void flushAnalytics();
        return;
      }
      if (backgroundedAt.current && now - backgroundedAt.current >= NEW_SESSION_AFTER_MS) startAnalyticsSession();
      const name = logicalScreenName(pathname);
      activeScreen.current = { name, startedAt: now };
      track({ eventName: 'screen_viewed', screenName: name, priority: 'medium' });
      backgroundedAt.current = null;
      void flushAnalytics();
    };
    const subscription = AppState.addEventListener('change', onChange);
    return () => subscription.remove();
  }, [pathname]);

  return null;
}
