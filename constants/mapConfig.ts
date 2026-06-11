const _token = process.env.EXPO_PUBLIC_MAPBOX_TOKEN;
if (!_token && __DEV__) {
  console.warn('[mapConfig] EXPO_PUBLIC_MAPBOX_TOKEN is not set. Set it in your .env file.');
}
export const MAPBOX_TOKEN           = 'pk.eyJ1IjoicDFrM3kiLCJhIjoiY21vMWx4Ym14MDZzdzJyc2VmOW1jNmNuaCJ9.hvV-mM6a1--RhnJqlMkojg';

/** Klasyczna mapa ulic — zielone parki, POI z ikonami, tory, etykiety miejsc. */
export const MAPBOX_STYLE_LIGHT     = 'mapbox://styles/mapbox/streets-v12';
/** Nocna nawigacja — czytelne drogi, tory, mniej „szara płaszczyzna” niż dark-v11. */
export const MAPBOX_STYLE_DARK      = 'mapbox://styles/mapbox/navigation-night-v1';
export const MAPBOX_STYLE_SATELLITE = 'mapbox://styles/mapbox/satellite-v9';
/** Hybryda satelita + etykiety ulic/POI — jak w referencyjnym zdjęciu. */
export const MAPBOX_STYLE_HYBRID    = 'mapbox://styles/mapbox/satellite-streets-v12';

/** Poprzednie style (legacy / Android Auto fallback). */
export const MAPBOX_STYLE_LIGHT_LEGACY = 'mapbox://styles/mapbox/light-v11';
export const MAPBOX_STYLE_DARK_LEGACY  = 'mapbox://styles/mapbox/dark-v11';

export const MAX_NEARBY_USERS_DISTANCE = 350;
export const API_URL                = 'https://v-room.app';

export type MapTypeId = 'standard' | 'satellite' | 'hybrid';

/** Bazowy styl Mapbox dla trybu standard (nie sat/hybrid). */
export function resolveStandardMapStyle(isDark: boolean): string {
  return isDark ? MAPBOX_STYLE_DARK : MAPBOX_STYLE_LIGHT;
}

export function resolveMapStyle(mapType: string, isDark: boolean): string {
  if (mapType === 'satellite') return MAPBOX_STYLE_SATELLITE;
  if (mapType === 'hybrid')    return MAPBOX_STYLE_HYBRID;
  return resolveStandardMapStyle(isDark);
}

/** Czy nakładać warstwy „żywej” mapy (trawa, tory) — niepotrzebne na sat/hybrid. */
export function shouldApplyVividMapLayers(mapType: string): boolean {
  return mapType !== 'satellite' && mapType !== 'hybrid';
}
