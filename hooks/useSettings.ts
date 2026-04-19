import { useState, useEffect, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_URL }  from '../constants/mapConfig';

export interface AppSettings {
  privateProfile:     boolean;
  hideLocation:       boolean;
  backgroundTracking: boolean;
  notifMeets:         boolean;
  notifLikes:         boolean;
  notifComments:      boolean;
  notifWarnings:      boolean;
  notifMessages:      boolean;    
  notifFriends:       boolean;    
  notifAchievements:  boolean;
  locationMarkerStyle: 'arrow' | 'car' | 'dot';
}

const DEFAULTS: AppSettings = {
  privateProfile:     false,
  hideLocation:       false,
  backgroundTracking: true,
  notifMeets:         true,
  notifLikes:         true,
  notifComments:      true,
  notifWarnings:      true,
  notifMessages:      true,       
  notifFriends:       true,      
  notifAchievements:  true, 
  locationMarkerStyle: 'arrow',
};

export function useSettings() {
  const [settings, setSettings] = useState<AppSettings>(DEFAULTS);
  const [loading,  setLoading]  = useState(true);

  // ── Wczytaj z API ─────────────────────────────────────
  const fetchSettings = useCallback(async () => {
    try {
      const token = await AsyncStorage.getItem('token');
      if (!token) return;
      const res  = await fetch(`${API_URL}/api/settings`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setSettings({ ...DEFAULTS, ...data });
        // Cache lokalnie
        await AsyncStorage.setItem('app_settings', JSON.stringify(data));
      }
    } catch {
      // Fallback na cache lokalny
      const cached = await AsyncStorage.getItem('app_settings');
      if (cached) setSettings({ ...DEFAULTS, ...JSON.parse(cached) });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchSettings(); }, []);

  // ── Zaktualizuj pojedyncze ustawienie ─────────────────
  const updateSetting = useCallback(async <K extends keyof AppSettings>(
    key:   K,
    value: AppSettings[K],
  ) => {
    // Optimistic update
    setSettings(prev => ({ ...prev, [key]: value }));

    try {
      const token = await AsyncStorage.getItem('token');
      if (!token) return;

      await fetch(`${API_URL}/api/settings`, {
        method:  'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization:  `Bearer ${token}`,
        },
        body: JSON.stringify({ [key]: value }),
      });

      // Zaktualizuj cache
      const cached = await AsyncStorage.getItem('app_settings');
      const current = cached ? JSON.parse(cached) : {};
      await AsyncStorage.setItem('app_settings', JSON.stringify({ ...current, [key]: value }));
    } catch (e) {
      console.log('updateSetting error:', e);
      // Revert
      setSettings(prev => ({ ...prev, [key]: !value }));
    }
  }, []);

  return { settings, loading, updateSetting, fetchSettings };
}
