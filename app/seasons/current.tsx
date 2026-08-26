import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect, useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { API_URL } from '../../constants/config';
import { useTheme } from '../../contexts/ThemeContext';
import { withAlpha } from '../../constants/theme';
import { useScreenHeaderTop } from '../../lib/screenHeaderInsets';
import { formatQuestProgress, useQuestTrack } from '../../lib/questTrack';
import { LiveCountdownText } from '../../components/home/LiveCountdownText';

type SeasonDetails = {
  season: { id: string; number: number; name: string; description?: string | null; imageUrl?: string | null; rules?: unknown; startsAt: string; endsAt: string } | null;
  stats: Record<string, number> | null;
  rewards: { id: string; placeFrom: number; placeTo: number; type: string; name: string; description?: string | null; amount?: number | null }[];
  achievements: { id: string; icon: string; label: string; description?: string; rarity: string; points?: number; currentValue: number; conditionValue: number; progress: number; unlocked: boolean; active: boolean }[];
};
type PassReward = { id: string; track: 'free' | 'premium'; type: string; name: string; description?: string | null; amount?: number | null; metadata?: { fulfillmentType?: string; instructions?: string } | null; grant?: { id: string; status: string } | null };
type PassData = { pass: null | { id: string; levelCount: number; priceGross: number; currency: string; salesStartAt?: string | null; salesEndAt?: string | null }; progress?: { xp: number; currentLevel: number; levelStartXp?: number; nextLevelXp?: number | null; completed: boolean }; premium?: { active: boolean; status: string }; xpRules?: { driveXpPerKm: number; dailyDriveXpCap: number; questPointsXpMultiplier: number; achievementXpMultiplier: number }; daily?: { driveXp: number }; levels?: { id: string; level: number; requiredXp: number; unlocked: boolean; rewards: PassReward[] }[] };

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
  const [passData, setPassData] = useState<PassData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [now, setNow] = useState(Date.now());
  const [passBusy, setPassBusy] = useState('');
  const [passView, setPassView] = useState<'rewards' | 'missions'>('rewards');
  const [missionPeriod, setMissionPeriod] = useState<'daily' | 'weekly' | 'seasonal'>('weekly');
  const [addressRewardId, setAddressRewardId] = useState<string | null>(null);
  const [address, setAddress] = useState({ fullName: '', phone: '', street: '', postalCode: '', city: '', country: 'Polska' });
  const { data: questData, loading: questLoading, error: questError, refresh: refreshQuests } = useQuestTrack();

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError('');
    try {
      const token = (await AsyncStorage.getItem('userToken')) ?? (await AsyncStorage.getItem('token'));
      const headers = token ? { Authorization: `Bearer ${token}` } : undefined;
      const [response, passResponse] = await Promise.all([fetch(`${API_URL}/api/seasons/current`, { headers }), fetch(`${API_URL}/api/seasons/pass`, { headers })]);
      const [payload, passPayload] = await Promise.all([response.json().catch(() => ({})), passResponse.json().catch(() => ({}))]);
      if (!response.ok) throw new Error(payload?.error || `HTTP ${response.status}`);
      setData(payload); if (passResponse.ok) setPassData(passPayload);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Nie udało się pobrać sezonu');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { void load(); void refreshQuests(); }, [load, refreshQuests]));
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 60_000); return () => clearInterval(timer); }, []);

  const season = data?.season;
  const rules = useMemo(() => rulesText(season?.rules), [season?.rules]);
  const image = mediaUrl(season?.imageUrl);
  const stats = data?.stats;
  const buyPass = useCallback(async () => {
    setPassBusy('purchase');
    try {
      const token = (await AsyncStorage.getItem('userToken')) ?? (await AsyncStorage.getItem('token'));
      const response = await fetch(`${API_URL}/api/seasons/pass/checkout`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Nie udało się rozpocząć płatności');
      if (payload.alreadyOwned) { await load(true); return; }
      if (payload.url) await WebBrowser.openBrowserAsync(payload.url, { presentationStyle: WebBrowser.WebBrowserPresentationStyle.FULL_SCREEN });
      await load(true);
    } catch (purchaseError) { setError(purchaseError instanceof Error ? purchaseError.message : 'Błąd zakupu'); } finally { setPassBusy(''); }
  }, [load]);
  const claimPass = useCallback(async (rewardId: string, withAddress = false) => {
    setPassBusy(rewardId);
    try {
      const token = (await AsyncStorage.getItem('userToken')) ?? (await AsyncStorage.getItem('token'));
      const response = await fetch(`${API_URL}/api/seasons/pass/rewards/${rewardId}/claim`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(withAddress ? { shippingAddress: address } : {}) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) { if (payload.code === 'ADDRESS_REQUIRED') { setAddressRewardId(rewardId); return; } throw new Error(payload.error || 'Nie udało się odebrać nagrody'); }
      setAddressRewardId(null); await load(true);
    } catch (claimError) { setError(claimError instanceof Error ? claimError.message : 'Błąd odbioru'); } finally { setPassBusy(''); }
  }, [address, load]);

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
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(true); void refreshQuests(); }} tintColor={theme.primary} />}
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

          {passData?.pass ? <Section title="VROOMPASS" theme={theme}>
            <View style={styles.passHead}><View><Text style={[styles.passLevel, { color: theme.text }]}>POZIOM {passData.progress?.currentLevel || 0}</Text><Text style={[styles.rowMeta, { color: theme.textDim }]}>{Number(passData.progress?.xp || 0).toLocaleString('pl-PL')} XP{passData.progress?.nextLevelXp ? ` / ${Number(passData.progress.nextLevelXp).toLocaleString('pl-PL')} XP` : ' · UKOŃCZONY'}</Text></View>{passData.premium?.active ? <View style={styles.passOwned}><MaterialCommunityIcons name="crown" size={15} color="#111" /><Text>PREMIUM AKTYWNY</Text></View> : <TouchableOpacity disabled={passBusy === 'purchase'} onPress={buyPass} style={[styles.buyPass, { backgroundColor: '#FFD447' }]}>{passBusy === 'purchase' ? <ActivityIndicator size="small" color="#111" /> : <><MaterialCommunityIcons name="crown" size={15} color="#111" /><Text>KUP · {(passData.pass.priceGross / 100).toFixed(2)} PLN</Text></>}</TouchableOpacity>}</View>
            <View style={[styles.passTrack, { backgroundColor: theme.border }]}><View style={[styles.passTrackFill, { backgroundColor: theme.primary, width: `${passData.progress?.completed ? 100 : Math.max(1, Math.min(100, (((passData.progress?.xp || 0) - (passData.progress?.levelStartXp || 0)) / Math.max(1, (passData.progress?.nextLevelXp || 1) - (passData.progress?.levelStartXp || 0))) * 100))}%` }]} /></View>
            <View style={[styles.passTabs, { backgroundColor: theme.bg }]}>{(['rewards', 'missions'] as const).map((view) => <TouchableOpacity key={view} onPress={() => setPassView(view)} style={[styles.passTab, passView === view && { backgroundColor: theme.primary }]}><MaterialCommunityIcons name={view === 'rewards' ? 'gift-outline' : 'target'} size={16} color={passView === view ? '#fff' : theme.textDim} /><Text style={[styles.passTabText, { color: passView === view ? '#fff' : theme.textDim }]}>{view === 'rewards' ? 'NAGRODY' : 'MISJE'}</Text></TouchableOpacity>)}</View>

            {passView === 'rewards' ? <>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.passLevels}>{passData.levels?.map((level) => <View key={level.id} style={[styles.passLevelCard, { borderColor: level.unlocked ? theme.primary : theme.border, backgroundColor: theme.bg }]}><Text style={[styles.passNumber, { color: level.unlocked ? theme.primary : theme.textDim }]}>{level.level}</Text><Text style={[styles.passXp, { color: theme.textDim }]}>{Number(level.requiredXp).toLocaleString('pl-PL')} XP</Text>{(['free', 'premium'] as const).map((track) => { const rewards = level.rewards.filter((reward) => reward.track === track); return <View key={track} style={[styles.passLane, { borderColor: theme.border }]}><Text style={[styles.passLaneLabel, { color: track === 'premium' ? '#FFD447' : theme.textDim }]}>{track === 'premium' ? 'PREMIUM' : 'DARMOWY'}</Text>{rewards.length ? rewards.map((reward) => { const locked = !level.unlocked || (track === 'premium' && !passData.premium?.active); const claimable = reward.grant?.status === 'available' || reward.grant?.status === 'problem'; return <View key={reward.id} style={styles.passReward}><MaterialCommunityIcons name={rewardIcon(reward.type) as any} size={20} color={locked ? theme.textDim : track === 'premium' ? '#FFD447' : theme.primary} /><Text numberOfLines={2} style={[styles.passRewardName, { color: locked ? theme.textDim : theme.text }]}>{reward.name}</Text>{claimable && !locked ? <TouchableOpacity disabled={passBusy === reward.id} onPress={() => claimPass(reward.id)} style={[styles.passClaim, { backgroundColor: theme.primary }]}><Text>{passBusy === reward.id ? '…' : 'ODBIERZ'}</Text></TouchableOpacity> : <Text style={[styles.passState, { color: reward.grant?.status === 'granted' ? '#4de926' : theme.textDim }]}>{reward.grant?.status === 'granted' ? 'ODEBRANO' : locked ? 'ZABLOKOWANE' : reward.grant?.status?.toUpperCase() || 'GOTOWE WKRÓTCE'}</Text>}</View>; }) : <Text style={[styles.passEmpty, { color: theme.textDim }]}>Brak nagrody</Text>}</View>; })}</View>)}</ScrollView>
              {addressRewardId ? <View style={[styles.passAddress, { borderColor: theme.primary }]}><Text style={[styles.rowTitle, { color: theme.text }]}>DANE DO WYSYŁKI</Text>{Object.entries(address).map(([key, value]) => <TextInput key={key} value={value} onChangeText={(text) => setAddress((old) => ({ ...old, [key]: text }))} placeholder={key} placeholderTextColor={theme.textDim} style={[styles.passInput, { borderColor: theme.border, color: theme.text }]} />)}<View style={styles.actionRow}><TouchableOpacity onPress={() => setAddressRewardId(null)} style={[styles.secondaryAction, { borderColor: theme.border }]}><Text style={[styles.secondaryActionText, { color: theme.text }]}>ANULUJ</Text></TouchableOpacity><TouchableOpacity onPress={() => claimPass(addressRewardId, true)} style={[styles.primaryAction, { backgroundColor: theme.primary }]}><Text style={styles.primaryActionText}>POTWIERDŹ</Text></TouchableOpacity></View></View> : null}
            </> : <View style={styles.passMissions}>
              <View style={styles.missionPeriods}>{(['daily', 'weekly', 'seasonal'] as const).map((period) => <TouchableOpacity key={period} onPress={() => setMissionPeriod(period)} style={[styles.missionPeriod, { borderColor: missionPeriod === period ? theme.primary : theme.border, backgroundColor: missionPeriod === period ? withAlpha(theme.primary, '18') : theme.bg }]}><Text style={[styles.missionPeriodText, { color: missionPeriod === period ? theme.primary : theme.textDim }]}>{period === 'daily' ? 'DZIENNE' : period === 'weekly' ? 'TYGODNIOWE' : 'SEZONOWE'}</Text></TouchableOpacity>)}</View>

              {missionPeriod === 'daily' ? <View style={[styles.missionCard, { borderColor: theme.border, backgroundColor: theme.bg }]}>
                <View style={styles.missionHead}><View style={[styles.missionIcon, { backgroundColor: withAlpha(theme.primary, '18') }]}><MaterialCommunityIcons name="car-speed-limiter" size={22} color={theme.primary} /></View><View style={{ flex: 1 }}><Text style={[styles.missionTitle, { color: theme.text }]}>JEDŹ Z VROOM</Text><Text style={[styles.missionMeta, { color: theme.textDim }]}>Zweryfikowane kilometry · reset o północy</Text></View><Text style={[styles.missionXp, { color: theme.primary }]}>+{passData.xpRules?.driveXpPerKm || 0} XP/KM</Text></View>
                <MissionProgress current={passData.daily?.driveXp || 0} target={passData.xpRules?.dailyDriveXpCap || 0} theme={theme} />
                <Text style={[styles.missionFoot, { color: theme.textDim }]}>{passData.daily?.driveXp || 0} / {passData.xpRules?.dailyDriveXpCap || 0} Pass XP dzisiaj{passData.xpRules?.driveXpPerKm ? ` · limit odpowiada ok. ${Math.ceil((passData.xpRules.dailyDriveXpCap || 0) / passData.xpRules.driveXpPerKm)} km` : ''}</Text>
              </View> : null}

              {missionPeriod === 'weekly' ? <>
                <View style={styles.missionReset}><Text style={[styles.missionHint, { color: theme.textDim }]}>TYGODNIOWY TOR VROOM</Text><LiveCountdownText targetIso={questData?.nextResetAt ?? null} prefix="RESET ZA: " fallback="RESET: BRAK DANYCH" style={[styles.missionResetText, { color: theme.primary }]} /></View>
                {questLoading && !questData ? <ActivityIndicator color={theme.primary} /> : questError && !questData ? <TouchableOpacity onPress={() => void refreshQuests()} style={[styles.missionCard, { borderColor: theme.primary }]}><Text style={[styles.missionTitle, { color: theme.primary }]}>NIE UDAŁO SIĘ POBRAĆ MISJI — SPRÓBUJ PONOWNIE</Text></TouchableOpacity> : questData?.tasks.map((task) => { const xp = Math.floor(task.points * Number(passData.xpRules?.questPointsXpMultiplier || 0)); return <View key={task.key} style={[styles.missionCard, { borderColor: task.done ? withAlpha('#4de926', '66') : theme.border, backgroundColor: theme.bg }]}><View style={styles.missionHead}><MaterialCommunityIcons name={task.done ? 'check-circle' : 'target'} size={22} color={task.done ? '#4de926' : theme.primary} /><View style={{ flex: 1 }}><Text style={[styles.missionTitle, { color: theme.text }]}>{task.label}</Text><Text style={[styles.missionMeta, { color: theme.textDim }]}>{formatQuestProgress(task)}</Text></View><Text style={[styles.missionXp, { color: task.done ? '#4de926' : theme.primary }]}>+{xp} PASS XP</Text></View><MissionProgress current={task.current} target={task.target} theme={theme} complete={task.done} /></View>; })}
              </> : null}

              {missionPeriod === 'seasonal' ? <>
                <Text style={[styles.missionHint, { color: theme.textDim }]}>OSIĄGNIĘCIA WAŻNE DO KOŃCA SEZONU</Text>
                {data?.achievements?.length ? data.achievements.map((achievement) => { const xp = Math.floor(Number(achievement.points || 0) * Number(passData.xpRules?.achievementXpMultiplier || 0)); return <View key={achievement.id} style={[styles.missionCard, { borderColor: achievement.unlocked ? withAlpha('#4de926', '66') : theme.border, backgroundColor: theme.bg }]}><View style={styles.missionHead}><Text style={styles.missionEmoji}>{achievement.icon || '🏆'}</Text><View style={{ flex: 1 }}><Text style={[styles.missionTitle, { color: theme.text }]}>{achievement.label}</Text><Text numberOfLines={2} style={[styles.missionMeta, { color: theme.textDim }]}>{achievement.description}</Text></View><Text style={[styles.missionXp, { color: achievement.unlocked ? '#4de926' : theme.primary }]}>+{xp} PASS XP</Text></View><MissionProgress current={achievement.currentValue} target={achievement.conditionValue} theme={theme} complete={achievement.unlocked} /></View>; }) : <Text style={[styles.body, { color: theme.textDim }]}>Brak misji sezonowych.</Text>}
              </> : null}
            </View>}
          </Section> : null}

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

