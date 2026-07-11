import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  type ListRenderItem,
} from 'react-native';
import { Image } from 'expo-image';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { API_URL } from '../../../constants/config';
import { useTheme } from '../../../contexts/ThemeContext';
import { CommunityScreenHeader, CommunitySegmentTabs } from '../../../components/community';

type RankCategory = 'points' | 'distance' | 'referrals';
type RankPeriod = 'day' | 'week' | 'month' | 'all';

interface RankUser {
  id: number;
  username: string;
  avatar: string | null;
  position: number;
  score: number;
  sub: string;
  streak?: number;
  isPremium?: boolean;
  isWinner?: boolean;
}

interface ReferralCompetition {
  id: number;
  title: string;
  prizeDescription: string;
  winnerPlaces: number;
  endsAt: string;
  status: 'scheduled' | 'active' | 'ended' | 'archived';
  winners?: Array<{
    userId: number;
    username: string;
    avatar: string | null;
    invitedCount: number;
    position: number;
  }>;
  winnersUntil?: string;
  finalizedAt?: string;
}

const PERIODS: Array<{ key: RankPeriod; label: string }> = [
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
};

function normalizePeriod(raw?: string): RankPeriod | null {
  if (!raw) return null;
  return PERIOD_ALIASES[String(raw).trim().toLowerCase()] ?? null;
}

function formatScore(value: number): string {
  return Number(value || 0).toLocaleString('pl-PL');
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

function RankAvatar({ user, size }: { user: RankUser; size: number }) {
  const { theme } = useTheme();
  return (
    <View
      style={[
        styles.avatar,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: theme.surface2,
          borderColor: theme.border2,
        },
      ]}
    >
      {user.avatar ? (
        <Image source={{ uri: user.avatar }} style={{ width: size, height: size }} contentFit="cover" recyclingKey={String(user.id)} />
      ) : (
        <Text style={[styles.initials, { color: theme.text }]}>
          {user.username.slice(0, 2).toUpperCase()}
        </Text>
      )}
    </View>
  );
}

function RankListRow({
  user,
  isMe,
  scoreLabel,
  onPress,
}: {
  user: RankUser;
  isMe: boolean;
  scoreLabel: string;
  onPress: () => void;
}) {
  const { theme } = useTheme();
  return (
    <TouchableOpacity
      activeOpacity={0.86}
      onPress={onPress}
      style={[
        styles.row,
        { backgroundColor: theme.surface, borderColor: isMe ? '#e33835' : theme.border2 },
        isMe && { backgroundColor: '#e3383512' },
      ]}
    >
      <Text style={[styles.rowPosition, { color: user.position <= 10 ? theme.primary : theme.textDim }]}>
        #{user.position}
      </Text>
      <RankAvatar user={user} size={44} />
      <View style={styles.rowMain}>
        <View style={styles.nameLine}>
          <Text style={[styles.username, { color: theme.text }]} numberOfLines={1}>
            {user.username}{isMe ? ' (Ty)' : ''}
          </Text>
          {user.isPremium ? (
            <View style={styles.premiumPill}>
              <Text style={styles.premiumText}>PREMIUM</Text>
            </View>
          ) : null}
        </View>
        <Text style={[styles.sub, { color: theme.textDim }]} numberOfLines={1}>
          {user.sub}
        </Text>
      </View>
      <View style={styles.scoreBox}>
        <Text style={[styles.score, { color: isMe ? theme.primary : theme.text }]}>
          {formatScore(user.score)}
        </Text>
        <Text style={[styles.scoreUnit, { color: theme.textDim }]}>{scoreLabel}</Text>
      </View>
    </TouchableOpacity>
  );
}

