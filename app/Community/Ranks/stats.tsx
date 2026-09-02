import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, TouchableOpacity, View, type ListRenderItem } from 'react-native';
import { AppText as Text } from '../../../components/ui/AppText';
import { LinearGradient } from 'expo-linear-gradient';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { API_URL } from '../../../constants/config';
import { useTheme } from '../../../contexts/ThemeContext';
import {
  CommunityScreenHeader,
  CommunitySegmentTabs,
  RankingListRow,
  RankingPodium,
  RankingPodiumSkeleton,
  type RankingUser,
} from '../../../components/community';

type RankCategory = 'points' | 'distance' | 'referrals';
type RankPeriod = 'season' | 'day' | 'week' | 'month' | 'all';

interface SeasonReward { id: string; placeFrom: number; placeTo: number; type: string; name: string; imageUrl?: string | null; amount?: number | null }
interface ActiveSeason { id: string; number: number; name: string; description?: string | null; imageUrl?: string | null; startsAt: string; endsAt: string; status: string }

interface ReferralCompetition {
  id: number;
  title: string;
  prizeDescription: string;
  winnerPlaces: number;
  endsAt: string;
  status: 'scheduled' | 'active' | 'ended' | 'archived';
  winners?: {
    userId: number;
    username: string;
    avatar: string | null;
    invitedCount: number;
    position: number;
  }[];
  winnersUntil?: string;
  finalizedAt?: string;
}

interface RankingRange {
  period: RankPeriod;
  startsAt: string | null;
  endsAt: string | null;
  timeZone: string;
}

const PERIODS: { key: RankPeriod; label: string }[] = [
  { key: 'season', label: 'SEZON' },
  { key: 'day', label: 'DZIŚ' },
  { key: 'week', label: 'TYDZIEŃ' },
  { key: 'month', label: 'MIESIĄC' },
  { key: 'all', label: 'WSZYSTKO' },
];

const PERIOD_ALIASES: Record<string, RankPeriod> = {
  day: 'day',
  dzis: 'day',
  dziś: 'day',
  week: 'week',
  tydzien: 'week',
  tydzień: 'week',
  month: 'month',
  miesiac: 'month',
  miesiąc: 'month',
  all: 'all',
  wszystko: 'all',
  season: 'season',
  sezon: 'season',
};

function normalizePeriod(raw?: string): RankPeriod | null {
  if (!raw) return null;
  return PERIOD_ALIASES[String(raw).trim().toLowerCase()] ?? null;
}

