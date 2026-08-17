import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect, useRouter } from 'expo-router';
import { API_URL } from '../../constants/config';
import { useTheme } from '../../contexts/ThemeContext';
import { withAlpha } from '../../constants/theme';
import { useScreenHeaderTop } from '../../lib/screenHeaderInsets';

type SeasonDetails = {
  season: { id: string; number: number; name: string; description?: string | null; imageUrl?: string | null; rules?: unknown; startsAt: string; endsAt: string } | null;
  stats: Record<string, number> | null;
  rewards: Array<{ id: string; placeFrom: number; placeTo: number; type: string; name: string; description?: string | null; amount?: number | null }>;
  achievements: Array<{ id: string; icon: string; label: string; description?: string; rarity: string; currentValue: number; conditionValue: number; progress: number; unlocked: boolean; active: boolean }>;
};

const mediaUrl = (value?: string | null) => !value ? null : /^https?:\/\//i.test(value) ? value : `${API_URL}/${value.replace(/^\//, '')}`;
const rewardIcon = (type: string) => ({ nitro: 'lightning-bolt', premium_days: 'crown', inventory_item: 'treasure-chest', shop_product: 'package-variant', achievement: 'medal', manual: 'gift' }[type] || 'gift');
const rewardMeta = (reward: SeasonDetails['rewards'][number]) => reward.type === 'nitro' ? `${reward.amount || 0} Nitro` : reward.type === 'premium_days' ? `${reward.amount || 0} dni Premium` : reward.type === 'achievement' ? 'Odznaka sezonowa' : reward.type === 'shop_product' ? 'Nagroda fizyczna' : reward.type === 'inventory_item' ? 'Przedmiot do ekwipunku' : 'Nagroda specjalna';

function countdown(end: string, now: number) {
  const milliseconds = Math.max(0, new Date(end).getTime() - now);
  const days = Math.floor(milliseconds / 86_400_000);
  const hours = Math.floor((milliseconds % 86_400_000) / 3_600_000);
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000);
  return milliseconds <= 0 ? 'Finalizacja sezonu' : `${days} dni · ${hours} godz. · ${minutes} min`;
}

function rulesText(value: unknown) {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && 'text' in value) return String((value as { text?: unknown }).text || '');
  return '';
}