function MissionProgress({ current, target, theme, complete = false }: { current: number; target: number; theme: any; complete?: boolean }) {
  const percent = target > 0 ? Math.max(0, Math.min(100, (current / target) * 100)) : 0;
  return <View style={[styles.missionProgress, { backgroundColor: theme.border }]}><View style={[styles.missionProgressFill, { width: `${complete ? 100 : percent}%`, backgroundColor: complete ? '#4de926' : theme.primary }]} /></View>;
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
  passHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  passLevel: { fontFamily: 'Orbitron', fontSize: 16, fontWeight: '900' },
  buyPass: { minHeight: 38, paddingHorizontal: 12, borderRadius: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  passOwned: { minHeight: 34, paddingHorizontal: 10, borderRadius: 11, backgroundColor: '#FFD447', flexDirection: 'row', alignItems: 'center', gap: 5 },
  passTrack: { height: 6, borderRadius: 3, overflow: 'hidden' },
  passTrackFill: { height: 6, borderRadius: 3 },
  passTabs: { padding: 4, borderRadius: 13, flexDirection: 'row', gap: 4 },
  passTab: { flex: 1, minHeight: 40, borderRadius: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  passTabText: { fontFamily: 'Orbitron', fontSize: 7.5, fontWeight: '900', letterSpacing: .5 },
  passLevels: { gap: 9, paddingVertical: 3, paddingRight: 5 },
  passLevelCard: { width: 190, minHeight: 230, padding: 10, borderWidth: 1, borderRadius: 15 },
  passNumber: { fontFamily: 'Orbitron', fontSize: 18, fontWeight: '900' },
  passXp: { fontFamily: 'Orbitron', fontSize: 6.5, marginTop: 2, marginBottom: 8 },
  passLane: { minHeight: 79, padding: 7, borderTopWidth: 1 },
  passLaneLabel: { fontFamily: 'Orbitron', fontSize: 6, fontWeight: '900', marginBottom: 5 },
  passReward: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 4 },
  passRewardName: { fontFamily: 'Satoshi', fontSize: 9, fontWeight: '700', textAlign: 'center' },
  passClaim: { paddingHorizontal: 8, paddingVertical: 5, borderRadius: 7 },
  passState: { fontFamily: 'Orbitron', fontSize: 5.5, fontWeight: '900' },
  passEmpty: { fontFamily: 'Satoshi', fontSize: 9, textAlign: 'center', marginTop: 12 },
  passAddress: { padding: 10, borderWidth: 1, borderRadius: 13, gap: 7 },
  passInput: { height: 40, paddingHorizontal: 10, borderWidth: 1, borderRadius: 9, fontFamily: 'Satoshi' },
  passMissions: { gap: 9 },
  missionPeriods: { flexDirection: 'row', gap: 6 },
  missionPeriod: { flex: 1, minHeight: 35, borderWidth: 1, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  missionPeriodText: { fontFamily: 'Orbitron', fontSize: 6.5, fontWeight: '900', letterSpacing: .35 },
  missionCard: { padding: 11, borderWidth: 1, borderRadius: 13, gap: 9 },
  missionHead: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  missionIcon: { width: 39, height: 39, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  missionTitle: { fontFamily: 'Orbitron', fontSize: 8.5, fontWeight: '900' },
  missionMeta: { fontFamily: 'Satoshi', fontSize: 9.5, marginTop: 3 },
  missionXp: { fontFamily: 'Orbitron', fontSize: 7, fontWeight: '900', textAlign: 'right', maxWidth: 84 },
  missionProgress: { height: 5, borderRadius: 3, overflow: 'hidden' },
  missionProgressFill: { height: 5, borderRadius: 3 },
  missionFoot: { fontFamily: 'Satoshi', fontSize: 9 },
  missionReset: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  missionHint: { fontFamily: 'Orbitron', fontSize: 6.5, fontWeight: '900', letterSpacing: .5 },
  missionResetText: { fontFamily: 'Orbitron', fontSize: 6.5, fontWeight: '900' },
  missionEmoji: { fontSize: 24 },
});
