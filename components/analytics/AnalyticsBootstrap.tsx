import { usePathname } from 'expo-router';
import { useCallback, useEffect, useRef } from 'react';
import {
  flushAnalytics,
  initAnalytics,
  startAnalyticsSession,
  track,
} from '../../lib/analytics/client';
import { logicalScreenName } from '../../lib/analytics/routes';
import { usePerformance } from '../../contexts/PerformanceContext';
import { useManagedInterval } from '../../hooks/useManagedInterval';

const NEW_SESSION_AFTER_MS = 30 * 60 * 1000;
const SCREEN_CHECKPOINT_MS = 30 * 1000;

export function AnalyticsBootstrap() {
  const pathname = usePathname();
  const { appState } = usePerformance();
  const activeScreen = useRef<{ name: string; startedAt: number } | null>(null);
  const backgroundedAt = useRef<number | null>(null);
  const previousAppState = useRef(appState);

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

  const checkpoint = useCallback(() => {
    const current = activeScreen.current;
    if (!current) return;
    const now = Date.now();
    const durationMs = now - current.startedAt;
    if (durationMs < 1000) return;
    track({ eventName: 'screen_engagement', screenName: current.name, durationMs, priority: 'medium' });
    current.startedAt = now;
    void flushAnalytics();
  }, []);

  useManagedInterval({
    id: 'analytics:checkpoint-flush',
    callback: checkpoint,
    intervalMs: SCREEN_CHECKPOINT_MS,
    policy: 'foreground',
  });

  useEffect(() => {
    const previous = previousAppState.current;
    previousAppState.current = appState;
    if (previous === appState) return;
    const onChange = () => {
      const now = Date.now();
      if (appState !== 'active') {
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
    onChange();
  }, [appState, pathname]);

  return null;
}
