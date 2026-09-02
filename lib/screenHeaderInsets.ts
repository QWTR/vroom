import { Platform, StatusBar, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useReadability } from '../contexts/ReadabilityContext';

const TAB_BAR_CONTENT_HEIGHT = 82;

function useDynamicTabBarHeight(): number {
  const insets = useSafeAreaInsets();
  const { textScale } = useReadability();
  const { fontScale } = useWindowDimensions();
  const effectiveScale = Math.min(2, textScale * fontScale);
  const safeBottom = Math.max(insets.bottom, Platform.OS === 'android' ? 12 : 0);
  return TAB_BAR_CONTENT_HEIGHT + Math.round(Math.max(0, effectiveScale - 1) * 30) + safeBottom;
}

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
  const tabBarHeight = useDynamicTabBarHeight();
  const extra = opts?.extra ?? 16;
  if (opts?.inTab) {
    return tabBarHeight + extra;
  }
  return insets.bottom + (opts?.extra ?? 24);
}

/** Extra scroll padding inside tab screens (on top of sceneStyle tab bar inset). */
export function useTabScrollBottomPadding(extra = 16): number {
  return useDynamicTabBarHeight() + extra;
}
