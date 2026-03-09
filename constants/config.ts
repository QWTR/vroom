import Constants from 'expo-constants';

// ─── Automatyczne wykrywanie adresu hosta ────────────────────────────────────
// Na Androidzie/iOS w Expo Go debugHostUri wskazuje na maszynę deweloperską.
// Na web lub w standalone fallback → localhost.
const getDevHost = (): string => {
  const debugHost = Constants.expoConfig?.hostUri
    ?? (Constants as any).manifest?.debuggerHost
    ?? (Constants as any).manifest2?.extra?.expoGo?.debuggerHost;

  if (debugHost) {
    // debuggerHost ma format "192.168.x.x:19000" — bierzemy tylko IP
    return debugHost.split(':')[0];
  }
  return 'localhost';
};

// ─── Środowiska ──────────────────────────────────────────────────────────────
const ENV = {
  dev: {
    API_URL:    `http://100.123.231.30:5000`,
    SOCKET_URL: `http://100.123.231.30:5000`,
  },
  prod: {
    API_URL:    'https://v-room.app',   // ← zmień na swój prod URL
    SOCKET_URL: 'https://v-room.app',
  },
} as const;

const isProduction = true;  // <-- Ręcznie ustaw na true przy produkcji (lub użyj env var)
const config       = isProduction ? ENV.prod : ENV.dev;

// ─── Eksporty ─────────────────────────────────────────────────────────────────
export const API_URL    = config.API_URL;
export const SOCKET_URL = config.SOCKET_URL;

// ─── Timeouty / limity ────────────────────────────────────────────────────────
export const REQUEST_TIMEOUT_MS = 10_000;   // 10 sek
export const MAX_PHOTO_SIZE_MB  = 10;

// ─── Mapa / Lokalizacja ───────────────────────────────────────────────────────
export const DEFAULT_REGION = {
  latitude:        52.2297,   // Warszawa
  longitude:       21.0122,
  latitudeDelta:   0.05,
  longitudeDelta:  0.05,
};

export const SPOT_RADIUS_KM = 25;   // domyślny promień dla listy spotów

// ─── Kolory marki (zapasowo – główne w StyleSheet) ────────────────────────────
export const COLORS = {
  primary:     '#e33835',
  primaryDim:  '#e3383520',
  background:  '#0f0f0f',
  surface:     '#1a1a1a',
  surfaceAlt:  '#252525',
  border:      '#ffffff10',
  borderDim:   '#ffffff05',
  textPrimary: '#ffffff',
  textMuted:   '#ffffff60',
  textDim:     '#ffffff40',
  gold:        '#ffb300',
} as const;

export default config;