function formatCountdown(endsAt: string): string {
  const diff = new Date(endsAt).getTime() - Date.now();
  if (diff <= 0) return 'Koniec konkursu';
  const days = Math.floor(diff / (24 * 60 * 60 * 1000));
  const hours = Math.floor((diff % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
  const mins = Math.floor((diff % (60 * 60 * 1000)) / (60 * 1000));
  if (days > 0) return `Zostało ${days} d ${hours} godz.`;
  if (hours > 0) return `Zostało ${hours} godz. ${mins} min`;
  return `Zostało ${mins} min`;
}

function formatRangeLabel(period: RankPeriod, range: RankingRange | null): string {
  if (period === 'season') return 'BIEŻĄCY SEZON';
  if (period === 'all') return 'RANKING OGÓLNY';
  if (!range?.startsAt || !range.endsAt) {
    return period === 'day' ? 'DZISIAJ' : period === 'week' ? 'TEN TYDZIEŃ' : 'TEN MIESIĄC';
  }
  const timeZone = range.timeZone || 'Europe/Warsaw';
  const start = new Date(range.startsAt);
  const inclusiveEnd = new Date(new Date(range.endsAt).getTime() - 1);
  if (period === 'day') {
    return `DZISIAJ · ${new Intl.DateTimeFormat('pl-PL', { day: 'numeric', month: 'long', timeZone }).format(start).toUpperCase()}`;
  }
  if (period === 'month') {
    return new Intl.DateTimeFormat('pl-PL', { month: 'long', year: 'numeric', timeZone }).format(start).toUpperCase();
  }
  const sameMonth = new Intl.DateTimeFormat('pl-PL', { month: 'numeric', timeZone }).format(start)
    === new Intl.DateTimeFormat('pl-PL', { month: 'numeric', timeZone }).format(inclusiveEnd);
  const startLabel = new Intl.DateTimeFormat('pl-PL', {
    day: 'numeric',
    ...(sameMonth ? {} : { month: 'short' as const }),
    timeZone,
  }).format(start);
  const endLabel = new Intl.DateTimeFormat('pl-PL', { day: 'numeric', month: 'long', timeZone }).format(inclusiveEnd);
  return `${startLabel}–${endLabel}`.toUpperCase();
}

function CompetitionBanner({
  competition,
  theme,
}: {
  competition: ReferralCompetition;
  theme: ReturnType<typeof useTheme>['theme'];
}) {
  const isEnded = competition.status === 'ended';
  return (
    <View style={[styles.competitionBanner, { backgroundColor: '#e3383512', borderColor: '#e3383540' }]}>
      <View style={styles.competitionHeader}>
        <MaterialCommunityIcons name="trophy" size={18} color="#FFD700" />
        <Text style={[styles.competitionTitle, { color: theme.text }]} numberOfLines={2}>
          {competition.title}
        </Text>
      </View>
      <Text style={[styles.competitionPrize, { color: theme.primary }]} numberOfLines={3}>
        🎁 {competition.prizeDescription}
      </Text>
      <Text style={[styles.competitionMeta, { color: theme.textDim }]}>
        {isEnded
          ? `Zwycięzcy ogłoszeni — Top ${competition.winnerPlaces}`
          : `Top ${competition.winnerPlaces} wygrywa · ${formatCountdown(competition.endsAt)}`}
      </Text>
    </View>
  );
}

export default function StatsScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ rankPeriod?: string; rankCategory?: string }>();
  const { theme } = useTheme();

  const [category, setCategory] = useState<RankCategory>('points');
  const [period, setPeriod] = useState<RankPeriod>('all');
  const [users, setUsers] = useState<RankingUser[]>([]);
  const [myPosition, setMyPosition] = useState<number | null>(null);
  const [range, setRange] = useState<RankingRange | null>(null);
  const [competition, setCompetition] = useState<ReferralCompetition | null>(null);
  const [season, setSeason] = useState<ActiveSeason | null>(null);
  const [seasonRewards, setSeasonRewards] = useState<SeasonReward[]>([]);
  const [myId, setMyId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    AsyncStorage.getItem('user').then((raw) => {
      if (!raw) return;
      try {
        const u = JSON.parse(raw);
        setMyId(u.userId ?? u.id ?? null);
      } catch {
        setMyId(null);
      }
    });
  }, []);

  useEffect(() => {
    const rawPeriod = Array.isArray(params.rankPeriod) ? params.rankPeriod[0] : params.rankPeriod;
    const rawCategory = Array.isArray(params.rankCategory) ? params.rankCategory[0] : params.rankCategory;
    const nextPeriod = normalizePeriod(rawPeriod);
    if (nextPeriod) setPeriod(nextPeriod);
    if (rawCategory === 'points' || rawCategory === 'distance' || rawCategory === 'referrals') {
      setCategory(rawCategory);
    }
  }, [params.rankCategory, params.rankPeriod]);

  const scoreLabel = category === 'points' ? 'pkt' : category === 'distance' ? 'km' : 'zaproszeń';

  const fetchRanking = useCallback(async (nextCategory: RankCategory, nextPeriod: RankPeriod, silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const token = (await AsyncStorage.getItem('token')) ?? (await AsyncStorage.getItem('userToken'));
      const qs = new URLSearchParams({
        category: nextCategory,
        period: nextPeriod,
        take: '100',
      });
      const res = await fetch(`${API_URL}/api/profile/ranking?${qs.toString()}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      setUsers(Array.isArray(data?.users) ? data.users : []);
      setMyPosition(data?.myPosition ?? null);
      setCompetition(nextCategory === 'referrals' ? (data?.competition ?? null) : null);
      setRange(nextCategory === 'referrals' ? null : (data?.range ?? null));
      setSeason(nextPeriod === 'season' ? (data?.season ?? null) : null);
      setSeasonRewards(nextPeriod === 'season' && Array.isArray(data?.rewards) ? data.rewards : []);
    } catch (e) {
      setUsers([]);
      setMyPosition(null);
      setCompetition(null);
      setRange(null);
      setSeason(null);
      setSeasonRewards([]);
      setError(e instanceof Error ? e.message : 'Nie udało się pobrać rankingu');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void fetchRanking(category, period);
  }, [category, period, fetchRanking]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void fetchRanking(category, period, true);
  }, [category, fetchRanking, period]);

  const openProfile = useCallback((id: number) => {
    router.push({ pathname: '/profile/[userId]', params: { userId: String(id) } });
  }, [router]);

  const topThree = users.slice(0, 3);
  const restUsers = users.slice(3);
  const rangeLabel = category === 'referrals' ? 'RYWALIZACJA SPOŁECZNOŚCI' : formatRangeLabel(period, range);

  const ListHeader = useMemo(() => (
    <View style={styles.headerContent}>
      <CommunitySegmentTabs
        tabs={[
          { key: 'points', label: 'PUNKTY', icon: 'star' },
          { key: 'distance', label: 'DYSTANS', icon: 'speed' },
          { key: 'referrals', label: 'ZAPROSZENIA', icon: 'group-add' },
        ]}
        activeKey={category}
        onChange={(key) => setCategory(key as RankCategory)}
        compact
      />

      {category === 'referrals' && competition ? (
        <View style={{ paddingHorizontal: 16, marginTop: 12, marginBottom: 12 }}>
          <CompetitionBanner competition={competition} theme={theme} />
        </View>
      ) : null}

      {category !== 'referrals' ? (
        <View style={styles.periodRow}>
          {PERIODS.map((p) => {
            const active = period === p.key;
            return (
              <TouchableOpacity
                key={p.key}
                activeOpacity={0.82}
                onPress={() => { setPeriod(p.key); if (p.key === 'season') setCategory('points'); }}
                style={[
                  styles.periodChip,
                  { backgroundColor: theme.surface, borderColor: theme.border2 },
                  active && { backgroundColor: '#e3383518', borderColor: theme.primary },
                ]}
              >
                <Text style={[styles.periodText, { color: active ? theme.primary : theme.textDim }]}>
                  {p.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      ) : null}

      {period === 'season' && season ? (
        <View style={[styles.seasonCard, { backgroundColor: theme.surface, borderColor: theme.primary }]}> 
          <View style={styles.competitionHeader}><MaterialCommunityIcons name="trophy-award" size={20} color="#FFD447" /><Text style={[styles.competitionTitle, { color: theme.text }]}>SEZON {season.number} · {season.name}</Text></View>
          <Text style={[styles.competitionMeta, { color: theme.primary }]}>{formatCountdown(season.endsAt)}</Text>
          {seasonRewards.length > 0 && <View style={styles.rewardList}>{seasonRewards.map((reward) => <View key={reward.id} style={[styles.rewardPill, { borderColor: theme.border2 }]}><Text style={[styles.rewardPlace, { color: '#FFD447' }]}>#{reward.placeFrom}{reward.placeTo !== reward.placeFrom ? `–${reward.placeTo}` : ''}</Text><Text numberOfLines={1} style={[styles.rewardName, { color: theme.text }]}>{reward.name}</Text></View>)}</View>}
          <TouchableOpacity onPress={() => router.push('/profile/seasons')} style={[styles.seasonStatsButton, { borderColor: theme.border2 }]}><MaterialCommunityIcons name="chart-timeline-variant" size={15} color={theme.primary} /><Text style={[styles.periodText, { color: theme.primary }]}>MOJE STATYSTYKI I HISTORIA</Text></TouchableOpacity>
        </View>
      ) : null}

      <LinearGradient
        colors={['#E3383522', '#E3383508', '#FFD44710']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.rangeBanner, { borderColor: theme.border2 }]}
      >
        <View style={styles.rangeIcon}>
          <MaterialCommunityIcons
            name={category === 'referrals' ? 'flag-checkered' : 'calendar-range'}
            size={16}
            color={theme.primary}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.rangeEyebrow, { color: theme.textDim }]}>AKTYWNY ZAKRES</Text>
          <Text style={[styles.rangeTitle, { color: theme.text }]}>{rangeLabel}</Text>
        </View>
        <MaterialCommunityIcons name="chevron-double-up" size={18} color="#FFD447" />
      </LinearGradient>

      {loading && users.length === 0 ? (
        <RankingPodiumSkeleton />
      ) : (
        <RankingPodium users={topThree} myId={myId} scoreLabel={scoreLabel} onPressUser={openProfile} />
      )}

      {competition?.status === 'ended' ? (
        <View style={[styles.myPosition, { backgroundColor: '#FFD70018', borderColor: '#FFD70040' }]}>
          <MaterialCommunityIcons name="trophy" size={16} color="#FFD700" />
          <Text style={[styles.myPositionText, { color: '#FFD700' }]}>KONKURS ZAKOŃCZONY — ZWYCIĘZCY</Text>
        </View>
      ) : myPosition ? (
        <View style={[styles.myPosition, { backgroundColor: '#e3383512', borderColor: '#e3383535' }]}>
          <MaterialIcons name="leaderboard" size={16} color={theme.primary} />
          <Text style={[styles.myPositionText, { color: theme.primary }]}>TWOJA POZYCJA · #{myPosition}</Text>
        </View>
      ) : null}

      {restUsers.length > 0 ? (
        <Text style={[styles.sectionLabel, { color: theme.textDim }]}>
          {competition?.status === 'ended' ? 'ZWYCIĘZCY' : 'DALEJ W RANKINGU'}
        </Text>
      ) : null}
    </View>
  ), [category, competition, loading, myId, myPosition, openProfile, period, rangeLabel, restUsers.length, scoreLabel, season, seasonRewards, theme, topThree, users.length, router]);

  const renderItem: ListRenderItem<RankingUser> = useCallback(({ item }) => (
    <RankingListRow
      user={item}
      isMe={item.id === myId}
      scoreLabel={scoreLabel}
      onPress={() => openProfile(item.id)}
    />
  ), [myId, openProfile, scoreLabel]);

  return (
    <View style={[styles.root, { backgroundColor: theme.bg }]}>
      <CommunityScreenHeader title="RANKING" subtitle="NAJLEPSI KIEROWCY" />
      <FlatList
        data={restUsers}
        keyExtractor={(u) => String(u.id)}
        renderItem={renderItem}
        ListHeaderComponent={ListHeader}
        contentContainerStyle={styles.listContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.primary} />}
        ListEmptyComponent={!loading && users.length === 0 ? (
          <View style={styles.empty}>
            <MaterialIcons name={error ? 'sync-problem' : 'leaderboard'} size={34} color={theme.textDim} />
            <Text style={[styles.emptyTitle, { color: theme.text }]}>
              {error ? 'Nie udało się wczytać' : 'Brak danych'}
            </Text>
            <Text style={[styles.emptySub, { color: theme.textDim }]}>
              {error
                ?? (category === 'referrals' && !competition
                  ? 'Nikt jeszcze nikogo nie zaprosił.'
                  : 'Zmień zakres czasu albo wróć później.')}
            </Text>
            {error ? (
              <TouchableOpacity
                accessibilityRole="button"
                activeOpacity={0.84}
                onPress={() => void fetchRanking(category, period)}
                style={[styles.retryButton, { backgroundColor: theme.primary }]}
              >
                <MaterialIcons name="refresh" size={16} color="#fff" />
                <Text style={styles.retryText}>SPRÓBUJ PONOWNIE</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        ) : null}
        initialNumToRender={12}
        maxToRenderPerBatch={12}
        windowSize={7}
        removeClippedSubviews
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  listContent: {
    paddingBottom: 90,
    paddingHorizontal: 16,
  },
  headerContent: {
    marginHorizontal: -16,
    paddingBottom: 10,
  },
  competitionBanner: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    gap: 8,
  },
  competitionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  competitionTitle: {
    flex: 1,
    fontFamily: 'Manrope_600SemiBold',
    fontSize: 12,
    fontWeight: '900',
  },
  competitionPrize: {
    fontFamily: 'Satoshi',
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 20,
  },
  competitionMeta: {
    fontFamily: 'Satoshi',
    fontSize: 12,
  },
  seasonCard: { marginHorizontal: 16, marginBottom: 12, borderWidth: 1, borderRadius: 16, padding: 14, gap: 10 },
  rewardList: { gap: 7 },
  rewardPill: { minHeight: 38, borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 10 },
  rewardPlace: { fontFamily: 'Manrope_600SemiBold', fontSize: 12, fontWeight: '900', minWidth: 34 },
  rewardName: { flex: 1, fontFamily: 'Satoshi', fontSize: 12, fontWeight: '700' },
  seasonStatsButton: { borderWidth: 1, borderRadius: 10, paddingVertical: 10, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8 },
  periodRow: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 16,
    marginTop: 12,
    marginBottom: 12,
  },
  periodChip: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 9,
    alignItems: 'center',
  },
  periodText: {
    fontFamily: 'Manrope_600SemiBold',
    fontSize: 12,
    fontWeight: '800',
  },
  rangeBanner: {
    marginHorizontal: 16,
    marginBottom: 13,
    minHeight: 62,
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 13,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    overflow: 'hidden',
  },
  rangeIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: '#E3383518',
    borderWidth: 1,
    borderColor: '#E3383533',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rangeEyebrow: {
    fontFamily: 'Manrope_600SemiBold',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1,
  },
  rangeTitle: {
    fontFamily: 'Manrope_600SemiBold',
    fontSize: 12,
    fontWeight: '900',
    marginTop: 4,
  },
  myPosition: {
    marginHorizontal: 16,
    marginTop: 12,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  myPositionText: {
    fontFamily: 'Manrope_600SemiBold',
    fontSize: 12,
    fontWeight: '800',
  },
  sectionLabel: {
    fontFamily: 'Manrope_600SemiBold',
    fontSize: 12,
    fontWeight: '800',
    marginHorizontal: 16,
    marginTop: 18,
    marginBottom: 10,
  },
  empty: {
    alignItems: 'center',
    paddingVertical: 46,
    paddingHorizontal: 24,
  },
  emptyTitle: {
    fontFamily: 'Manrope_600SemiBold',
    fontSize: 13,
    fontWeight: '900',
    marginTop: 12,
  },
  emptySub: {
    textAlign: 'center',
    fontSize: 12,
    lineHeight: 17,
    marginTop: 6,
  },
  retryButton: {
    minHeight: 44,
    borderRadius: 12,
    paddingHorizontal: 16,
    marginTop: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  retryText: {
    color: '#fff',
    fontFamily: 'Manrope_600SemiBold',
    fontSize: 12,
    fontWeight: '900',
  },
});
