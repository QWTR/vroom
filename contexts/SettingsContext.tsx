import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_URL } from '../constants/mapConfig';
import type { ProfilePremiumExtras } from '../constants/profilePremiumExtras';
import { DEFAULT_PROFILE_PREMIUM_EXTRAS, mergeProfilePremiumExtras } from '../constants/profilePremiumExtras';
import type { SpotifyProfileTrack } from '../constants/profile';

const SETTINGS_FETCH_TIMEOUT_MS = 25_000;

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

export interface AppSettings {
  privateProfile:      boolean;
  hideLocation:        boolean;
  backgroundTracking:  boolean;
  notifMeets:          boolean;
  notifLikes:          boolean;
  notifComments:       boolean;
  notifWarnings:       boolean;
  notifMessages:       boolean;
  notifFriends:        boolean;
  notifAchievements:   boolean;
  notifFollowedPosts:  boolean;
  locationMarkerStyle: 'arrow' | 'profile';
  friendsOnlyMessages: boolean;
  nickColor?: string | null;
  profileThemePreset?: string;
  avatarFramePreset?: string;
  accountTheme?: any;
  isPremium?: boolean;
  premiumExpiresAt?: string | null;
  profilePremiumExtras?: ProfilePremiumExtras | null;
  spotifyProfileTrack?: SpotifyProfileTrack | null;
  /** True when server has Spotify Web API credentials (in-app search). */
  spotifySearchAvailable?: boolean;
}

const DEFAULTS: AppSettings = {
  privateProfile:      false,
  hideLocation:        false,
  backgroundTracking:  true,
  notifMeets:          true,
  notifLikes:          true,
  notifComments:       true,
  notifWarnings:       true,
  notifMessages:       true,
  notifFriends:        true,
  notifAchievements:   true,
  notifFollowedPosts:  true,
  locationMarkerStyle: 'profile',
  friendsOnlyMessages: false,
  nickColor: null,
  profileThemePreset: 'default',
  avatarFramePreset: 'vroom',
  accountTheme: null,
  isPremium: false,
  premiumExpiresAt: null,
  profilePremiumExtras: null,
  spotifyProfileTrack: null,
  spotifySearchAvailable: false,
};

interface SettingsContextType {
  settings:      AppSettings;
  loading:       boolean;
  updateSetting: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => Promise<void>;
  fetchSettings: () => Promise<void>;
}

const SettingsContext = createContext<SettingsContextType>({
  settings:      DEFAULTS,
  loading:       true,
  updateSetting: async () => {},
  fetchSettings: async () => {},
});

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<AppSettings>(DEFAULTS);
  const [loading,  setLoading]  = useState(true);

  const fetchSettingsCore = useCallback(async (signal?: AbortSignal) => {
    try {
      const token = (await AsyncStorage.getItem('userToken')) ?? (await AsyncStorage.getItem('token'));
      if (!token) {
        const cached = await AsyncStorage.getItem('app_settings');
        if (cached) {
          try {
            setSettings({ ...DEFAULTS, ...JSON.parse(cached) });
          } catch { /* ignore bad cache */ }
        }
        return;
      }

      const res = await fetchWithTimeout(`${API_URL}/api/settings`, {
        headers: { Authorization: `Bearer ${token}` },
        signal,
      });
      if (res.ok) {
        const data = await res.json();
        setSettings(prev => {
          const merged = {
            ...DEFAULTS,
            ...prev,
            ...data,
            // Keep last known premium config locally when premium is expired.
            profilePremiumExtras: data.profilePremiumExtras != null
              ? mergeProfilePremiumExtras(data.profilePremiumExtras)
              : prev.profilePremiumExtras,
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
        setSettings(prev => ({
          ...prev,
          ...premiumData,
          profilePremiumExtras: premiumData.profilePremiumExtras != null
            ? mergeProfilePremiumExtras(premiumData.profilePremiumExtras)
            : prev.profilePremiumExtras,
        }));
        try {
          const cached = await AsyncStorage.getItem('app_settings');
          const current = cached ? JSON.parse(cached) : {};
          const next = {
            ...current,
            ...premiumData,
            profilePremiumExtras: premiumData.profilePremiumExtras != null
              ? mergeProfilePremiumExtras(premiumData.profilePremiumExtras)
              : current.profilePremiumExtras,
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
          setSettings({ ...DEFAULTS, ...JSON.parse(cached) });
        } catch { /* ignore */ }
      }
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const ac = new AbortController();

    (async () => {
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
  ) => {
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
      if (!token) return;
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
        try {
          const errJson = await res.json();
          errorCode = typeof errJson?.code === 'string' ? errJson.code : null;
        } catch { /* ignore */ }

        // When premium expired, preserve local premium options so they can be
        // restored immediately after user renews premium.
        if (errorCode !== 'PREMIUM_REQUIRED') {
          const def = (DEFAULTS as any)[key];
          setSettings(prev => ({ ...prev, [key]: def !== undefined ? def : (key === 'profilePremiumExtras' ? DEFAULT_PROFILE_PREMIUM_EXTRAS : prev[key]) }));
        }
      }
    } catch (e) {
      console.log('updateSetting error:', e);
    }
  }, []);

  return (
    <SettingsContext.Provider value={{ settings, loading, updateSetting, fetchSettings }}>
      {children}
    </SettingsContext.Provider>
  );
}

export const useSettings = () => useContext(SettingsContext);
