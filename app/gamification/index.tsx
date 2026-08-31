import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect, useRouter } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '../../contexts/ThemeContext';
import {
  fetchAsphaltSummary,
  fetchCityTerritories,
  fetchGamificationStatus,
  fetchPassport,
  fetchPendingGamificationRewards,
  type AsphaltDistrict,
  type CityTerritoriesResponse,
  type CityTerritory,
  type GamificationReward,
} from '../../lib/gamificationClient';
import { ExplorationCoverageMap } from '../../components/profile/ExplorationCoverageMap';

type ViewMode = 'cities' | 'regions';

function nextMilestone(percent: number): number | null {
  if (percent < 20) return 20;
  if (percent < 50) return 50;
  if (percent < 75) return 75;
  if (percent < 100) return 100;
  return null;
}

function normalizeSearch(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

export default function GamificationScreen() {
  const router = useRouter();
  const { theme, isDark } = useTheme();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<ViewMode>('cities');
  const [search, setSearch] = useState('');
  const [territories, setTerritories] = useState<CityTerritoriesResponse | null>(null);
  const [regions, setRegions] = useState<AsphaltDistrict[]>([]);
  const [unlockedRegions, setUnlockedRegions] = useState(0);
  const [rewards, setRewards] = useState<GamificationReward[]>([]);
  const [activeDrops, setActiveDrops] = useState<number | null>(null);

  const colors = useMemo(() => ({
    card: isDark ? theme.surface2 : theme.surface,
    cardAlt: isDark ? theme.surface3 : theme.surface2,
    border: theme.border2,
    muted: theme.textMuted,
    dim: theme.textDim,
  }), [isDark, theme]);

  const load = useCallback(async (soft = false) => {
    if (soft) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const [cityData, asphalt, passport, pendingRewards, status] = await Promise.all([
        fetchCityTerritories(), fetchAsphaltSummary(), fetchPassport(), fetchPendingGamificationRewards(), fetchGamificationStatus(),
      ]);
      setTerritories(cityData);
      setRegions(asphalt.filter((row) => row.type === 'voivodeship'));
      setUnlockedRegions(Number(passport?.voivodeshipCount || 0));
      setRewards(pendingRewards);
      setActiveDrops(status?.activeDrops ?? null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Nie udało się pobrać miast.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const cities = useMemo(() => territories?.cities ?? [], [territories]);
  const unlockedCities = cities.filter((city) => city.unlocked).length;
  const ownedCities = cities.filter((city) => city.owner && city.myRank === 1).length;
  const query = normalizeSearch(search);
  const visibleCities = useMemo(() => [...cities]
    .filter((city) => !query || normalizeSearch(`${city.name} ${city.voivodeship?.name || ''}`).includes(query))
    .sort((a, b) => Number(Boolean(b.owner && b.myRank === 1)) - Number(Boolean(a.owner && a.myRank === 1))
      || Number(b.unlocked) - Number(a.unlocked)
      || b.percentComplete - a.percentComplete
      || a.name.localeCompare(b.name, 'pl')), [cities, query]);
  const visibleRegions = useMemo(() => regions
    .filter((region) => !query || normalizeSearch(region.name).includes(query))
    .sort((a, b) => b.percentComplete - a.percentComplete || a.name.localeCompare(b.name, 'pl')), [regions, query]);
  const listData = mode === 'cities' ? visibleCities : visibleRegions;
  const periodLabel = territories
    ? new Intl.DateTimeFormat('pl-PL', { month: 'long', year: 'numeric' }).format(new Date(territories.period.year, territories.period.month - 1, 1))
    : '';

  const header = (
    <View style={{ gap: 14 }}>
      <View style={[styles.hero, { borderColor: theme.primaryBorder, backgroundColor: colors.card }]}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.kicker, { color: theme.primary }]}>MIEJSKIE REWIRY</Text>
          <Text style={[styles.heroTitle, { color: theme.text }]}>{unlockedCities}/50 miast</Text>
          <Text style={[styles.heroText, { color: colors.muted }]}>Miasto odblokowuje się przy 20% kafelków. Rewir zdobywa kierowca z największą liczbą kilometrów w bieżącym miesiącu.</Text>
        </View>
        <View style={[styles.heroBadge, { borderColor: theme.primaryBorder, backgroundColor: theme.primaryBg }]}>
          <MaterialCommunityIcons name="crown-outline" size={24} color={theme.gold} />
          <Text style={[styles.badgeValue, { color: theme.text }]}>{ownedCities}</Text>
          <Text style={[styles.badgeLabel, { color: colors.muted }]}>MOJE</Text>
        </View>
      </View>

      <View style={[styles.mapCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.sectionTitle, { color: theme.text }]}>Mapa odkrytych kafelków</Text>
        <Text style={[styles.sectionSubtitle, { color: colors.muted }]}>Każdy prawdziwy przejazd zwiększa postęp odpowiedniego miasta.</Text>
        <View style={{ marginTop: 12 }}><ExplorationCoverageMap height={240} interactive autoRefreshMs={60_000} /></View>
      </View>

      <View style={styles.quickGrid}>
        <MetricCard label="Miasta" value={`${unlockedCities}/50`} icon="city-variant-outline" />
        <MetricCard label="Moje rewiry" value={`${ownedCities}`} icon="crown-outline" />
        <MetricCard label="Województwa" value={`${unlockedRegions}/16`} icon="map-marker-radius-outline" />
        <MetricCard label="Zrzuty" value={activeDrops == null ? '-' : `${activeDrops}`} icon="diamond-stone" />
      </View>

      <TouchableOpacity onPress={() => router.push('/gamification/drops' as any)} style={[styles.dropHistoryLink, { backgroundColor: colors.card, borderColor: theme.primaryBorder }]}>
        <View style={[styles.dropHistoryIcon, { backgroundColor: theme.primaryBg }]}><MaterialCommunityIcons name="package-variant-closed" size={24} color={theme.primary} /></View>
        <View style={{ flex: 1 }}><Text style={[styles.dropHistoryTitle, { color: theme.text }]}>MOJE ZRZUTY</Text><Text style={[styles.sectionSubtitle, { color: colors.muted }]}>Historia zdobytych zrzutów i otrzymanych nagród</Text></View>
        <MaterialCommunityIcons name="chevron-right" size={23} color={theme.primary} />
      </TouchableOpacity>

      <View style={[styles.segment, { backgroundColor: colors.card, borderColor: colors.border }]}>
        {(['cities', 'regions'] as const).map((value) => (
          <TouchableOpacity key={value} onPress={() => setMode(value)} style={[styles.segmentButton, mode === value && { backgroundColor: theme.primaryBg, borderColor: theme.primaryBorder }]}>
            <Text style={[styles.segmentText, { color: mode === value ? theme.primary : colors.muted }]}>{value === 'cities' ? 'MIASTA' : 'REGIONY'}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={[styles.searchBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <MaterialCommunityIcons name="magnify" size={20} color={colors.muted} />
        <TextInput value={search} onChangeText={setSearch} placeholder={mode === 'cities' ? 'Szukaj miasta lub województwa' : 'Szukaj województwa'} placeholderTextColor={colors.dim} style={[styles.searchInput, { color: theme.text }]} />
        {search ? <TouchableOpacity onPress={() => setSearch('')}><MaterialCommunityIcons name="close-circle" size={19} color={colors.muted} /></TouchableOpacity> : null}
      </View>

      <View style={styles.listHeading}>
        <View>
          <Text style={[styles.sectionTitle, { color: theme.text }]}>{mode === 'cities' ? 'Paszport miast i rewiry' : 'Postęp województw'}</Text>
          <Text style={[styles.sectionSubtitle, { color: colors.muted }]}>{mode === 'cities' ? `Ranking: ${periodLabel}` : 'Województwa nie mają właścicieli'}</Text>
        </View>
        <Text style={[styles.listCount, { color: theme.primary }]}>{listData.length}</Text>
      </View>
    </View>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.bg }}>
      <LinearGradient colors={[theme.bg, theme.bgAlt, theme.bg]} style={StyleSheet.absoluteFill} />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={[styles.iconButton, { borderColor: colors.border, backgroundColor: colors.card }]}><MaterialCommunityIcons name="arrow-left" size={22} color={theme.text} /></TouchableOpacity>
        <View style={{ flex: 1 }}><Text style={[styles.kicker, { color: theme.primary }]}>VROOM MAPA</Text><Text style={[styles.title, { color: theme.text }]}>Miasta i Rewiry</Text></View>
      </View>

      {loading ? (
        <View style={styles.loading}><ActivityIndicator color={theme.primary} size="large" /><Text style={{ color: colors.muted, marginTop: 12 }}>Ładowanie miast...</Text></View>
      ) : (
        <FlatList
          data={listData as (CityTerritory | AsphaltDistrict)[]}
          keyExtractor={(item) => item.slug}
          contentContainerStyle={styles.content}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor={theme.primary} />}
          ListHeaderComponent={header}
          ListHeaderComponentStyle={{ marginBottom: 10 }}
          renderItem={({ item }) => mode === 'cities' ? <CityCard city={item as CityTerritory} /> : <RegionCard region={item as AsphaltDistrict} />}
          ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
          ListEmptyComponent={<Text style={[styles.emptyText, { color: colors.muted }]}>{error || 'Brak wyników.'}</Text>}
          ListFooterComponent={<View style={{ gap: 12, marginTop: 16 }}>{error ? <Text style={[styles.errorText, { color: theme.danger }]}>{error}</Text> : null}<View style={[styles.dropBox, { borderColor: theme.primaryBorder, backgroundColor: theme.primaryBg }]}><MaterialCommunityIcons name="diamond-stone" size={22} color={theme.primary} /><Text style={[styles.dropText, { color: theme.text }]}>Zrzuty pozostają dostępne podczas jazdy bez celu. {rewards.length ? `Masz ${rewards.length} oczekujące nagrody.` : ''}</Text></View><Text style={[styles.attribution, { color: colors.dim }]}>Granice: GUGiK PRG · Siatka: kafelki eksploracji VROOM</Text></View>}
          initialNumToRender={8}
          maxToRenderPerBatch={8}
          windowSize={7}
        />
      )}
    </SafeAreaView>
  );

  function CityCard({ city }: { city: CityTerritory }) {
    const missing = Math.max(0, (territories?.unlockPercent ?? 20) - city.percentComplete);
    return (
      <TouchableOpacity onPress={() => router.push({ pathname: '/gamification/city/[slug]', params: { slug: city.slug } } as any)} style={[styles.cityCard, { backgroundColor: colors.card, borderColor: city.owner && city.myRank === 1 ? theme.gold : colors.border }]}>
        <View style={styles.progressHead}><View style={{ flex: 1 }}><Text style={[styles.cityName, { color: theme.text }]}>{city.name}</Text><Text style={[styles.cityProvince, { color: colors.muted }]}>{city.voivodeship?.name || 'Polska'}</Text></View><Text style={[styles.progressPct, { color: city.unlocked ? theme.primary : colors.muted }]}>{city.percentComplete.toFixed(1)}%</Text></View>
        <View style={[styles.progressTrack, { backgroundColor: isDark ? '#ffffff14' : '#00000012' }]}><View style={[styles.progressFill, { width: `${Math.min(100, city.percentComplete)}%`, backgroundColor: city.unlocked ? theme.primary : colors.muted }]} /></View>
        <View style={styles.cityMetaRow}><MaterialCommunityIcons name={city.unlocked ? 'lock-open-variant-outline' : 'lock-outline'} size={16} color={city.unlocked ? theme.primary : colors.muted} /><Text style={[styles.cityStatus, { color: city.unlocked ? theme.primary : colors.muted }]}>{city.unlocked ? 'MIASTO ODBLOKOWANE' : `BRAKUJE ${missing.toFixed(1)}% DO ODBLOKOWANIA`}</Text></View>
        <View style={[styles.ownerBox, { backgroundColor: colors.cardAlt, borderColor: colors.border }]}><MaterialCommunityIcons name="crown-outline" size={20} color={city.owner ? theme.gold : colors.dim} /><View style={{ flex: 1 }}><Text style={[styles.ownerName, { color: theme.text }]}>{city.owner ? `${city.owner.username} ma rewir` : 'Rewir nieobsadzony'}</Text><Text style={[styles.ownerMeta, { color: colors.muted }]}>{city.owner ? `${city.owner.distanceKm.toFixed(1)} km · ${city.owner.percentComplete.toFixed(1)}% odkryte` : 'Pierwszy kwalifikujący się kierowca może go zdobyć'}</Text></View><MaterialCommunityIcons name="chevron-right" size={20} color={colors.muted} /></View>
        <Text style={[styles.myScore, { color: colors.muted }]}>Ty: {city.myDistanceKm.toFixed(1)} km{city.myRank ? ` · miejsce #${city.myRank}` : city.unlocked ? ' · bez miejsca' : ' · odblokuj 20%, aby wejść do rankingu'}</Text>
      </TouchableOpacity>
    );
  }

  function RegionCard({ region }: { region: AsphaltDistrict }) {
    const next = nextMilestone(region.percentComplete);
    return <View style={[styles.cityCard, { backgroundColor: colors.card, borderColor: colors.border }]}><View style={styles.progressHead}><Text style={[styles.cityName, { color: theme.text }]}>{region.name}</Text><Text style={[styles.progressPct, { color: theme.primary }]}>{region.percentComplete.toFixed(1)}%</Text></View><View style={[styles.progressTrack, { backgroundColor: isDark ? '#ffffff14' : '#00000012' }]}><View style={[styles.progressFill, { width: `${Math.min(100, region.percentComplete)}%`, backgroundColor: theme.primary }]} /></View><Text style={[styles.myScore, { color: colors.muted }]}>{next ? `Brakuje ${(next - region.percentComplete).toFixed(1)}% do progu ${next}%` : 'Województwo ukończone'}</Text></View>;
  }

  function MetricCard({ label, value, icon }: { label: string; value: string; icon: keyof typeof MaterialCommunityIcons.glyphMap }) {
    return <View style={[styles.metricCard, { backgroundColor: colors.card, borderColor: colors.border }]}><MaterialCommunityIcons name={icon} size={18} color={theme.primary} /><Text style={[styles.metricValue, { color: theme.text }]}>{value}</Text><Text style={[styles.metricLabel, { color: colors.muted }]}>{label}</Text></View>;
  }
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 18, paddingTop: 8, paddingBottom: 12 }, iconButton: { width: 44, height: 44, borderRadius: 14, borderWidth: 1, alignItems: 'center', justifyContent: 'center' }, kicker: { fontFamily: 'Orbitron', fontSize: 10, letterSpacing: 3, fontWeight: '800' }, title: { fontFamily: 'Orbitron', fontSize: 23, letterSpacing: 1.5, fontWeight: '900', marginTop: 3 }, loading: { flex: 1, alignItems: 'center', justifyContent: 'center' }, content: { padding: 18, paddingBottom: 40 },
  hero: { borderWidth: 1, borderRadius: 22, padding: 18, flexDirection: 'row', alignItems: 'center', gap: 14 }, heroTitle: { fontFamily: 'Orbitron', fontSize: 22, fontWeight: '900', marginTop: 8 }, heroText: { fontSize: 13, lineHeight: 19, marginTop: 8, fontWeight: '600' }, heroBadge: { width: 82, height: 96, borderRadius: 20, borderWidth: 1, alignItems: 'center', justifyContent: 'center', gap: 2 }, badgeValue: { fontFamily: 'Orbitron', fontSize: 22, fontWeight: '900' }, badgeLabel: { fontSize: 9, fontWeight: '900' }, mapCard: { borderWidth: 1, borderRadius: 22, padding: 16 },
  quickGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 }, metricCard: { width: '48%', borderWidth: 1, borderRadius: 18, padding: 14, gap: 7 }, metricValue: { fontFamily: 'Orbitron', fontSize: 22, fontWeight: '900' }, metricLabel: { fontSize: 11, fontWeight: '800', textTransform: 'uppercase' }, sectionTitle: { fontFamily: 'Orbitron', fontSize: 15, fontWeight: '900' }, sectionSubtitle: { fontSize: 12, lineHeight: 17, marginTop: 3, fontWeight: '600' },
  dropHistoryLink: { borderWidth: 1, borderRadius: 18, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12 }, dropHistoryIcon: { width: 48, height: 48, borderRadius: 15, alignItems: 'center', justifyContent: 'center' }, dropHistoryTitle: { fontFamily: 'Orbitron', fontSize: 12, letterSpacing: 1.2, fontWeight: '900' },
  segment: { borderWidth: 1, borderRadius: 17, padding: 4, flexDirection: 'row', gap: 4 }, segmentButton: { flex: 1, borderWidth: 1, borderColor: 'transparent', borderRadius: 13, paddingVertical: 11, alignItems: 'center' }, segmentText: { fontFamily: 'Orbitron', fontSize: 11, letterSpacing: 1.4, fontWeight: '900' }, searchBox: { borderWidth: 1, borderRadius: 16, paddingHorizontal: 13, minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 9 }, searchInput: { flex: 1, fontSize: 13, fontWeight: '700', paddingVertical: 10 }, listHeading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 3 }, listCount: { fontFamily: 'Orbitron', fontSize: 17, fontWeight: '900' },
  cityCard: { borderWidth: 1, borderRadius: 20, padding: 15 }, progressHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 9 }, cityName: { fontFamily: 'Orbitron', fontSize: 14, fontWeight: '900', flex: 1 }, cityProvince: { fontSize: 11, fontWeight: '700', marginTop: 3 }, progressPct: { fontFamily: 'Orbitron', fontSize: 14, fontWeight: '900' }, progressTrack: { height: 7, borderRadius: 99, overflow: 'hidden' }, progressFill: { height: '100%', borderRadius: 99 }, cityMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 9 }, cityStatus: { fontSize: 9, fontWeight: '900', letterSpacing: 0.5 }, ownerBox: { borderWidth: 1, borderRadius: 15, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12 }, ownerName: { fontSize: 13, fontWeight: '900' }, ownerMeta: { fontSize: 10, fontWeight: '700', marginTop: 3 }, myScore: { fontSize: 10, lineHeight: 15, fontWeight: '700', marginTop: 10 },
  dropBox: { borderWidth: 1, borderRadius: 16, padding: 14, flexDirection: 'row', alignItems: 'flex-start', gap: 10 }, dropText: { flex: 1, fontSize: 12, lineHeight: 18, fontWeight: '700' }, emptyText: { padding: 22, textAlign: 'center', fontSize: 12, lineHeight: 18, fontWeight: '700' }, errorText: { fontSize: 12, fontWeight: '800', textAlign: 'center' }, attribution: { textAlign: 'center', fontSize: 9, lineHeight: 14, fontWeight: '600' },
});
