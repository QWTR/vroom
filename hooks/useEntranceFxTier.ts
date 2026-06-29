import { useMemo } from 'react';
import { Platform } from 'react-native';
import type { EntranceFxTier } from '../components/motion/entranceFxTypes';

/** Lite preset on older Android — fewer sparks/lanes for smoother playback. */
export function useEntranceFxTier(): EntranceFxTier {
  return useMemo(() => {
    if (Platform.OS === 'android' && Platform.Version < 29) return 'lite';
    return 'full';
  }, []);
}
