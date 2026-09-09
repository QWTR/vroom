import { useMemo } from 'react';
import { useTheme } from '../../contexts/ThemeContext';
import type { AppTheme } from '../../constants/theme';

/** Opaque surfaces keep the map readable without expensive full-screen blur. */
export function mapHudTheme(base: AppTheme, dark: boolean): AppTheme {
  return {
    ...base,
    bg: dark ? '#10151C' : '#F3F5F7',
    surface: dark ? '#171E27' : '#FFFFFF',
    surface2: dark ? '#202A36' : '#EDF1F5',
    surface3: dark ? '#2A3644' : '#E4EAF0',
    border: dark ? '#FFFFFF14' : '#14263D18',
    border2: dark ? '#FFFFFF24' : '#14263D28',
    border3: dark ? '#FFFFFF38' : '#14263D38',
    text: dark ? '#F6F8FC' : '#172435',
    textMuted: dark ? '#B3C0CF' : '#536377',
    textDim: dark ? '#B3C0CF' : '#536377',
    mapOverlay: dark ? '#171E27' : '#FFFFFF',
    mapOverlayText: dark ? '#F6F8FC' : '#172435',
    info: dark ? '#83BEFF' : '#225DB5',
    online: dark ? '#63DEB4' : '#167052',
  };
}

export function useMapHudTheme() {
  const source = useTheme();
  const theme = useMemo(() => mapHudTheme(source.theme, source.isDark), [source.theme, source.isDark]);
  return { ...source, theme };
}
