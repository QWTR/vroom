import type { AppStateStatus } from 'react-native';

let mapScreenVisible = false;

export function isMapPathname(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  const path = pathname.split('?')[0].replace(/\/+$/, '') || '/';
  return path === '/map' || path === '/(tabs)/map';
}

export function setMapScreenVisible(visible: boolean): void {
  mapScreenVisible = visible;
}

export function isMapScreenVisible(): boolean {
  return mapScreenVisible;
}

export function shouldSuppressMapForegroundOverlay(
  appState: AppStateStatus | null | undefined,
): boolean {
  return mapScreenVisible && appState === 'active';
}
