import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect, useRouter } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '../../contexts/ThemeContext';
import {
  fetchAsphaltSummary,
  fetchGamificationStatus,
  fetchPassport,
  fetchPendingGamificationRewards,
  fetchTurfCrowns,
  type AsphaltDistrict,
  type GamificationReward,
} from '../../lib/gamificationClient';
import { ExplorationCoverageMap } from '../../components/profile/ExplorationCoverageMap';

type PassportData = {
  totalStamps: number;
  cityCount: number;
  voivodeshipCount: number;
  stamps: { slug: string; name: string; type: string; firstSeenAt: string }[];
};

type Crown = {
  regionSlug: string;
  regionName: string;
  regionType?: string;
  username: string;
  distanceKm: number;
  year?: number;
  month?: number;
};

function nextMilestone(percent: number): number | null {
  if (percent < 50) return 50;
  if (percent < 75) return 75;
  if (percent < 100) return 100;
  return null;
}

function formatDate(value?: string | null): string {
  if (!value) return '';
  try {
    return new Intl.DateTimeFormat('pl-PL', { day: '2-digit', month: 'short' }).format(new Date(value));
  } catch {
    return '';
  }
}

export default function GamificationScreen() {
  const router = useRouter();
  const { theme, isDark } = useTheme();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [districts, setDistricts] = useState<AsphaltDistrict[]>([]);
  const [passport, setPassport] = useState<PassportData | null>(null);
  const [crowns, setCrowns] = useState<Crown[]>([]);
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
    try {
      const [d, p, c, r, status] = await Promise.all([
        fetchAsphaltSummary(),
        fetchPassport(),
        fetchTurfCrowns(),
        fetchPendingGamificationRewards(),
        fetchGamificationStatus(),
      ]);
      setDistricts(d);
      setPassport(p);
      setCrowns(c);
      setRewards(r);
      setActiveDrops(status?.activeDrops ?? null);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const countryProgress = districts.find((d) => d.slug === 'poland' || d.type === 'country') ?? null;
  const regionRows = districts.filter((d) => d.slug !== 'poland' && d.type !== 'country');
  const averageProgress = Math.round(Number(countryProgress?.percentComplete ?? 0));
  const exploredCells = districts.reduce((sum, d) => sum + Number(d.cellsRevealed ?? 0), 0);
  const averageProgressText = exploredCells > 0 && averageProgress < 1 ? '<1%' : `${averageProgress}%`;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.bg }}>
      <LinearGradient colors={[theme.bg, theme.bgAlt, theme.bg]} style={StyleSheet.absoluteFill} />

      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={[styles.iconButton, { borderColor: colors.border, backgroundColor: colors.card }]}>
          <MaterialCommunityIcons name="arrow-left" size={22} color={theme.text} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={[styles.kicker, { color: theme.primary }]}>VROOM MAPA</Text>
          <Text style={[styles.title, { color: theme.text }]}>Rewiry i Paszport</Text>
        </View>
      </View>

      {loading ? (
        <View style={styles.loading}>
          <ActivityIndicator color={theme.primary} size="large" />
          <Text style={{ color: colors.muted, marginTop: 12 }}>Ladowanie eksploracji...</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor={theme.primary} />}
        >
          <View style={[styles.hero, { borderColor: theme.primaryBorder, backgroundColor: colors.card }]}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.kicker, { color: theme.primary }]}>MAPA ODKRYC</Text>
              <Text style={[styles.heroTitle, { color: theme.text }]}>
                {countryProgress ? `Polska ${averageProgressText}` : 'Mapa czeka'}
              </Text>
              <Text style={[styles.heroText, { color: colors.muted }]}>
                Kafelki odblokowuja sie same podczas jazdy i nawigacji. Na mapie jazdy ich nie pokazujemy.
              </Text>
            </View>
            <View style={[styles.heroBadge, { borderColor: theme.primaryBorder, backgroundColor: theme.primaryBg }]}>
              <Text style={{ color: theme.text, fontWeight: '900', fontSize: 24 }}>{averageProgressText}</Text>
              <Text style={{ color: colors.muted, fontSize: 10, fontWeight: '800' }}>ODKRYTE</Text>
            </View>
          </View>

          <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.sectionHead}>
              <View style={[styles.sectionIcon, { borderColor: theme.primaryBorder, backgroundColor: theme.primaryBg }]}>
                <MaterialCommunityIcons name="map-search-outline" size={20} color={theme.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.sectionTitle, { color: theme.text }]}>Mapa odkrytych kafelkow</Text>
                <Text style={[styles.sectionSubtitle, { color: colors.muted }]}>
                  To tutaj sprawdzasz odkryta mape. Zwykla mapa jazdy zostaje czysta.
                </Text>
              </View>
            </View>
            <ExplorationCoverageMap height={260} limit={1500} interactive autoRefreshMs={15_000} />
          </View>

          <View style={styles.quickGrid}>
            <MetricCard label="Miasta" value={`${passport?.cityCount ?? 0}`} icon="city-variant-outline" />
            <MetricCard label="Regiony" value={`${passport?.voivodeshipCount ?? 0}`} icon="map-marker-radius-outline" />
            <MetricCard label="Strefy" value={`${regionRows.length}`} icon="road-variant" />
            <MetricCard label="Zrzuty" value={activeDrops == null ? '-' : `${activeDrops}`} icon="diamond-stone" />
          </View>

          <Section title="Paszport Motoryzacyjny" icon="passport" subtitle="Pieczatki za odwiedzone miasta i wojewodztwa.">
            {(passport?.stamps ?? []).length === 0 ? (
              <EmptyText text="Jeszcze nie ma pieczatek. Pierwsza prawdziwa jazda doda je automatycznie." />
            ) : (
              (passport?.stamps ?? []).slice(0, 8).map((stamp) => (
                <View key={`${stamp.slug}-${stamp.firstSeenAt}`} style={[styles.row, { borderColor: colors.border }]}>
                  <MaterialCommunityIcons
                    name={stamp.type === 'voivodeship' ? 'map-outline' : 'city-variant-outline'}
                    size={20}
                    color={theme.primary}
                  />
                  <Text style={[styles.rowTitle, { color: theme.text }]}>{stamp.name}</Text>
                  <Text style={[styles.rowMeta, { color: colors.dim }]}>{formatDate(stamp.firstSeenAt)}</Text>
                </View>
              ))
            )}
          </Section>

          <Section title="Mapa odkryc" icon="road-variant" subtitle="Kazdy przejechany kafelek podbija progres miasta, regionu i Polski.">
            {regionRows.length === 0 ? (
              <EmptyText text="Brak odkrytych stref. Wlacz jazde i zacznij odblokowywac mape." />
            ) : (
              regionRows.slice(0, 12).map((district) => {
                const next = nextMilestone(district.percentComplete);
                return (
                  <View key={district.slug} style={[styles.progressCard, { backgroundColor: colors.cardAlt, borderColor: colors.border }]}>
                    <View style={styles.progressHead}>
                      <Text style={[styles.progressTitle, { color: theme.text }]}>{district.name}</Text>
                      <Text style={[styles.progressPct, { color: theme.primary }]}>{district.percentComplete.toFixed(0)}%</Text>
                    </View>
                    <View style={[styles.progressTrack, { backgroundColor: isDark ? '#ffffff14' : '#00000012' }]}>
                      <View style={[styles.progressFill, { width: `${Math.min(100, district.percentComplete)}%`, backgroundColor: theme.primary }]} />
                    </View>
                    <Text style={[styles.progressHint, { color: colors.muted }]}>
                      {next ? `Brakuje ${(next - district.percentComplete).toFixed(0)}% do progu ${next}%` : 'Dzielnica ukonczona'}
                    </Text>
                  </View>
                );
              })
            )}
          </Section>

          <Section title="Wojny o Rewir" icon="crown-outline" subtitle="Miesieczne korony za najwiecej kilometrow w strefie.">
            {crowns.length === 0 ? (
              <EmptyText text="Brak koron. Pierwsze rozstrzygniecie pojawi sie po miesiecznym podsumowaniu." />
            ) : (
              crowns.slice(0, 10).map((crown) => (
                <View key={`${crown.regionSlug}-${crown.username}`} style={[styles.row, { borderColor: colors.border }]}>
                  <MaterialCommunityIcons name="crown-outline" size={20} color={theme.gold} />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.rowTitle, { color: theme.text }]}>{crown.regionName}</Text>
                    <Text style={[styles.rowSub, { color: colors.muted }]}>
                      {crown.username} ma rewir - {Number(crown.distanceKm || 0).toFixed(1)} km
                    </Text>
                  </View>
                </View>
              ))
            )}
          </Section>

          <Section title="Zrzuty" icon="diamond-stone" subtitle="Tymczasowe paczki Nitro widoczne tylko przy jezdzie bez celu.">
            <View style={[styles.dropBox, { borderColor: theme.primaryBorder, backgroundColor: theme.primaryBg }]}>
              <MaterialCommunityIcons name="shield-check-outline" size={22} color={theme.primary} />
              <Text style={[styles.dropText, { color: theme.text }]}>
                Zrzuty nie pokazuja sie podczas aktywnej nawigacji. Zeby odebrac paczke, przejedz przez jej strefe w jezdzie bez celu.
              </Text>
            </View>
            {rewards.length > 0 ? (
              <Text style={[styles.pendingText, { color: colors.muted }]}>Masz {rewards.length} oczekujace nagrody.</Text>
            ) : null}
          </Section>
        </ScrollView>
      )}
    </SafeAreaView>
  );

  function Section({ title, icon, subtitle, children }: {
    title: string;
    icon: keyof typeof MaterialCommunityIcons.glyphMap;
    subtitle: string;
    children: React.ReactNode;
  }) {
    return (
      <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={styles.sectionHead}>
          <View style={[styles.sectionIcon, { borderColor: theme.primaryBorder, backgroundColor: theme.primaryBg }]}>
            <MaterialCommunityIcons name={icon} size={20} color={theme.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.sectionTitle, { color: theme.text }]}>{title}</Text>
            <Text style={[styles.sectionSubtitle, { color: colors.muted }]}>{subtitle}</Text>
          </View>
        </View>
        <View style={{ gap: 10 }}>{children}</View>
      </View>
    );
  }

  function MetricCard({ label, value, icon }: {
    label: string;
    value: string;
    icon: keyof typeof MaterialCommunityIcons.glyphMap;
  }) {
    return (
      <View style={[styles.metricCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <MaterialCommunityIcons name={icon} size={18} color={theme.primary} />
        <Text style={[styles.metricValue, { color: theme.text }]}>{value}</Text>
        <Text style={[styles.metricLabel, { color: colors.muted }]}>{label}</Text>
      </View>
    );
  }

  function EmptyText({ text }: { text: string }) {
    return <Text style={[styles.emptyText, { color: colors.muted }]}>{text}</Text>;
  }
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 18,
    paddingTop: 8,
    paddingBottom: 12,
  },
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  kicker: {
    fontFamily: 'Orbitron',
    fontSize: 10,
    letterSpacing: 3,
    fontWeight: '800',
  },
  title: {
    fontFamily: 'Orbitron',
    fontSize: 23,
    letterSpacing: 1.5,
    fontWeight: '900',
    marginTop: 3,
  },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    padding: 18,
    paddingBottom: 40,
    gap: 14,
  },
  hero: {
    borderWidth: 1,
    borderRadius: 22,
    padding: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  heroTitle: {
    fontFamily: 'Orbitron',
    fontSize: 22,
    fontWeight: '900',
    marginTop: 8,
  },
  heroText: {
    fontSize: 13,
    lineHeight: 19,
    marginTop: 8,
    fontWeight: '600',
  },
  heroBadge: {
    width: 82,
    height: 82,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  metricCard: {
    width: '48%',
    borderWidth: 1,
    borderRadius: 18,
    padding: 14,
    gap: 7,
  },
  metricValue: {
    fontFamily: 'Orbitron',
    fontSize: 22,
    fontWeight: '900',
  },
  metricLabel: {
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  section: {
    borderWidth: 1,
    borderRadius: 22,
    padding: 16,
  },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 14,
  },
  sectionIcon: {
    width: 42,
    height: 42,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionTitle: {
    fontFamily: 'Orbitron',
    fontSize: 15,
    fontWeight: '900',
  },
  sectionSubtitle: {
    fontSize: 12,
    lineHeight: 17,
    marginTop: 3,
    fontWeight: '600',
  },
  row: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  rowTitle: {
    flex: 1,
    fontWeight: '800',
    fontSize: 13,
  },
  rowSub: {
    marginTop: 2,
    fontSize: 11,
    fontWeight: '700',
  },
  rowMeta: {
    fontSize: 10,
    fontWeight: '800',
  },
  progressCard: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 13,
  },
  progressHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 9,
  },
  progressTitle: {
    fontFamily: 'Orbitron',
    fontSize: 13,
    fontWeight: '900',
    flex: 1,
  },
  progressPct: {
    fontFamily: 'Orbitron',
    fontSize: 14,
    fontWeight: '900',
  },
  progressTrack: {
    height: 7,
    borderRadius: 99,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 99,
  },
  progressHint: {
    marginTop: 8,
    fontSize: 11,
    fontWeight: '700',
  },
  dropBox: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  dropText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '700',
  },
  pendingText: {
    fontSize: 12,
    fontWeight: '800',
  },
  emptyText: {
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '700',
  },
});
