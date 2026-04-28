import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_URL } from '../constants/mapConfig';

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

  const fetchSettings = useCallback(async () => {
    try {
      const token = await AsyncStorage.getItem('token');
      if (!token) {
        // Fallback na cache lokalny
        const cached = await AsyncStorage.getItem('app_settings');
        if (cached) setSettings({ ...DEFAULTS, ...JSON.parse(cached) });
        return;
      }
      const res = await fetch(`${API_URL}/api/settings`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setSettings({ ...DEFAULTS, ...data });
        await AsyncStorage.setItem('app_settings', JSON.stringify(data));
      }

      if (token) {
        const premiumRes = await fetch(`${API_URL}/api/settings/premium-ui`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (premiumRes.ok) {
          const premiumData = await premiumRes.json();
          setSettings(prev => ({ ...prev, ...premiumData }));
          const cached = await AsyncStorage.getItem('app_settings');
          const current = cached ? JSON.parse(cached) : {};
          await AsyncStorage.setItem('app_settings', JSON.stringify({ ...current, ...premiumData }));
        }
      }
    } catch {
      const cached = await AsyncStorage.getItem('app_settings');
      if (cached) setSettings({ ...DEFAULTS, ...JSON.parse(cached) });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchSettings(); }, []);

  const updateSetting = useCallback(async <K extends keyof AppSettings>(
    key:   K,
    value: AppSettings[K],
  ) => {
    // Optimistic update — shared across all screens immediately
    setSettings(prev => ({ ...prev, [key]: value }));

    // Persist to AsyncStorage first so it survives remounts even if API fails
    try {
      const cached  = await AsyncStorage.getItem('app_settings');
      const current = cached ? JSON.parse(cached) : {};
      await AsyncStorage.setItem('app_settings', JSON.stringify({ ...current, [key]: value }));
    } catch {}

    // Best-effort sync to API
    try {
      const token = await AsyncStorage.getItem('token');
      if (!token) return;
      const res = await fetch(`${API_URL}/api/settings`, {
        method:  'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization:  `Bearer ${token}`,
        },
        body: JSON.stringify({ [key]: value }),
      });
      if (!res.ok) {
        // rollback optimistic change if backend rejected (e.g. premium write by free user)
        setSettings(prev => ({ ...prev, [key]: (DEFAULTS as any)[key] }));
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
