import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  darkTheme, lightTheme, AppTheme, ThemeMode,
  THEME_MODE_KEY, CUSTOM_THEME_KEY, buildCustomTheme,
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
    })();
  }, []);

  const setMode = useCallback(async (m: ThemeMode) => {
    setModeState(m);
    await AsyncStorage.setItem(THEME_MODE_KEY, m);
  }, []);

  const toggleTheme = useCallback(() => {
    setMode(mode === 'dark' ? 'light' : 'dark');
  }, [mode, setMode]);

  const setCustomColor = useCallback(async (key: keyof AppTheme, color: string) => {
    setCustomTheme(prev => {
      const updated = { ...prev, [key]: color };
      // Zapisz do AsyncStorage
      AsyncStorage.setItem(CUSTOM_THEME_KEY, JSON.stringify(updated)).catch(() => {});
      return updated;
    });
  }, []);

  const resetCustomTheme = useCallback(async () => {
    setCustomTheme({ ...darkTheme });
    await AsyncStorage.removeItem(CUSTOM_THEME_KEY);
  }, []);

  const theme = mode === 'dark' ? darkTheme : mode === 'light' ? lightTheme : customTheme;

  return (
    <ThemeContext.Provider value={{
      theme, mode, isDark: mode === 'dark',
      customTheme, toggleTheme, setMode, setCustomColor, resetCustomTheme,
    }}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);