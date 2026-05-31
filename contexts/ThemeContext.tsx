import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_URL } from '../constants/mapConfig';
import {
  darkTheme, lightTheme, AppTheme, ThemeMode,
  THEME_MODE_KEY, CUSTOM_THEME_KEY, buildCustomTheme, isThemeDark,
} from '../constants/theme';

interface ThemeContextType {
  theme:           AppTheme;
  mode:            ThemeMode;
  isDark:          boolean;
  customTheme:     AppTheme;
  toggleTheme:     () => void;
  setMode:         (mode: ThemeMode) => void;
  setCustomColor:  (key: keyof AppTheme, color: string) => void;
  resetCustomTheme:() => void;
}

const ThemeContext = createContext<ThemeContextType>({
  theme:            darkTheme,
  mode:             'dark',
  isDark:           true,
  customTheme:      { ...darkTheme },
  toggleTheme:      () => {},
  setMode:          () => {},
  setCustomColor:   () => {},
  resetCustomTheme: () => {},
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [mode,        setModeState]   = useState<ThemeMode>('dark');
  const [customTheme, setCustomTheme] = useState<AppTheme>({ ...darkTheme });

  const syncThemeToBackend = useCallback(async (nextMode: ThemeMode, nextCustom: AppTheme) => {
    try {
      const token = (await AsyncStorage.getItem('userToken')) ?? (await AsyncStorage.getItem('token'));
      if (!token) return;
      await fetch(`${API_URL}/api/settings`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountTheme: { mode: nextMode, customTheme: nextCustom } }),
      });
    } catch {}
  }, []);

  // Wczytaj tryb i custom kolory
  useEffect(() => {
    (async () => {
      const savedMode   = await AsyncStorage.getItem(THEME_MODE_KEY);
      const savedCustom = await AsyncStorage.getItem(CUSTOM_THEME_KEY);

      if (savedMode === 'dark' || savedMode === 'light' || savedMode === 'custom') {
        setModeState(savedMode);
      }
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
            const remote = data?.accountTheme;
            if (remote?.mode === 'dark' || remote?.mode === 'light' || remote?.mode === 'custom') {
              setModeState(remote.mode);
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
    setModeState(m);
    await AsyncStorage.setItem(THEME_MODE_KEY, m);
    await syncThemeToBackend(m, customTheme);
  }, [customTheme, syncThemeToBackend]);

  const toggleTheme = useCallback(() => {
    setMode(mode === 'dark' ? 'light' : 'dark');
  }, [mode, setMode]);

  const setCustomColor = useCallback(async (key: keyof AppTheme, color: string) => {
    setCustomTheme(prev => {
      const updated = { ...prev, [key]: color };
      AsyncStorage.setItem(CUSTOM_THEME_KEY, JSON.stringify(updated)).catch(() => {});
      syncThemeToBackend(mode, updated);
      return updated;
    });
  }, [mode, syncThemeToBackend]);

  const resetCustomTheme = useCallback(async () => {
    const base = mode === 'light' ? { ...lightTheme } : { ...darkTheme };
    setCustomTheme(base);
    await AsyncStorage.removeItem(CUSTOM_THEME_KEY);
    await syncThemeToBackend(mode, base);
  }, [mode, syncThemeToBackend]);

  const theme = mode === 'dark' ? darkTheme : mode === 'light' ? lightTheme : customTheme;
  const isDark = mode === 'dark' || (mode === 'custom' && isThemeDark(customTheme));

  const value = useMemo(() => ({
    theme, mode, isDark, customTheme, toggleTheme, setMode, setCustomColor, resetCustomTheme,
  }), [theme, mode, isDark, customTheme, toggleTheme, setMode, setCustomColor, resetCustomTheme]);

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);
