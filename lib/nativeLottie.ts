import { UIManager } from 'react-native';

let cachedNativeLottieAvailable: boolean | null = null;

export function isNativeLottieAvailable() {
  if (cachedNativeLottieAvailable != null) return cachedNativeLottieAvailable;
  try {
    const getConfig = UIManager.getViewManagerConfig?.bind(UIManager);
    cachedNativeLottieAvailable = ['LottieAnimationView', 'RCTLottieAnimationView'].some((name) => (
      !!getConfig?.(name) || !!(UIManager as unknown as Record<string, unknown>)[name]
    ));
  } catch {
    cachedNativeLottieAvailable = false;
  }
  return cachedNativeLottieAvailable;
}
