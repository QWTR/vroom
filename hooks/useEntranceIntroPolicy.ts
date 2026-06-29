import { useCallback, useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { EntranceMotionMode, EntranceShowOncePolicy } from '../components/motion/entranceFxTypes';

const MOTION_MODE_KEY = 'entrance_motion_mode';
const INTRO_PREFIX = 'intro_seen_';

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

async function readMotionMode(): Promise<EntranceMotionMode> {
  try {
    const raw = await AsyncStorage.getItem(MOTION_MODE_KEY);
    if (raw === 'off' || raw === 'reduced' || raw === 'full') return raw;
  } catch {}
  return 'full';
}

export async function setEntranceMotionMode(mode: EntranceMotionMode) {
  await AsyncStorage.setItem(MOTION_MODE_KEY, mode);
}

export function useEntranceIntroPolicy(
  screenKey: string,
  policy: EntranceShowOncePolicy = 'session',
  opts?: { skipFromNotification?: boolean },
) {
  const [shouldShow, setShouldShow] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (opts?.skipFromNotification) {
        if (!cancelled) { setShouldShow(false); setReady(true); }
        return;
      }

      const mode = await readMotionMode();
      if (mode === 'off') {
        if (!cancelled) { setShouldShow(false); setReady(true); }
        return;
      }

      let reduceMotion = false;
      try {
        reduceMotion = await AccessibilityInfo.isReduceMotionEnabled();
      } catch {}

      if (reduceMotion || mode === 'reduced') {
        if (!cancelled) { setShouldShow(false); setReady(true); }
        return;
      }

      if (policy === 'always') {
        if (!cancelled) { setShouldShow(true); setReady(true); }
        return;
      }

      if (policy === 'never') {
        if (!cancelled) { setShouldShow(false); setReady(true); }
        return;
      }

      const storageKey = policy === 'day'
        ? `${INTRO_PREFIX}${screenKey}_${todayKey()}`
        : `${INTRO_PREFIX}${screenKey}`;

      const seen = await AsyncStorage.getItem(storageKey);
      if (!cancelled) {
        setShouldShow(!seen);
        setReady(true);
      }
    })();

    return () => { cancelled = true; };
  }, [screenKey, policy, opts?.skipFromNotification]);

  const markSeen = useCallback(async () => {
    if (policy === 'always' || policy === 'never') return;
    const storageKey = policy === 'day'
      ? `${INTRO_PREFIX}${screenKey}_${todayKey()}`
      : `${INTRO_PREFIX}${screenKey}`;
    await AsyncStorage.setItem(storageKey, '1');
    setShouldShow(false);
  }, [screenKey, policy]);

  const skip = useCallback(() => {
    setShouldShow(false);
    void markSeen();
  }, [markSeen]);

  return { shouldShow, ready, markSeen, skip };
}
