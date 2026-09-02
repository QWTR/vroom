import React, { useCallback, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { AppText as Text } from '../../../components/ui/AppText';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useTheme } from '../../../contexts/ThemeContext';
import { fetchCityTerritoryDetail, type CityTerritoryDetail } from '../../../lib/gamificationClient';

export default function CityTerritoryDetailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ slug: string }>();
  const slug = Array.isArray(params.slug) ? params.slug[0] : params.slug;
  const { theme, isDark } = useTheme();
  const [detail, setDetail] = useState<CityTerritoryDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const card = isDark ? theme.surface2 : theme.surface;
  const cardAlt = isDark ? theme.surface3 : theme.surface2;

  const load = useCallback(async (soft = false) => {
    if (!slug) return;
    if (soft) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try { setDetail(await fetchCityTerritoryDetail(slug)); }
    catch (loadError) { setError(loadError instanceof Error ? loadError.message : 'Nie udało się pobrać rankingu.'); }
    finally { setLoading(false); setRefreshing(false); }
  }, [slug]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  if (loading) return <SafeAreaView style={[styles.safe, { backgroundColor: theme.bg }]}><View style={styles.loading}><ActivityIndicator color={theme.primary} size="large" /></View></SafeAreaView>;

  const city = detail?.city;
  const missing = Math.max(0, (detail?.unlockPercent ?? 20) - Number(city?.percentComplete || 0));
  const period = detail ? new Intl.DateTimeFormat('pl-PL', { month: 'long', year: 'numeric' }).format(new Date(detail.period.year, detail.period.month - 1, 1)) : '';

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.bg }]}>
      <LinearGradient colors={[theme.bg, theme.bgAlt, theme.bg]} style={StyleSheet.absoluteFill} />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={[styles.back, { borderColor: theme.border2, backgroundColor: card }]}><MaterialCommunityIcons name="arrow-left" size={22} color={theme.text} /></TouchableOpacity>
        <View style={{ flex: 1 }}><Text style={[styles.kicker, { color: theme.primary }]}>REWIR MIASTA</Text><Text style={[styles.title, { color: theme.text }]} numberOfLines={1}>{city?.name || 'Miasto'}</Text></View>
      </View>
      <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor={theme.primary} />}>
        {error ? <Text style={[styles.error, { color: theme.danger }]}>{error}</Text> : null}
        {city ? (
          <>
            <View style={[styles.hero, { backgroundColor: card, borderColor: city.unlocked ? theme.primaryBorder : theme.border2 }]}>
              <View style={styles.heroHead}><View><Text style={[styles.province, { color: theme.textMuted }]}>{city.voivodeship?.name || 'Polska'}</Text><Text style={[styles.percent, { color: city.unlocked ? theme.primary : theme.textMuted }]}>{city.percentComplete.toFixed(1)}%</Text></View><MaterialCommunityIcons name={city.unlocked ? 'lock-open-variant-outline' : 'lock-outline'} size={30} color={city.unlocked ? theme.primary : theme.textMuted} /></View>
              <View style={[styles.track, { backgroundColor: isDark ? '#ffffff14' : '#00000012' }]}><View style={[styles.fill, { width: `${Math.min(100, city.percentComplete)}%`, backgroundColor: city.unlocked ? theme.primary : theme.textMuted }]} /></View>
              <Text style={[styles.hint, { color: theme.textMuted }]}>{city.unlocked ? `Miasto odblokowane · ${city.cellsRevealed}/${city.totalCells} kafelków` : `Brakuje ${missing.toFixed(1)}% do wejścia do rankingu`}</Text>
            </View>

            <View style={[styles.owner, { backgroundColor: card, borderColor: city.owner ? theme.gold : theme.border2 }]}><MaterialCommunityIcons name="crown" size={28} color={city.owner ? theme.gold : theme.textDim} /><View style={{ flex: 1 }}><Text style={[styles.sectionTitle, { color: theme.text }]}>{city.owner ? city.owner.username : 'Rewir nieobsadzony'}</Text><Text style={[styles.rowMeta, { color: theme.textMuted }]}>{city.owner ? `${city.owner.distanceKm.toFixed(1)} km · ${city.owner.percentComplete.toFixed(1)}% miasta` : 'Brak kwalifikującego się kierowcy w tym miesiącu'}</Text></View></View>

            <View style={[styles.myBox, { backgroundColor: theme.primaryBg, borderColor: theme.primaryBorder }]}><Text style={[styles.myLabel, { color: theme.primary }]}>TWÓJ WYNIK · {period.toUpperCase()}</Text><Text style={[styles.myValue, { color: theme.text }]}>{city.myDistanceKm.toFixed(1)} km{city.myRank ? ` · #${city.myRank}` : ''}</Text><Text style={[styles.rowMeta, { color: theme.textMuted }]}>{city.unlocked ? 'Kilometry liczą się w walce o rewir.' : 'Kilometry zapisujemy, ale kwalifikacja zacznie się po odkryciu 20% miasta.'}</Text></View>

            <Section title="Ranking miesiąca" icon="podium" empty="Nikt jeszcze nie zakwalifikował się do rankingu." rows={(detail?.leaderboard || []).map((row) => ({ key: String(row.userId), title: `#${row.rank}  ${row.username}`, meta: `${row.distanceKm.toFixed(1)} km · ${row.percentComplete.toFixed(1)}% odkryte` }))} />
            <Section title="Historia zwycięzców" icon="history" empty="Historia pojawi się po pierwszym zamkniętym miesiącu." rows={(detail?.history || []).map((row) => ({ key: `${row.year}-${row.month}`, title: row.username, meta: `${String(row.month).padStart(2, '0')}/${row.year} · ${row.distanceKm.toFixed(1)} km · ${row.percentComplete.toFixed(1)}%` }))} />
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );

  function Section({ title, icon, empty, rows }: { title: string; icon: keyof typeof MaterialCommunityIcons.glyphMap; empty: string; rows: { key: string; title: string; meta: string }[] }) {
    return <View style={[styles.section, { backgroundColor: card, borderColor: theme.border2 }]}><View style={styles.sectionHead}><MaterialCommunityIcons name={icon} size={21} color={theme.primary} /><Text style={[styles.sectionTitle, { color: theme.text }]}>{title}</Text></View>{rows.length ? rows.map((row) => <View key={row.key} style={[styles.row, { backgroundColor: cardAlt, borderColor: theme.border2 }]}><Text style={[styles.rowTitle, { color: theme.text }]}>{row.title}</Text><Text style={[styles.rowMeta, { color: theme.textMuted }]}>{row.meta}</Text></View>) : <Text style={[styles.empty, { color: theme.textMuted }]}>{empty}</Text>}</View>;
  }
}

