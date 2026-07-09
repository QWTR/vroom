import { Platform, StatusBar } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const TAB_BAR_CONTENT_HEIGHT = 65;

/** Top offset for back buttons / screen headers (safe area aware). */
export function useScreenHeaderTop(extra = 8): number {
  const insets = useSafeAreaInsets();
  return Platform.OS === 'ios'
    ? insets.top + extra
    : Math.max((StatusBar.currentHeight ?? 0) + extra, 12);
}

/** Bottom scroll padding — tab screens vs stack screens. */
export function useScreenScrollBottomPadding(opts?: { inTab?: boolean; extra?: number }): number {
  const insets = useSafeAreaInsets();
  const extra = opts?.extra ?? 16;
  if (opts?.inTab) {
    return TAB_BAR_CONTENT_HEIGHT + insets.bottom + extra;
  }
  return insets.bottom + (opts?.extra ?? 24);
}

/** Extra scroll padding inside tab screens (on top of sceneStyle tab bar inset). */
export function useTabScrollBottomPadding(extra = 16): number {
  const insets = useSafeAreaInsets();
  return TAB_BAR_CONTENT_HEIGHT + insets.bottom + extra;
}
