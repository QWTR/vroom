import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View, type StyleProp, type ViewStyle } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { API_URL } from '../../constants/config';
import { useTheme } from '../../contexts/ThemeContext';
import { withAlpha } from '../../constants/theme';

type Spotlight = {
  season: { id: string; number: number; name: string; description?: string | null; imageUrl?: string | null; endsAt: string } | null;
  stats?: { points?: number; distanceKm?: number } | null;
  rewardCount?: number;
  achievementCount?: number;
};

let memorySpotlight: Spotlight | null = null;
let memoryLoadedAt = 0;
let pendingRequest: Promise<Spotlight | null> | null = null;
const CACHE_TTL_MS = 60_000;

const mediaUrl = (value?: string | null) => !value ? null : /^https?:\/\//i.test(value) ? value : `${API_URL}/${value.replace(/^\//, '')}`;

function remainingLabel(value: string, now: number) {
  const milliseconds = Math.max(0, new Date(value).getTime() - now);
  const days = Math.floor(milliseconds / 86_400_000);
  const hours = Math.floor((milliseconds % 86_400_000) / 3_600_000);
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000);
  if (milliseconds <= 0) return 'KOŃCZY SIĘ TERAZ';
  if (days > 0) return `${days} DNI · ${hours} GODZ.`;
  return `${hours} GODZ. · ${minutes} MIN`;
}

async function fetchSpotlight(): Promise<Spotlight | null> {
  if (memorySpotlight && Date.now() - memoryLoadedAt < CACHE_TTL_MS) return memorySpotlight;
  if (pendingRequest) return pendingRequest;
  pendingRequest = (async () => {
    const token = (await AsyncStorage.getItem('userToken')) ?? (await AsyncStorage.getItem('token'));
    if (!token) return null;
    const response = await fetch(`${API_URL}/api/seasons/spotlight`, { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) return null;
    const payload = await response.json();
    memorySpotlight = payload;
    memoryLoadedAt = Date.now();
    return payload;
  })().finally(() => { pendingRequest = null; });
  return pendingRequest;
}

export function SeasonSpotlightCard({ active = true, compact = false, style }: { active?: boolean; compact?: boolean; style?: StyleProp<ViewStyle> }) {
  const router = useRouter();
  const { theme } = useTheme();
  const [data, setData] = useState<Spotlight | null>(memorySpotlight);
  const [loading, setLoading] = useState(!memorySpotlight);
  const [now, setNow] = useState(Date.now());

  const load = useCallback(async () => {
    try {
      const next = await fetchSpotlight();
      setData(next);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!active) return;
    void load();
  }, [active, load]);

  useEffect(() => {
    if (!active || !data?.season) return;
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, [active, data?.season]);

  if (loading && !data) return compact ? null : <View style={[styles.loading, { borderColor: theme.border, backgroundColor: theme.surface }, style]}><ActivityIndicator color={theme.primary} /></View>;
  if (!data?.season) return null;

  const season = data.season;
  const image = mediaUrl(season.imageUrl);
  return (
    <TouchableOpacity
      activeOpacity={0.9}
      accessibilityRole="button"
      accessibilityLabel={`Otwórz szczegóły sezonu ${season.name}`}
      onPress={() => router.push('/seasons/current' as any)}
      style={[compact ? styles.compactCard : styles.card, { borderColor: withAlpha(theme.primary, '66'), backgroundColor: theme.surface }, style]}
    >
      {image ? <Image source={{ uri: image }} style={StyleSheet.absoluteFillObject} contentFit="cover" transition={180} cachePolicy="memory-disk" /> : <LinearGradient colors={[withAlpha(theme.primary, '46'), theme.surface, '#080808']} style={StyleSheet.absoluteFillObject} />}
      <LinearGradient colors={compact ? ['rgba(0,0,0,.2)', 'rgba(0,0,0,.92)'] : ['rgba(0,0,0,.05)', 'rgba(0,0,0,.48)', 'rgba(0,0,0,.96)']} style={StyleSheet.absoluteFillObject} />
      <View style={compact ? styles.compactContent : styles.content}>
        <View style={styles.topRow}>
          <View style={styles.livePill}><View style={styles.liveDot} /><Text style={styles.liveText}>SEZON {season.number} TRWA</Text></View>
          <Text style={styles.countdown}>{remainingLabel(season.endsAt, now)}</Text>
        </View>
        <View style={styles.bottomRow}>
          <View style={{ flex: 1 }}>
            <Text numberOfLines={1} style={[compact ? styles.compactTitle : styles.title, { color: '#fff' }]}>{season.name}</Text>
            {!compact && <Text numberOfLines={2} style={styles.description}>{season.description || 'Rywalizuj, zdobywaj osiągnięcia i walcz o nagrody.'}</Text>}
            <View style={styles.metaRow}>
              <Text style={styles.meta}>{Number(data.stats?.points || 0).toLocaleString('pl-PL')} PKT</Text>
              <Text style={styles.meta}>{data.rewardCount || 0} NAGRÓD</Text>
              <Text style={styles.meta}>{data.achievementCount || 0} ODZNAK</Text>
            </View>
          </View>
          <View style={[compact ? styles.arrow : styles.detailsButton, { backgroundColor: theme.primary }]}>
            {!compact && <Text style={styles.detailsButtonText}>INFO O SEZONIE</Text>}
            <MaterialCommunityIcons name="arrow-right" size={18} color="#fff" />
          </View>
        </View>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  loading: { height: 174, marginHorizontal: 20, marginBottom: 20, borderWidth: 1, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  card: { height: 190, marginHorizontal: 20, marginBottom: 22, borderWidth: 1, borderRadius: 24, overflow: 'hidden' },
  compactCard: { height: 102, marginHorizontal: 16, marginTop: 10, marginBottom: 8, borderWidth: 1, borderRadius: 17, overflow: 'hidden' },
  content: { flex: 1, padding: 15, justifyContent: 'space-between' },
  compactContent: { flex: 1, padding: 11, justifyContent: 'space-between' },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  livePill: { minHeight: 24, paddingHorizontal: 9, borderRadius: 12, flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'rgba(0,0,0,.72)' },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#4de926' },
  liveText: { color: '#fff', fontFamily: 'Orbitron', fontSize: 6.5, fontWeight: '900', letterSpacing: .7 },
  countdown: { color: '#FFD447', fontFamily: 'Orbitron', fontSize: 7, fontWeight: '900', letterSpacing: .5 },
  bottomRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 12 },
  title: { fontFamily: 'Orbitron', fontSize: 20, fontWeight: '900' },
  compactTitle: { fontFamily: 'Orbitron', fontSize: 13, fontWeight: '900' },
  description: { color: 'rgba(255,255,255,.68)', fontFamily: 'Satoshi', fontSize: 11, lineHeight: 15, marginTop: 5, maxWidth: 520 },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 8 },
  meta: { color: 'rgba(255,255,255,.58)', fontFamily: 'Orbitron', fontSize: 6.5, fontWeight: '800', letterSpacing: .45 },
  arrow: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  detailsButton: { minHeight: 38, paddingHorizontal: 12, borderRadius: 19, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5 },
  detailsButtonText: { color: '#fff', fontFamily: 'Orbitron', fontSize: 6.5, fontWeight: '900', letterSpacing: .55 },
});
