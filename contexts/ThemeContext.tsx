import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_URL } from '../constants/mapConfig';
import {
  darkTheme, lightTheme, AppTheme, ThemeMode,
  THEME_MODE_KEY, CUSTOM_THEME_KEY, buildCustomTheme, isThemeDark, normalizeAccessibleTheme,
} from '../constants/theme';
import { APP_THEME_PRESETS, getAppThemePreset } from '../constants/appThemePresets';

const THEME_PRESET_KEY = 'app_theme_preset';

interface ThemeContextType {
  theme:           AppTheme;
  mode:            ThemeMode;
  presetId:        string | null;
  isDark:          boolean;
  isPremiumTheme:  boolean;
  customTheme:     AppTheme;
  availablePresets: typeof APP_THEME_PRESETS;
  toggleTheme:     () => void;
  setMode:         (mode: ThemeMode) => Promise<boolean>;
  setPreset:       (presetId: string) => Promise<boolean>;
  setCustomColor:  (key: keyof AppTheme, color: string) => void;
  resetCustomTheme:() => void;
}

const ThemeContext = createContext<ThemeContextType>({
  theme:            darkTheme,
  mode:             'dark',
  presetId:         null,
  isDark:           true,
  isPremiumTheme:   false,
  customTheme:      { ...darkTheme },
  availablePresets: APP_THEME_PRESETS,
  toggleTheme:      () => {},
  setMode:          async () => false,
  setPreset:        async () => false,
  setCustomColor:   () => {},
  resetCustomTheme: () => {},
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [mode,        setModeState]   = useState<ThemeMode>('dark');
  const [presetId,    setPresetIdState] = useState<string | null>(null);
  const [isPremiumTheme, setIsPremiumTheme] = useState(false);
  const [customTheme, setCustomTheme] = useState<AppTheme>({ ...darkTheme });
  const userChangedThemeRef = useRef(false);

  const syncThemeToBackend = useCallback(async (nextMode: ThemeMode, nextCustom: AppTheme, nextPresetId?: string | null) => {
    try {
      const token = (await AsyncStorage.getItem('userToken')) ?? (await AsyncStorage.getItem('token'));
      if (!token) return true;
      const accountTheme =
        nextMode === 'preset'
          ? { mode: 'preset', presetId: nextPresetId ?? null }
          : nextMode === 'custom'
            ? { mode: 'custom', customTheme: nextCustom }
            : { mode: nextMode };
      const res = await fetch(`${API_URL}/api/settings`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountTheme }),
      });
      if (res.status === 402) {
        setIsPremiumTheme(false);
        return false;
      }
      if (res.ok && (nextMode === 'preset' || nextMode === 'custom')) {
        setIsPremiumTheme(true);
      }
      return res.ok;
    } catch {
      return false;
    }
  }, []);

  // Wczytaj tryb i custom kolory
  useEffect(() => {
    (async () => {
      const savedMode   = await AsyncStorage.getItem(THEME_MODE_KEY);
      const savedCustom = await AsyncStorage.getItem(CUSTOM_THEME_KEY);
      const savedPreset = await AsyncStorage.getItem(THEME_PRESET_KEY);

      if (savedMode === 'dark' || savedMode === 'light' || savedMode === 'custom' || savedMode === 'preset') {
        setModeState(savedMode);
      }
      if (savedPreset && getAppThemePreset(savedPreset)) setPresetIdState(savedPreset);
      if (savedCustom) {
        try {
          const parsed = JSON.parse(savedCustom);
          setCustomTheme(buildCustomTheme(parsed));
        } catch {}
      }

      try {
        const token = (await AsyncStorage.getItem('userToken')) ?? (await AsyncStorage.getItem('token'));
        if (token) {
          const res = await fetch(`${API_URL}/api/settings/premium-ui`, { headers: { Authorization: `Bearer ${token}` } });
          if (res.ok) {
            const data = await res.json();
            const premiumActive = !!data?.isPremium;
            setIsPremiumTheme(premiumActive);
            if (userChangedThemeRef.current) return;
            const remote = data?.accountTheme;
            if (remote?.mode === 'dark' || remote?.mode === 'light') {
              setModeState(remote.mode);
              await AsyncStorage.setItem(THEME_MODE_KEY, remote.mode);
            } else if (premiumActive && remote?.mode === 'preset' && getAppThemePreset(remote?.presetId)) {
              setModeState('preset');
              setPresetIdState(remote.presetId);
              await AsyncStorage.setItem(THEME_MODE_KEY, 'preset');
              await AsyncStorage.setItem(THEME_PRESET_KEY, remote.presetId);
            } else if (premiumActive && remote?.mode === 'custom') {
              setModeState('custom');
              await AsyncStorage.setItem(THEME_MODE_KEY, 'custom');
            } else if (!premiumActive && (savedMode === 'preset' || savedMode === 'custom')) {
              setModeState('dark');
              await AsyncStorage.setItem(THEME_MODE_KEY, 'dark');
            }
            if (remote?.customTheme) {
              setCustomTheme(buildCustomTheme(remote.customTheme));
              await AsyncStorage.setItem(CUSTOM_THEME_KEY, JSON.stringify(remote.customTheme));
            }
          }
        }
      } catch {}
    })();
  }, []);

  const setMode = useCallback(async (m: ThemeMode) => {
    userChangedThemeRef.current = true;
    const prevMode = mode;
    setModeState(m);
    await AsyncStorage.setItem(THEME_MODE_KEY, m);
    const synced = await syncThemeToBackend(m, customTheme, presetId);
    if (m === 'dark' || m === 'light') {
      return true;
    }
    if (!synced) {
      setModeState(prevMode);
      await AsyncStorage.setItem(THEME_MODE_KEY, prevMode);
      return false;
    }
    return true;
  }, [customTheme, mode, presetId, syncThemeToBackend]);

  const setPreset = useCallback(async (nextPresetId: string) => {
    if (!getAppThemePreset(nextPresetId)) return false;
    userChangedThemeRef.current = true;
    const prevMode = mode;
    const prevPresetId = presetId;
    setPresetIdState(nextPresetId);
    setModeState('preset');
    await AsyncStorage.setItem(THEME_MODE_KEY, 'preset');
    await AsyncStorage.setItem(THEME_PRESET_KEY, nextPresetId);
    const synced = await syncThemeToBackend('preset', customTheme, nextPresetId);
    if (!synced) {
      setModeState(prevMode);
      setPresetIdState(prevPresetId);
      await AsyncStorage.setItem(THEME_MODE_KEY, prevMode);
      if (prevPresetId) await AsyncStorage.setItem(THEME_PRESET_KEY, prevPresetId);
      else await AsyncStorage.removeItem(THEME_PRESET_KEY);
      return false;
    }
    return true;
  }, [customTheme, mode, presetId, syncThemeToBackend]);

  const toggleTheme = useCallback(() => {
    setMode(mode === 'dark' ? 'light' : 'dark');
  }, [mode, setMode]);

  const setCustomColor = useCallback(async (key: keyof AppTheme, color: string) => {
    userChangedThemeRef.current = true;
    setCustomTheme(prev => {
      const updated = { ...prev, [key]: color };
      AsyncStorage.setItem(CUSTOM_THEME_KEY, JSON.stringify(updated)).catch(() => {});
      syncThemeToBackend(mode, updated, presetId);
      return updated;
    });
  }, [isPremiumTheme, mode, presetId, syncThemeToBackend]);

  const resetCustomTheme = useCallback(async () => {
    userChangedThemeRef.current = true;
    if (!isPremiumTheme) return;
    const base = mode === 'light' ? { ...lightTheme } : { ...darkTheme };
    setCustomTheme(base);
    await AsyncStorage.removeItem(CUSTOM_THEME_KEY);
    await syncThemeToBackend(mode, base, presetId);
  }, [isPremiumTheme, mode, presetId, syncThemeToBackend]);

  const presetTheme = mode === 'preset' ? getAppThemePreset(presetId)?.theme : null;
  const rawTheme = mode === 'dark'
    ? darkTheme
    : mode === 'light'
      ? lightTheme
      : mode === 'preset' && presetTheme
        ? presetTheme
        : customTheme;
  const theme = useMemo(() => normalizeAccessibleTheme(rawTheme), [rawTheme]);
  const isDark = mode === 'dark' || ((mode === 'custom' || mode === 'preset') && isThemeDark(theme));

  const value = useMemo(() => ({
    theme, mode, presetId, isDark, isPremiumTheme, customTheme,
    availablePresets: APP_THEME_PRESETS,
    toggleTheme, setMode, setPreset, setCustomColor, resetCustomTheme,
  }), [theme, mode, presetId, isDark, isPremiumTheme, customTheme, toggleTheme, setMode, setPreset, setCustomColor, resetCustomTheme]);

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);
