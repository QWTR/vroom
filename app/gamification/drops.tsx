import React, { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useTheme } from '../../contexts/ThemeContext';
import { fetchGeoDropHistory, type GeoDropHistoryItem } from '../../lib/gamificationClient';

const RARITY = {
  common: { label: 'ZWYKŁY', color: '#A7B0BD' },
  rare: { label: 'RZADKI', color: '#35A7FF' },
  epic: { label: 'EPICKI', color: '#A855F7' },
  legendary: { label: 'LEGENDARNY', color: '#FFD447' },
} as const;

function rewardIcon(type: string): keyof typeof MaterialCommunityIcons.glyphMap {
  if (type === 'nitro') return 'lightning-bolt';
  if (type === 'profile_item') return 'account-star-outline';
  if (type === 'points') return 'star-four-points-outline';
  return 'gift-outline';
}

export default function DropHistoryScreen() {
  const router = useRouter();
  const { theme, isDark } = useTheme();
  const [items, setItems] = useState<GeoDropHistoryItem[]>([]);
  const [total, setTotal] = useState(0);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (reset = true, pageCursor: string | null = null) => {
    if (reset) setLoading(true);
    else setLoadingMore(true);
    setError(null);
    try {
      const page = await fetchGeoDropHistory(reset ? null : pageCursor);
      setItems((current) => reset ? page.items : [...current, ...page.items.filter((item) => !current.some((existing) => existing.id === item.id))]);
      setTotal(page.total);
      setCursor(page.nextCursor);
    } catch {
      setError('Nie udało się pobrać historii zrzutów. Sprawdź połączenie i spróbuj ponownie.');
    } finally {
      setLoading(false);
      setRefreshing(false);
      setLoadingMore(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { void load(true); }, [load]));

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.bg }]}>
      <LinearGradient colors={[theme.bg, theme.bgAlt, theme.bg]} style={StyleSheet.absoluteFill} />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={[styles.back, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <MaterialCommunityIcons name="arrow-left" size={22} color={theme.text} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={[styles.kicker, { color: theme.primary }]}>VROOM ZRZUTY</Text>
          <Text style={[styles.title, { color: theme.text }]}>Moje zrzuty</Text>
        </View>
        <View style={[styles.counter, { borderColor: theme.primaryBorder, backgroundColor: theme.primaryBg }]}>
          <Text style={[styles.counterValue, { color: theme.primary }]}>{total}</Text>
          <Text style={[styles.counterLabel, { color: theme.textMuted }]}>ZDOBYTE</Text>
        </View>
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator size="large" color={theme.primary} /><Text style={{ color: theme.textMuted, marginTop: 12 }}>Ładowanie historii...</Text></View>
      ) : error && items.length === 0 ? (
        <View style={styles.center}>
          <MaterialCommunityIcons name="cloud-alert-outline" size={48} color={theme.danger} />
          <Text style={[styles.emptyTitle, { color: theme.text }]}>Nie udało się wczytać zrzutów</Text>
          <Text style={[styles.emptyText, { color: theme.textMuted }]}>{error}</Text>
          <TouchableOpacity onPress={() => void load(true)} style={[styles.retry, { backgroundColor: theme.primary }]}>
            <Text style={[styles.retryText, { color: theme.onPrimary }]}>SPRÓBUJ PONOWNIE</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={styles.content}
          refreshControl={<RefreshControl refreshing={refreshing} tintColor={theme.primary} onRefresh={() => { setRefreshing(true); void load(true); }} />}
          renderItem={({ item }) => {
            const rarity = RARITY[item.rarity] ?? RARITY.common;
            return (
              <View style={[styles.card, { backgroundColor: isDark ? theme.surface2 : theme.surface, borderColor: `${rarity.color}66` }]}>
                <View style={[styles.icon, { backgroundColor: `${rarity.color}18`, borderColor: `${rarity.color}55` }]}>
                  <MaterialCommunityIcons name={rewardIcon(item.reward.rewardType)} size={28} color={rarity.color} />
                </View>
                <View style={{ flex: 1 }}>
                  <View style={styles.cardTop}>
                    <Text style={[styles.rarity, { color: rarity.color }]}>{rarity.label}</Text>
                    <Text style={[styles.date, { color: theme.textDim }]}>{new Intl.DateTimeFormat('pl-PL', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(item.claimedAt))}</Text>
                  </View>
                  <Text style={[styles.reward, { color: theme.text }]}>{item.reward.label}</Text>
                  <Text style={[styles.meta, { color: theme.textMuted }]}>{item.region?.name || 'Trasa VROOM'} · zrzut #{item.dropId}</Text>
                </View>
              </View>
            );
          }}
          ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
          ListEmptyComponent={<View style={styles.center}><MaterialCommunityIcons name="package-variant-closed" size={48} color={theme.textDim} /><Text style={[styles.emptyTitle, { color: theme.text }]}>Jeszcze nie masz zrzutów</Text><Text style={[styles.emptyText, { color: theme.textMuted }]}>Zdobyte nagrody pojawią się tutaj na stałe.</Text></View>}
          ListFooterComponent={cursor ? <TouchableOpacity disabled={loadingMore} onPress={() => void load(false, cursor)} style={[styles.more, { borderColor: theme.border, backgroundColor: theme.surface }]}>{loadingMore ? <ActivityIndicator color={theme.primary} /> : <Text style={[styles.moreText, { color: theme.text }]}>POKAŻ STARSZE</Text>}</TouchableOpacity> : <View style={{ height: 20 }} />}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 18, paddingTop: 8, paddingBottom: 14 },
  back: { width: 44, height: 44, borderRadius: 14, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  kicker: { fontFamily: 'Orbitron', fontSize: 9, letterSpacing: 2.5, fontWeight: '900' },
  title: { fontFamily: 'Orbitron', fontSize: 22, fontWeight: '900', marginTop: 3 },
  counter: { minWidth: 70, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 14, borderWidth: 1, alignItems: 'center' },
  counterValue: { fontFamily: 'Orbitron', fontSize: 17, fontWeight: '900' },
  counterLabel: { fontSize: 8, fontWeight: '900', marginTop: 2 },
  content: { padding: 18, paddingBottom: 40, flexGrow: 1 },
  card: { borderWidth: 1, borderRadius: 19, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 13 },
  icon: { width: 54, height: 54, borderRadius: 17, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  rarity: { fontFamily: 'Orbitron', fontSize: 9, letterSpacing: 1.2, fontWeight: '900' },
  date: { fontSize: 9, fontWeight: '700' },
  reward: { fontSize: 15, fontWeight: '900', marginTop: 6 },
  meta: { fontSize: 10, fontWeight: '700', marginTop: 5 },
  center: { flex: 1, minHeight: 300, alignItems: 'center', justifyContent: 'center', padding: 24 },
  emptyTitle: { fontFamily: 'Orbitron', fontSize: 15, fontWeight: '900', marginTop: 14 },
  emptyText: { fontSize: 12, lineHeight: 18, marginTop: 7, textAlign: 'center' },
  retry: { minHeight: 46, borderRadius: 14, paddingHorizontal: 22, alignItems: 'center', justifyContent: 'center', marginTop: 18 },
  retryText: { fontFamily: 'Orbitron', fontSize: 10, letterSpacing: 1.1, fontWeight: '900' },
  more: { minHeight: 48, borderWidth: 1, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginTop: 16 },
  moreText: { fontFamily: 'Orbitron', fontSize: 10, letterSpacing: 1.2, fontWeight: '900' },
});