const styles = StyleSheet.create({
  safe: { flex: 1 }, loading: { flex: 1, alignItems: 'center', justifyContent: 'center' }, header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 18, paddingVertical: 10 }, back: { width: 44, height: 44, borderRadius: 14, borderWidth: 1, alignItems: 'center', justifyContent: 'center' }, kicker: { fontFamily: 'Manrope_600SemiBold', fontSize: 12, letterSpacing: 1, fontWeight: '900' }, title: { fontFamily: 'Manrope_600SemiBold', fontSize: 21, fontWeight: '900', marginTop: 3 }, content: { padding: 18, paddingBottom: 40, gap: 13 }, error: { textAlign: 'center', fontSize: 12, fontWeight: '800' }, hero: { borderWidth: 1, borderRadius: 22, padding: 18 }, heroHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }, province: { fontSize: 12, fontWeight: '700' }, percent: { fontFamily: 'Manrope_600SemiBold', fontSize: 28, fontWeight: '900', marginTop: 5 }, track: { height: 8, borderRadius: 99, overflow: 'hidden' }, fill: { height: '100%', borderRadius: 99 }, hint: { fontSize: 12, lineHeight: 16, fontWeight: '700', marginTop: 10 }, owner: { borderWidth: 1, borderRadius: 20, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 12 }, myBox: { borderWidth: 1, borderRadius: 20, padding: 16 }, myLabel: { fontFamily: 'Manrope_600SemiBold', fontSize: 12, letterSpacing: 1, fontWeight: '900' }, myValue: { fontFamily: 'Manrope_600SemiBold', fontSize: 21, fontWeight: '900', marginVertical: 7 }, section: { borderWidth: 1, borderRadius: 20, padding: 15, gap: 9 }, sectionHead: { flexDirection: 'row', alignItems: 'center', gap: 9, marginBottom: 2 }, sectionTitle: { fontFamily: 'Manrope_600SemiBold', fontSize: 14, fontWeight: '900' }, row: { borderWidth: 1, borderRadius: 14, padding: 12 }, rowTitle: { fontSize: 13, fontWeight: '900' }, rowMeta: { fontSize: 12, lineHeight: 16, fontWeight: '700', marginTop: 3 }, empty: { fontSize: 12, lineHeight: 17, fontWeight: '700' },
});
