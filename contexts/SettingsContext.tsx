import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_URL } from '../constants/mapConfig';
import type { ProfilePremiumExtras } from '../constants/profilePremiumExtras';
import { DEFAULT_PROFILE_PREMIUM_EXTRAS, mergeProfilePremiumExtras } from '../constants/profilePremiumExtras';
import type { SpotifyProfileTrack } from '../constants/profile';
import { hasAcceptedBackgroundLocationDisclosure } from '../lib/backgroundLocationConsent';
import { resolveBackendPremium } from '../lib/resolveBackendPremium';

const SETTINGS_FETCH_TIMEOUT_MS = 25_000;
const CLIENT_ONLY_SETTING_KEYS: (keyof AppSettings)[] = [
  'locationMarkerStyle',
  'homeLatitude',
  'homeLongitude',
  'homeLabel',
];

function fetchWithTimeout(
  url: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<Response> {
  const { timeoutMs = SETTINGS_FETCH_TIMEOUT_MS, signal: outer, ...rest } = init;
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  const onOuterAbort = () => ac.abort();
  if (outer) {
    if (outer.aborted) ac.abort();
    else outer.addEventListener('abort', onOuterAbort, { once: true });
  }
  return fetch(url, { ...rest, signal: ac.signal }).finally(() => {
    clearTimeout(t);
    if (outer) outer.removeEventListener('abort', onOuterAbort);
  });
}

/** Premium z backendu (status + /me + giełda) — spójnie z banerem i PATCH ustawień. */
async function fetchServerPremiumActive(
  token: string,
  signal?: AbortSignal,
): Promise<boolean> {
  if (signal?.aborted) return false;
  try {
    return await resolveBackendPremium(token, signal);
  } catch {
    return false;
  }
}

async function hydrateSettingsFromCache(): Promise<Partial<AppSettings> | null> {
  try {
    const cachedRaw = await AsyncStorage.getItem('app_settings');
    if (!cachedRaw) return null;
    return JSON.parse(cachedRaw) as Partial<AppSettings>;
  } catch {
    return null;
  }
}

function readClientOnlySettings(source: Partial<AppSettings> | null | undefined): Partial<AppSettings> {
  const picked: Partial<AppSettings> = {};
  if (!source) return picked;
  for (const key of CLIENT_ONLY_SETTING_KEYS) {
    if (source[key] !== undefined) {
      picked[key] = source[key];
    }
  }
  return picked;
}

export interface AppSettings {
  privateProfile:      boolean;
  hideLocation:        boolean;
  locationFriendsOnly: boolean;
  backgroundTracking:  boolean;
  notifMeets:          boolean;
  notifLikes:          boolean;
  notifComments:       boolean;
  notifWarnings:       boolean;
  notifMessages:       boolean;
  notifFriends:        boolean;
  notifAchievements:   boolean;
  notifFollowedPosts:  boolean;
  notifDiscussionPosts: boolean;
  locationMarkerStyle: 'arrow' | 'profile';
  homeLatitude: number | null;
  homeLongitude: number | null;
  homeLabel: string | null;
  friendsOnlyMessages: boolean;
  nickColor?: string | null;
  profileThemePreset?: string;
  avatarFramePreset?: string;
  accountTheme?: any;
  isPremium?: boolean;
  isAdmin?: boolean;
  premiumExpiresAt?: string | null;
  profilePremiumExtras?: ProfilePremiumExtras | null;
  /** Zapis w DB — do przywrócenia po odnowieniu premium (gdy isPremium === false). */
  savedNickColor?: string | null;
  savedProfileThemePreset?: string;
  savedAvatarFramePreset?: string;
  savedAccountTheme?: any;
  savedProfilePremiumExtras?: ProfilePremiumExtras | null;
  spotifyProfileTrack?: SpotifyProfileTrack | null;
  /** True when server has Spotify Web API credentials (in-app search). */
  spotifySearchAvailable?: boolean;
}

function pickSavedProfileAppearance(data: Record<string, unknown>): Partial<AppSettings> {
  const patch: Partial<AppSettings> = {};
  if (data.savedNickColor !== undefined) patch.savedNickColor = data.savedNickColor as string | null;
  if (data.savedProfileThemePreset != null) patch.savedProfileThemePreset = String(data.savedProfileThemePreset);
  if (data.savedAvatarFramePreset != null) patch.savedAvatarFramePreset = String(data.savedAvatarFramePreset);
  if (data.savedAccountTheme !== undefined) patch.savedAccountTheme = data.savedAccountTheme;
  if (data.savedProfilePremiumExtras != null) {
    patch.savedProfilePremiumExtras = mergeProfilePremiumExtras(data.savedProfilePremiumExtras);
  }
  return patch;
}

function mergeProfileAppearanceFromApi(
  data: Record<string, unknown>,
  prev: AppSettings,
  premiumActive: boolean,
): Partial<AppSettings> {
  const saved = pickSavedProfileAppearance(data);
  if (premiumActive) {
    return {
      ...saved,
      nickColor: (data.nickColor as string | null | undefined) ?? prev.nickColor ?? null,
      profileThemePreset: (data.profileThemePreset as string | undefined) ?? prev.profileThemePreset ?? 'default',
      avatarFramePreset: (data.avatarFramePreset as string | undefined) ?? prev.avatarFramePreset ?? 'vroom',
      accountTheme: data.accountTheme !== undefined ? data.accountTheme : prev.accountTheme,
      profilePremiumExtras: data.profilePremiumExtras != null
        ? mergeProfilePremiumExtras(data.profilePremiumExtras)
        : prev.profilePremiumExtras,
    };
  }
  return {
    ...saved,
    nickColor: saved.savedNickColor ?? prev.savedNickColor ?? prev.nickColor ?? null,
    profileThemePreset: saved.savedProfileThemePreset ?? prev.savedProfileThemePreset ?? prev.profileThemePreset ?? 'default',
    avatarFramePreset: saved.savedAvatarFramePreset ?? prev.savedAvatarFramePreset ?? prev.avatarFramePreset ?? 'vroom',
    accountTheme: saved.savedAccountTheme !== undefined ? saved.savedAccountTheme : (prev.savedAccountTheme ?? prev.accountTheme),
    profilePremiumExtras: saved.savedProfilePremiumExtras != null
      ? saved.savedProfilePremiumExtras
      : (prev.savedProfilePremiumExtras ?? prev.profilePremiumExtras),
  };
}

const DEFAULTS: AppSettings = {
  privateProfile:      false,
  hideLocation:        false,
  locationFriendsOnly: false,
  backgroundTracking:  false,
  notifMeets:          true,
  notifLikes:          true,
  notifComments:       true,
  notifWarnings:       true,
  notifMessages:       true,
  notifFriends:        true,
  notifAchievements:   true,
  notifFollowedPosts:  true,
  notifDiscussionPosts: true,
  locationMarkerStyle: 'profile',
  homeLatitude: null,
  homeLongitude: null,
  homeLabel: null,
  friendsOnlyMessages: false,
  nickColor: null,
  profileThemePreset: 'default',
  avatarFramePreset: 'vroom',
  accountTheme: null,
  isPremium: false,
  isAdmin: false,
  premiumExpiresAt: null,
  profilePremiumExtras: null,
  spotifyProfileTrack: null,
  spotifySearchAvailable: false,
};

interface SettingsContextType {
  settings:      AppSettings;
  loading:       boolean;
  updateSetting: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => Promise<boolean>;
  fetchSettings: () => Promise<void>;
}

const SettingsContext = createContext<SettingsContextType>({
  settings:      DEFAULTS,
  loading:       true,
  updateSetting: async () => false,
  fetchSettings: async () => {},
});

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<AppSettings>(DEFAULTS);
  const [loading,  setLoading]  = useState(true);

  const fetchSettingsCore = useCallback(async (signal?: AbortSignal) => {
    try {
      const backgroundLocationAccepted = await hasAcceptedBackgroundLocationDisclosure();
      const token = (await AsyncStorage.getItem('userToken')) ?? (await AsyncStorage.getItem('token'));
      const cachedRaw = await AsyncStorage.getItem('app_settings');
      let cachedParsed: Partial<AppSettings> | null = null;
      if (cachedRaw) {
        try {
          cachedParsed = JSON.parse(cachedRaw) as Partial<AppSettings>;
        } catch {
          cachedParsed = null;
        }
      }
      if (!token) {
        if (cachedParsed) {
          try {
            setSettings({
              ...DEFAULTS,
              ...cachedParsed,
              backgroundTracking: backgroundLocationAccepted ? !!(cachedParsed.backgroundTracking ?? DEFAULTS.backgroundTracking) : false,
            });
          } catch { /* ignore bad cache */ }
        }
        return;
      }

      const serverPremiumActive = await fetchServerPremiumActive(token, signal);

      const res = await fetchWithTimeout(`${API_URL}/api/settings`, {
        headers: { Authorization: `Bearer ${token}` },
        signal,
      });
      if (res.ok) {
        const data = await res.json();
        setSettings(prev => {
          const clientOnlyFromCache = readClientOnlySettings(cachedParsed);
          const premiumActive = !!(serverPremiumActive || data.isPremium);
          const merged = {
            ...DEFAULTS,
            ...cachedParsed,
            ...prev,
            ...data,
            ...clientOnlyFromCache,
            ...mergeProfileAppearanceFromApi(data, prev, premiumActive),
            isPremium: premiumActive,
            locationFriendsOnly: premiumActive ? !!(data.locationFriendsOnly ?? prev.locationFriendsOnly) : false,
            backgroundTracking: backgroundLocationAccepted ? !!(data.backgroundTracking ?? prev.backgroundTracking ?? DEFAULTS.backgroundTracking) : false,
          };
          try {
            AsyncStorage.setItem('app_settings', JSON.stringify(merged));
          } catch { /* ignore */ }
          return merged;
        });
      }

      const premiumRes = await fetchWithTimeout(`${API_URL}/api/settings/premium-ui`, {
        headers: { Authorization: `Bearer ${token}` },
        signal,
      });
      if (premiumRes.ok) {
        const premiumData = await premiumRes.json();
        const premiumActive = !!(serverPremiumActive || premiumData.isPremium);
        setSettings(prev => ({
          ...prev,
          ...premiumData,
          ...readClientOnlySettings(prev),
          ...mergeProfileAppearanceFromApi(premiumData, prev, premiumActive),
          isPremium: premiumActive,
          backgroundTracking: backgroundLocationAccepted ? prev.backgroundTracking : false,
        }));
        try {
          const cached = await AsyncStorage.getItem('app_settings');
          const current = cached ? JSON.parse(cached) : {};
          const next = {
            ...current,
            ...premiumData,
            ...readClientOnlySettings(current),
            ...mergeProfileAppearanceFromApi(premiumData, current, premiumActive),
            isPremium: premiumActive,
          };
          await AsyncStorage.setItem('app_settings', JSON.stringify(next));
        } catch { /* ignore */ }
      }
    } catch (e: unknown) {
      const name = e && typeof e === 'object' && 'name' in e ? String((e as Error).name) : '';
      if (name === 'AbortError') return;
      const cached = await AsyncStorage.getItem('app_settings');
      if (cached) {
        try {
          const backgroundLocationAccepted = await hasAcceptedBackgroundLocationDisclosure();
          const parsed = JSON.parse(cached);
          setSettings({
            ...DEFAULTS,
            ...parsed,
            backgroundTracking: backgroundLocationAccepted ? !!(parsed.backgroundTracking ?? DEFAULTS.backgroundTracking) : false,
          });
        } catch { /* ignore */ }
      }
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const ac = new AbortController();

    (async () => {
      try {
        const backgroundLocationAccepted = await hasAcceptedBackgroundLocationDisclosure();
        const cachedParsed = await hydrateSettingsFromCache();
        if (!cancelled && cachedParsed) {
          setSettings(prev => ({
            ...DEFAULTS,
            ...cachedParsed,
            ...prev,
            backgroundTracking: backgroundLocationAccepted
              ? !!(cachedParsed.backgroundTracking ?? DEFAULTS.backgroundTracking)
              : false,
          }));
          setLoading(false);
        }
      } catch { /* ignore */ }

      try {
        await fetchSettingsCore(ac.signal);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [fetchSettingsCore]);

  const fetchSettings = useCallback(async () => {
    await fetchSettingsCore();
  }, [fetchSettingsCore]);

  const updateSetting = useCallback(async <K extends keyof AppSettings>(
    key:   K,
    value: AppSettings[K],
  ): Promise<boolean> => {
    const nextVal = key === 'profilePremiumExtras' && value != null
      ? mergeProfilePremiumExtras(value as ProfilePremiumExtras)
      : value;
    setSettings(prev => ({ ...prev, [key]: nextVal }));

    try {
      const cached  = await AsyncStorage.getItem('app_settings');
      const current = cached ? JSON.parse(cached) : {};
      await AsyncStorage.setItem('app_settings', JSON.stringify({ ...current, [key]: nextVal }));
    } catch {}

    try {
      const token = (await AsyncStorage.getItem('userToken')) ?? (await AsyncStorage.getItem('token'));
      if (!token) return false;
      const res = await fetch(`${API_URL}/api/settings`, {
        method:  'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization:  `Bearer ${token}`,
        },
        body: JSON.stringify({ [key]: nextVal }),
      });
      if (!res.ok) {
        let errorCode: string | null = null;
        let errorMsg: string | null = null;
        try {
          const errJson = await res.json();
          errorCode = typeof errJson?.code === 'string' ? errJson.code : null;
          errorMsg = typeof errJson?.error === 'string' ? errJson.error : null;
        } catch { /* ignore */ }

        if (errorCode !== 'PREMIUM_REQUIRED') {
          const def = (DEFAULTS as any)[key];
          setSettings(prev => ({
            ...prev,
            [key]: def !== undefined
              ? def
              : (key === 'profilePremiumExtras' ? DEFAULT_PROFILE_PREMIUM_EXTRAS : prev[key]),
          }));
        }
        console.log('updateSetting failed:', res.status, errorCode, errorMsg);
        return false;
      }

      try {
        const data = await res.json();
        setSettings(prev => {
          const patch: Partial<AppSettings> = {};
          if (key === 'profilePremiumExtras' && data.profilePremiumExtras != null) {
            patch.profilePremiumExtras = mergeProfilePremiumExtras(data.profilePremiumExtras);
          }
          if (data.profileThemePreset != null) patch.profileThemePreset = data.profileThemePreset;
          if (data.avatarFramePreset != null) patch.avatarFramePreset = data.avatarFramePreset;
          if (data.nickColor !== undefined) patch.nickColor = data.nickColor;
          return Object.keys(patch).length ? { ...prev, ...patch } : prev;
        });
      } catch { /* ignore */ }

      return true;
    } catch (e) {
      console.log('updateSetting error:', e);
      return false;
    }
  }, []);

  return (
    <SettingsContext.Provider value={{ settings, loading, updateSetting, fetchSettings }}>
      {children}
    </SettingsContext.Provider>
  );
}

export const useSettings = () => useContext(SettingsContext);