export default function CurrentSeasonScreen() {
  const router = useRouter();
  const { theme } = useTheme();
  const headerTop = useScreenHeaderTop(8);
  const [data, setData] = useState<SeasonDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [now, setNow] = useState(Date.now());

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError('');
    try {
      const token = (await AsyncStorage.getItem('userToken')) ?? (await AsyncStorage.getItem('token'));
      const response = await fetch(`${API_URL}/api/seasons/current`, { headers: token ? { Authorization: `Bearer ${token}` } : undefined });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || `HTTP ${response.status}`);
      setData(payload);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Nie udało się pobrać sezonu');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { void load(); }, [load]));
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 60_000); return () => clearInterval(timer); }, []);

  const season = data?.season;
  const rules = useMemo(() => rulesText(season?.rules), [season?.rules]);
  const image = mediaUrl(season?.imageUrl);
  const stats = data?.stats;

  if (loading && !data) return <View style={[styles.center, { backgroundColor: theme.bg }]}><ActivityIndicator color={theme.primary} /><Text style={[styles.loadingText, { color: theme.textDim }]}>ŁADOWANIE SEZONU</Text></View>;

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <View style={[styles.header, { paddingTop: headerTop, borderBottomColor: theme.border, backgroundColor: theme.bg }]}>
        <TouchableOpacity onPress={() => router.back()} style={[styles.back, { backgroundColor: theme.surface, borderColor: theme.border }]}><MaterialCommunityIcons name="arrow-left" size={21} color={theme.text} /></TouchableOpacity>
        <View style={{ flex: 1 }}><Text style={[styles.headerTitle, { color: theme.text }]}>SEZON VROOM</Text><Text style={[styles.headerSub, { color: theme.textDim }]}>SZCZEGÓŁY RYWALIZACJI</Text></View>
      </View>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(true); }} tintColor={theme.primary} />}
      >
        {error ? <View style={[styles.notice, { borderColor: theme.primary }]}><Text style={{ color: theme.primary }}>{error}</Text></View> : null}
        {!season ? <View style={styles.empty}><MaterialCommunityIcons name="calendar-blank-outline" size={48} color={theme.textDim} /><Text style={[styles.emptyTitle, { color: theme.text }]}>OBECNIE NIE TRWA SEZON</Text><Text style={[styles.body, { color: theme.textDim }]}>Informacja o kolejnym sezonie pojawi się tutaj po jego uruchomieniu.</Text></View> : <>
          <View style={[styles.hero, { borderColor: withAlpha(theme.primary, '66'), backgroundColor: theme.surface }]}>
            {image ? <Image source={{ uri: image }} style={StyleSheet.absoluteFillObject} contentFit="cover" transition={220} cachePolicy="memory-disk" /> : <LinearGradient colors={[withAlpha(theme.primary, '55'), theme.surface, '#080808']} style={StyleSheet.absoluteFillObject} />}
            <LinearGradient colors={['rgba(0,0,0,.02)', 'rgba(0,0,0,.42)', 'rgba(0,0,0,.96)']} style={StyleSheet.absoluteFillObject} />
            <View style={styles.heroContent}>
              <View style={styles.live}><View style={styles.liveDot} /><Text style={styles.liveText}>SEZON {season.number} · AKTYWNY</Text></View>
              <View><Text style={styles.heroTitle}>{season.name}</Text><Text style={styles.heroCountdown}><MaterialCommunityIcons name="timer-sand" size={14} /> {countdown(season.endsAt, now)}</Text></View>
            </View>
          </View>

          <View style={styles.actionRow}>
            <TouchableOpacity onPress={() => router.push({ pathname: '/Community/Ranks/stats', params: { rankPeriod: 'season', rankCategory: 'points' } } as any)} style={[styles.primaryAction, { backgroundColor: theme.primary }]}><MaterialCommunityIcons name="trophy" size={17} color="#fff" /><Text style={styles.primaryActionText}>RANKING</Text></TouchableOpacity>
            <TouchableOpacity onPress={() => router.push('/profile/seasons' as any)} style={[styles.secondaryAction, { borderColor: theme.border, backgroundColor: theme.surface }]}><MaterialCommunityIcons name="chart-timeline-variant" size={17} color={theme.primary} /><Text style={[styles.secondaryActionText, { color: theme.text }]}>MOJE STATYSTYKI</Text></TouchableOpacity>
          </View>

          <Section title="O SEZONIE" theme={theme}><Text style={[styles.body, { color: theme.textMuted }]}>{season.description || 'Rywalizuj z kierowcami VROOM, zdobywaj punkty i walcz o nagrody.'}</Text><Text style={[styles.date, { color: theme.textDim }]}>{new Date(season.startsAt).toLocaleString('pl-PL')} — {new Date(season.endsAt).toLocaleString('pl-PL')}</Text></Section>

          <Section title="TWÓJ WYNIK" theme={theme}>
            <View style={styles.statsGrid}>{[
              ['PUNKTY', Number(stats?.points || 0).toLocaleString('pl-PL'), 'star-circle'],
              ['KILOMETRY', Number(stats?.distanceKm || 0).toFixed(1), 'map-marker-distance'],
              ['PRZEJAZDY', Number(stats?.ridesCount || 0), 'car-sports'],
              ['ODZNAKI', Number(stats?.achievementsUnlocked || 0), 'medal'],
            ].map(([label, value, icon]) => <View key={String(label)} style={[styles.stat, { borderColor: theme.border, backgroundColor: theme.bg }]}><MaterialCommunityIcons name={icon as any} size={18} color={theme.primary} /><Text style={[styles.statValue, { color: theme.text }]}>{String(value)}</Text><Text style={[styles.statLabel, { color: theme.textDim }]}>{label}</Text></View>)}</View>
          </Section>

          <Section title={`NAGRODY · ${data?.rewards?.length || 0}`} theme={theme}>
            {data?.rewards?.length ? data.rewards.map((reward) => <View key={reward.id} style={[styles.listRow, { borderColor: theme.border, backgroundColor: theme.bg }]}><View style={[styles.place, { backgroundColor: withAlpha('#FFD447', '16') }]}><Text style={styles.placeText}>#{reward.placeFrom}{reward.placeTo !== reward.placeFrom ? `–${reward.placeTo}` : ''}</Text></View><MaterialCommunityIcons name={rewardIcon(reward.type) as any} size={21} color="#FFD447" /><View style={{ flex: 1 }}><Text style={[styles.rowTitle, { color: theme.text }]}>{reward.name}</Text><Text style={[styles.rowMeta, { color: theme.textDim }]}>{rewardMeta(reward)}</Text></View></View>) : <Text style={[styles.body, { color: theme.textDim }]}>Nagrody nie zostały jeszcze opublikowane.</Text>}
          </Section>

          <Section title={`OSIĄGNIĘCIA · ${data?.achievements?.length || 0}`} theme={theme}>
            {data?.achievements?.length ? data.achievements.map((achievement) => <View key={achievement.id} style={[styles.achievement, { borderColor: achievement.unlocked ? withAlpha(theme.primary, '77') : theme.border, backgroundColor: theme.bg }]}><Text style={styles.achievementIcon}>{achievement.icon || '🏆'}</Text><View style={{ flex: 1 }}><View style={styles.achievementHead}><Text style={[styles.rowTitle, { color: theme.text }]}>{achievement.label}</Text><Text style={[styles.rarity, { color: achievement.unlocked ? '#4de926' : theme.textDim }]}>{achievement.unlocked ? 'ZDOBYTE' : achievement.rarity.toUpperCase()}</Text></View><Text numberOfLines={2} style={[styles.rowMeta, { color: theme.textDim }]}>{achievement.description}</Text><View style={[styles.progressTrack, { backgroundColor: theme.border }]}><View style={[styles.progressFill, { width: `${Math.max(0, Math.min(100, achievement.progress || 0))}%`, backgroundColor: achievement.unlocked ? '#4de926' : theme.primary }]} /></View><Text style={[styles.progressText, { color: theme.textDim }]}>{achievement.currentValue} / {achievement.conditionValue}</Text></View></View>) : <Text style={[styles.body, { color: theme.textDim }]}>Brak osiągnięć w tym sezonie.</Text>}
          </Section>

          {rules ? <Section title="ZASADY RYWALIZACJI" theme={theme}><Text style={[styles.rules, { color: theme.textMuted }]}>{rules}</Text></Section> : null}
        </>}
      </ScrollView>
    </View>
  );
}

