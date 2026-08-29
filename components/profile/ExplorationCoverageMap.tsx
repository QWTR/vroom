import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Text, TouchableOpacity, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useIsFocused } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import { useTheme } from '../../contexts/ThemeContext';
import { fetchCoverageCells, fetchGamificationStatus } from '../../lib/gamificationClient';

type Props = { userId?: number | null; height?: number; interactive?: boolean; autoRefreshMs?: number };

export function ExplorationCoverageMap({ userId, height = 170, interactive = false, autoRefreshMs = 0 }: Props) {
  const { theme, isDark } = useTheme();
  const router = useRouter();
  const isFocused = useIsFocused();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [totalRevealed, setTotalRevealed] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const refresh = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError('');
    try {
      const page = await fetchCoverageCells({ userId: userId ?? undefined, limit: 50 });
      setTotalRevealed(Math.max(0, page.totalRevealed));
      if (userId == null) {
        const status = await fetchGamificationStatus();
        setSyncing(Number(status?.bufferedPings ?? 0) > 0 || Number(status?.activityCoverageSync?.pending ?? 0) > 0);
      }
    } catch {
      setError('Nie udało się odświeżyć mapy odkryć.');
    } finally { setLoading(false); }
  }, [userId]);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    if (!isFocused || autoRefreshMs < 30_000) return undefined;
    const timer = setInterval(() => void refresh(true), autoRefreshMs);
    return () => clearInterval(timer);
  }, [autoRefreshMs, isFocused, refresh]);
  const open = () => router.push({ pathname: '/exploration-map', params: userId != null ? { userId: String(userId) } : {} } as any);
  const label = syncing ? 'Synchronizujemy ostatni przejazd' : `${totalRevealed} odkrytych kafelków`;
  return <TouchableOpacity activeOpacity={interactive ? 0.86 : 1} disabled={!interactive || loading} onPress={error ? () => void refresh() : open} style={{ height, borderRadius: 18, overflow: 'hidden', borderWidth: 1, borderColor: error ? '#ef4444' : theme.border, backgroundColor: isDark ? '#0b0b0d' : '#17171a', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20 }}>
    <View style={{ width: 58, height: 58, borderRadius: 29, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.primarySoft, borderWidth: 1, borderColor: theme.primaryBorder }}><MaterialCommunityIcons name="map-marker-radius-outline" size={31} color={theme.primary} /></View>
    <Text style={{ color: theme.text, fontSize: 15, fontWeight: '900', marginTop: 10 }}>Mapa odkryć</Text>
    <Text style={{ color: error ? '#ef4444' : theme.textMuted, fontSize: 11, fontWeight: '800', marginTop: 4, textAlign: 'center' }}>{error || label}</Text>
    {loading ? <ActivityIndicator color={theme.primary} style={{ marginTop: 10 }} /> : interactive ? <View style={{ marginTop: 10, borderRadius: 999, paddingHorizontal: 13, paddingVertical: 7, backgroundColor: '#000000aa', borderWidth: 1, borderColor: theme.primaryBorder, flexDirection: 'row', alignItems: 'center', gap: 6 }}><MaterialCommunityIcons name="map-search-outline" size={16} color={theme.primary} /><Text style={{ color: '#fff', fontSize: 10, fontWeight: '900' }}>{error ? 'SPRÓBUJ PONOWNIE' : 'OTWÓRZ MAPĘ'}</Text></View> : null}
  </TouchableOpacity>;
}