function TopRankCard({
  user,
  scoreLabel,
  onPress,
}: {
  user: RankUser;
  scoreLabel: string;
  onPress: () => void;
}) {
  const { theme } = useTheme();
  const accent = user.position === 1 ? '#FFD700' : user.position === 2 ? '#cbd5e1' : '#d97706';
  return (
    <TouchableOpacity
      activeOpacity={0.86}
      onPress={onPress}
      style={[styles.topCard, { backgroundColor: theme.surface, borderColor: `${accent}66` }]}
    >
      <View style={[styles.medal, { backgroundColor: `${accent}22`, borderColor: `${accent}66` }]}>
        <MaterialCommunityIcons name={user.position === 1 ? 'crown' : 'podium'} size={16} color={accent} />
        <Text style={[styles.medalText, { color: accent }]}>#{user.position}</Text>
      </View>
      <RankAvatar user={user} size={54} />
      <Text style={[styles.topName, { color: theme.text }]} numberOfLines={1}>
        {user.username}
      </Text>
      <Text style={[styles.topScore, { color: theme.primary }]} numberOfLines={1}>
        {formatScore(user.score)} {scoreLabel}
      </Text>
    </TouchableOpacity>
  );
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
  const [users, setUsers] = useState<RankUser[]>([]);
  const [myPosition, setMyPosition] = useState<number | null>(null);
  const [competition, setCompetition] = useState<ReferralCompetition | null>(null);
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
    } catch (e) {
      setUsers([]);
      setMyPosition(null);
      setCompetition(null);
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
                onPress={() => setPeriod(p.key)}
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

      {competition?.status === 'ended' ? (
        <View style={[styles.myPosition, { backgroundColor: '#FFD70018', borderColor: '#FFD70040' }]}>
          <MaterialCommunityIcons name="trophy" size={16} color="#FFD700" />
          <Text style={[styles.myPositionText, { color: '#FFD700' }]}>KONKURS ZAKOŃCZONY — ZWYCIĘZCY</Text>
        </View>
      ) : myPosition ? (
        <View style={[styles.myPosition, { backgroundColor: '#e3383512', borderColor: '#e3383535' }]}>
          <MaterialIcons name="leaderboard" size={16} color={theme.primary} />
          <Text style={[styles.myPositionText, { color: theme.primary }]}>Twoja pozycja: #{myPosition}</Text>
        </View>
      ) : null}

      {topThree.length > 0 ? (
        <View style={styles.topGrid}>
          {topThree.map((u) => (
            <TopRankCard
              key={u.id}
              user={u}
              scoreLabel={scoreLabel}
              onPress={() => openProfile(u.id)}
            />
          ))}
        </View>
      ) : null}

      {restUsers.length > 0 ? (
        <Text style={[styles.sectionLabel, { color: theme.textDim }]}>
          {competition?.status === 'ended' ? 'ZWYCIĘZCY' : 'DALEJ W RANKINGU'}
        </Text>
      ) : null}
    </View>
  ), [category, competition, myPosition, openProfile, period, restUsers.length, scoreLabel, theme]);

  const renderItem: ListRenderItem<RankUser> = useCallback(({ item }) => (
    <RankListRow
      user={item}
      isMe={item.id === myId}
      scoreLabel={scoreLabel}
      onPress={() => openProfile(item.id)}
    />
  ), [myId, openProfile, scoreLabel]);

  return (
    <View style={[styles.root, { backgroundColor: theme.bg }]}>
      <CommunityScreenHeader title="RANKING" subtitle="NAJLEPSI KIEROWCY" />
      {loading && !refreshing ? (
        <View style={styles.loadingPage}>
          {ListHeader}
          <ActivityIndicator size="large" color={theme.primary} style={{ marginTop: 32 }} />
        </View>
      ) : (
        <FlatList
          data={restUsers}
          keyExtractor={(u) => String(u.id)}
          renderItem={renderItem}
          ListHeaderComponent={ListHeader}
          contentContainerStyle={styles.listContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.primary} />}
          ListEmptyComponent={users.length === 0 ? (
            <View style={styles.empty}>
              <MaterialIcons name={error ? 'sync-problem' : 'leaderboard'} size={34} color={theme.textDim} />
              <Text style={[styles.emptyTitle, { color: theme.text }]}>
                {error ? 'Nie udało się wczytać' : 'Brak danych'}
              </Text>
              <Text style={[styles.emptySub, { color: theme.textDim }]}>
                {error
                  ?? (category === 'referrals' && !competition && users.length === 0
                    ? 'Nikt jeszcze nikogo nie zaprosił.'
                    : category === 'referrals' && !competition
                      ? 'Brak aktywnego eventu — pełny ranking zaproszeń.'
                      : 'Zmień zakres czasu albo wróć później.')}
              </Text>
            </View>
          ) : null}
          initialNumToRender={12}
          maxToRenderPerBatch={12}
          windowSize={7}
          removeClippedSubviews
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  listContent: {
    paddingBottom: 90,
    paddingHorizontal: 16,
  },
  loadingPage: {
    flex: 1,
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
    fontFamily: 'Orbitron',
    fontSize: 11,
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
    fontFamily: 'Orbitron',
    fontSize: 8,
    fontWeight: '800',
  },
  myPosition: {
    marginHorizontal: 16,
    marginBottom: 14,
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
    fontFamily: 'Orbitron',
    fontSize: 11,
    fontWeight: '800',
  },
  topGrid: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 16,
    marginBottom: 18,
  },
  topCard: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 8,
    alignItems: 'center',
    minHeight: 158,
  },
  medal: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderRadius: 9,
    paddingHorizontal: 7,
    paddingVertical: 4,
    marginBottom: 10,
  },
  medalText: {
    fontFamily: 'Orbitron',
    fontSize: 9,
    fontWeight: '900',
  },
  topName: {
    fontFamily: 'Orbitron',
    fontSize: 10,
    fontWeight: '900',
    marginTop: 9,
    maxWidth: '100%',
  },
  topScore: {
    fontFamily: 'Orbitron',
    fontSize: 9,
    fontWeight: '800',
    marginTop: 5,
  },
  sectionLabel: {
    fontFamily: 'Orbitron',
    fontSize: 8,
    fontWeight: '800',
    marginHorizontal: 16,
    marginBottom: 10,
  },
  row: {
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 12,
    marginBottom: 9,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
  },
  rowPosition: {
    width: 34,
    textAlign: 'center',
    fontFamily: 'Orbitron',
    fontSize: 13,
    fontWeight: '900',
  },
  avatar: {
    overflow: 'hidden',
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  initials: {
    fontFamily: 'Orbitron',
    fontSize: 13,
    fontWeight: '800',
  },
  rowMain: {
    flex: 1,
    minWidth: 0,
  },
  nameLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  username: {
    flexShrink: 1,
    fontFamily: 'Orbitron',
    fontSize: 12,
    fontWeight: '800',
  },
  premiumPill: {
    borderRadius: 7,
    borderWidth: 1,
    borderColor: '#FFD70040',
    backgroundColor: '#FFD70018',
    paddingHorizontal: 5,
    paddingVertical: 2,
  },
  premiumText: {
    fontFamily: 'Orbitron',
    fontSize: 7,
    color: '#FFD700',
    fontWeight: '800',
  },
  sub: {
    fontSize: 11,
    marginTop: 4,
  },
  scoreBox: {
    alignItems: 'flex-end',
    minWidth: 58,
  },
  score: {
    fontFamily: 'Orbitron',
    fontSize: 13,
    fontWeight: '900',
  },
  scoreUnit: {
    fontSize: 10,
    marginTop: 2,
  },
  empty: {
    alignItems: 'center',
    paddingVertical: 46,
    paddingHorizontal: 24,
  },
  emptyTitle: {
    fontFamily: 'Orbitron',
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
});