function Section({ title, theme, children }: { title: string; theme: any; children: React.ReactNode }) {
  return <View style={[styles.section, { borderColor: theme.border, backgroundColor: theme.surface }]}><Text style={[styles.sectionTitle, { color: theme.primary }]}>{title}</Text>{children}</View>;
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  loadingText: { fontFamily: 'Orbitron', fontSize: 8, letterSpacing: 1.4 },
  header: { minHeight: 70, paddingHorizontal: 16, paddingBottom: 11, borderBottomWidth: 1, flexDirection: 'row', alignItems: 'center', gap: 12 },
  back: { width: 40, height: 40, borderWidth: 1, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontFamily: 'Orbitron', fontSize: 14, fontWeight: '900', letterSpacing: 1 },
  headerSub: { fontFamily: 'Orbitron', fontSize: 6.5, letterSpacing: 1.3, marginTop: 3 },
  content: { padding: 16, paddingBottom: 60, gap: 12 },
  notice: { padding: 12, borderWidth: 1, borderRadius: 12 },
  empty: { minHeight: 420, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 30 },
  emptyTitle: { fontFamily: 'Orbitron', fontSize: 12, fontWeight: '900', textAlign: 'center' },
  hero: { height: 245, borderWidth: 1, borderRadius: 24, overflow: 'hidden' },
  heroContent: { flex: 1, padding: 16, justifyContent: 'space-between' },
  live: { alignSelf: 'flex-start', minHeight: 27, paddingHorizontal: 10, borderRadius: 14, backgroundColor: 'rgba(0,0,0,.7)', flexDirection: 'row', alignItems: 'center', gap: 6 },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#4de926' },
  liveText: { color: '#fff', fontFamily: 'Orbitron', fontSize: 7, fontWeight: '900', letterSpacing: .7 },
  heroTitle: { color: '#fff', fontFamily: 'Orbitron', fontSize: 25, lineHeight: 30, fontWeight: '900' },
  heroCountdown: { color: '#FFD447', fontFamily: 'Orbitron', fontSize: 9, fontWeight: '800', marginTop: 8 },
  actionRow: { flexDirection: 'row', gap: 8 },
  primaryAction: { flex: 1, minHeight: 46, borderRadius: 13, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  primaryActionText: { color: '#fff', fontFamily: 'Orbitron', fontSize: 8, fontWeight: '900', letterSpacing: .6 },
  secondaryAction: { flex: 1.25, minHeight: 46, borderWidth: 1, borderRadius: 13, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  secondaryActionText: { fontFamily: 'Orbitron', fontSize: 7.5, fontWeight: '900', letterSpacing: .4 },
  section: { padding: 15, borderWidth: 1, borderRadius: 18, gap: 10 },
  sectionTitle: { fontFamily: 'Orbitron', fontSize: 8, fontWeight: '900', letterSpacing: 1.4 },
  body: { fontFamily: 'Satoshi', fontSize: 12, lineHeight: 18 },
  date: { fontFamily: 'Satoshi', fontSize: 10 },
  rules: { fontFamily: 'Satoshi', fontSize: 12, lineHeight: 19 },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  stat: { width: '48.5%', minHeight: 87, borderWidth: 1, borderRadius: 14, padding: 11, justifyContent: 'space-between' },
  statValue: { fontFamily: 'Orbitron', fontSize: 15, fontWeight: '900' },
  statLabel: { fontFamily: 'Orbitron', fontSize: 6.5, fontWeight: '800', letterSpacing: .5 },
  listRow: { minHeight: 68, padding: 9, borderWidth: 1, borderRadius: 13, flexDirection: 'row', alignItems: 'center', gap: 9 },
  place: { minWidth: 44, height: 42, paddingHorizontal: 6, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  placeText: { color: '#FFD447', fontFamily: 'Orbitron', fontSize: 8, fontWeight: '900' },
  rowTitle: { fontFamily: 'Orbitron', fontSize: 9.5, fontWeight: '900' },
  rowMeta: { fontFamily: 'Satoshi', fontSize: 10, marginTop: 3 },
  achievement: { padding: 10, borderWidth: 1, borderRadius: 13, flexDirection: 'row', gap: 10 },
  achievementIcon: { fontSize: 27 },
  achievementHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  rarity: { fontFamily: 'Orbitron', fontSize: 6, fontWeight: '900' },
  progressTrack: { height: 4, borderRadius: 2, overflow: 'hidden', marginTop: 8 },
  progressFill: { height: 4, borderRadius: 2 },
  progressText: { fontFamily: 'Orbitron', fontSize: 6.5, marginTop: 4, textAlign: 'right' },
});
