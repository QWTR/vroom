import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect, useRouter } from 'expo-router';
import { AppText as Text, AppTextInput as TextInput } from '../ui/AppText';
import { useTheme } from '../../contexts/ThemeContext';
import { useScreenHeaderTop } from '../../lib/screenHeaderInsets';
import { API_URL } from '../../constants/config';
import { withAlpha } from '../../constants/theme';
import { seasonRequest } from '../../lib/seasonApi';

type Stats = Record<string, number | null>;
type Season = { id: string; name: string; kind: string; status: string; calendarYear?: number | null; startsAt: string; endsAt: string; current?: boolean; splits?: Season[]; achievementDefinitions?: { id: string; label: string; icon: string }[] };
type Grant = { id: string; rewardId: string; levelNumber?: number; status: string; claimBy: string | null; reward: { name: string }; kind: 'pass' | 'ranking' };
type Details = { season: Season; stats: Stats | null; ranking: { users: { id: number; username: string; position: number; score: number }[]; myPosition: number | null } | null; passRewards: Grant[]; rankingRewards: Grant[]; unlocks: { definitionId: string }[] };

const date = (value: string | Date) => new Date(value).toLocaleDateString('pl-PL', { timeZone: 'Europe/Warsaw', day: 'numeric', month: 'short', year: 'numeric' }).replace('.', '');
const endDate = (value: string) => new Date(new Date(value).getTime() - 1);
const deadline = (value: string) => new Date(value).toLocaleString('pl-PL', { timeZone: 'Europe/Warsaw' });
const blankAddress = { fullName: '', phone: '', street: '', postalCode: '', city: '', country: 'Polska' };
const labels: Record<string, string> = { fullName: 'Imię i nazwisko', phone: 'Telefon', street: 'Ulica i numer', postalCode: 'Kod pocztowy', city: 'Miasto', country: 'Kraj' };
const metrics = [['points', 'Punkty'], ['distanceKm', 'Kilometry'], ['ridesCount', 'Przejazdy'], ['driveSeconds', 'Czas jazdy'], ['maxSpeed', 'Maks. prędkość'], ['maxStreak', 'Najlepsza seria'], ['spotsCreated', 'Spoty'], ['citiesDiscovered', 'Miasta'], ['meetsJoined', 'Spotkania'], ['achievementsUnlocked', 'Osiągnięcia']];
const statuses: Record<string, string> = { available: 'Do odbioru', granted: 'Odebrano', expired: 'Termin minął', revoked: 'Cofnięto', processing: 'Przetwarzanie', address_submitted: 'Dane wysłane', awaiting_claim: 'W realizacji', preparing: 'Przygotowanie', shipped: 'Wysłano', delivered: 'Dostarczono', problem: 'Ponów odbiór' };
const seasonOrder = (a: Season, b: Season) => (a.kind === 'beta' ? -1 : b.kind === 'beta' ? 1 : (a.calendarYear || 0) - (b.calendarYear || 0) || +new Date(a.startsAt) - +new Date(b.startsAt));
const isCurrent = (season: Season) => season.current ?? (+new Date(season.startsAt) <= Date.now() && +new Date(season.endsAt) > Date.now());

export default function SeasonArchive() {
  const { theme } = useTheme(); const router = useRouter(); const top = useScreenHeaderTop(8);
  const [seasons, setSeasons] = useState<Season[]>([]); const [details, setDetails] = useState<Details | null>(null);
  const [trail, setTrail] = useState<string[]>([]); const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState(''); const [loadFailed, setLoadFailed] = useState(false); const [busy, setBusy] = useState('');
  const [addressGrant, setAddressGrant] = useState<Grant | null>(null); const [address, setAddress] = useState(blankAddress);
  const selectedId = trail[trail.length - 1]; const hasContent = selectedId ? Boolean(details) : seasons.length > 0;
  const ordered = useMemo(() => [...seasons].sort(seasonOrder), [seasons]);

  const api = useCallback(async (path: string, options?: RequestInit) => {
    const token = (await AsyncStorage.getItem('userToken')) ?? (await AsyncStorage.getItem('token'));
    return seasonRequest(`${API_URL}${path}`, { ...options, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
  }, []);
  const load = useCallback(async () => {
    setLoading(true); setMessage(''); setLoadFailed(false);
    try {
      const payload = await api(selectedId ? `/api/seasons/archive/${selectedId}` : '/api/seasons/archive');
      if (selectedId) {
        if (!payload.season || !Array.isArray(payload.passRewards) || !Array.isArray(payload.rankingRewards) || !Array.isArray(payload.unlocks)) throw new Error('Nie udało się wczytać szczegółów sezonu.');
        setDetails(payload);
      } else {
        if (!Array.isArray(payload)) throw new Error('Nie udało się wczytać listy sezonów.');
        setSeasons(payload); setDetails(null);
      }
    } catch (error) { setLoadFailed(true); setMessage(error instanceof Error ? error.message : 'Nie udało się pobrać sezonów'); }
    finally { setLoading(false); }
  }, [api, selectedId]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));
  const open = (id: string) => { setDetails(null); setAddressGrant(null); setTrail((old) => [...old, id]); };
  const back = () => { if (trail.length) { setDetails(null); setMessage(''); setTrail((old) => old.slice(0, -1)); } else router.back(); };
  const claim = async (grant: Grant, withAddress = false) => {
    if (busy) return; setBusy(grant.id); setMessage('');
    try { await api(`/api/seasons/${grant.kind === 'pass' ? 'pass/' : ''}rewards/${grant.kind === 'pass' ? grant.rewardId : grant.id}/claim`, { method: 'POST', body: JSON.stringify(withAddress ? { shippingAddress: address } : {}) }); setAddressGrant(null); setAddress(blankAddress); await load(); setMessage('Nagroda została odebrana.'); }
    catch (error) { if (error instanceof Error && 'code' in error && error.code === 'ADDRESS_REQUIRED') setAddressGrant(grant); else setMessage(error instanceof Error ? error.message : 'Nie udało się odebrać nagrody'); }
    finally { setBusy(''); }
  };

  const seasonCard = (season: Season, index: number, total: number) => {
    const current = isCurrent(season); const beta = season.kind === 'beta';
    const splitNames = season.splits?.map((split) => split.name.replace(/\s+\d{4}$/, '')).join('  •  ');
    const state = current ? 'TRWA TERAZ' : season.status === 'scheduled' ? 'NADCHODZI' : 'ZAKOŃCZONY';
    return <View key={season.id} style={styles.timelineRow}>
      <View style={styles.rail}>{index > 0 && <View style={[styles.lineTop, { backgroundColor: theme.border2 }]} />}<View style={[styles.dot, { borderColor: current ? theme.primary : theme.border3, backgroundColor: current ? theme.primary : theme.surface2 }]}>{current && <View style={styles.dotCore} />}</View>{index < total - 1 && <View style={[styles.lineBottom, { backgroundColor: theme.border2 }]} />}</View>
      <TouchableOpacity testID={`season-${season.id}`} activeOpacity={.78} onPress={() => open(season.id)} style={[styles.card, { backgroundColor: theme.surface, borderColor: current ? withAlpha(theme.primary, '75') : theme.border2 }]}>
        {current && <LinearGradient colors={[withAlpha(theme.primary, '20'), 'transparent']} start={{ x: 0, y: 0 }} end={{ x: .8, y: 1 }} style={StyleSheet.absoluteFillObject} />}
        <View style={styles.cardTop}><View style={[styles.icon, { backgroundColor: current ? theme.primaryBg : theme.surface2 }]}><MaterialCommunityIcons name={beta ? 'flag-checkered' : 'calendar-star'} size={21} color={current ? theme.primaryText : theme.textDim} /></View><View style={styles.cardTitleWrap}><Text style={[styles.cardTitle, { color: theme.text }]}>{season.name}</Text><Text style={[styles.status, { color: current ? theme.primaryText : theme.textDim }]}>{state}</Text></View><View style={[styles.chevron, { backgroundColor: theme.surface2 }]}><MaterialCommunityIcons name="chevron-right" size={20} color={theme.text} /></View></View>
        <View style={[styles.divider, { backgroundColor: theme.border2 }]} /><View style={styles.meta}><MaterialCommunityIcons name="calendar-range" size={15} color={theme.textDim} /><Text style={[styles.cardDate, { color: theme.textSecondary }]}>{date(season.startsAt)} — {date(endDate(season.endsAt))}</Text></View>
        <Text numberOfLines={1} style={[styles.splits, { color: theme.textDim }]}>{splitNames || (beta ? 'Początek Twojej historii w VROOM' : 'Szczegóły sezonu')}</Text>
      </TouchableOpacity>
    </View>;
  };
  const statsGrid = (stats: Stats | null) => !stats ? <View style={[styles.softEmpty, { backgroundColor: theme.surface, borderColor: theme.border2 }]}><MaterialCommunityIcons name="chart-box-outline" size={28} color={theme.textDim} /><Text style={[styles.softEmptyText, { color: theme.textDim }]}>Statystyki pojawią się po pierwszej aktywności w tym okresie.</Text></View> : <View style={styles.grid}>{metrics.map(([key, label]) => { const value = stats[key]; const formatted = value == null ? '—' : key === 'driveSeconds' ? `${Math.floor(value / 3600)} h ${Math.floor(value % 3600 / 60)} min` : value.toLocaleString('pl-PL', { maximumFractionDigits: 1 }); return <View key={key} style={[styles.stat, { borderColor: theme.border2, backgroundColor: theme.surface }]}><Text style={[styles.value, { color: theme.text }]}>{formatted}</Text><Text style={[styles.statLabel, { color: theme.textDim }]}>{label}</Text></View>; })}</View>;
  const grants: Grant[] = details ? [...details.passRewards.map((g) => ({ ...g, kind: 'pass' as const })), ...details.rankingRewards.map((g) => ({ ...g, kind: 'ranking' as const }))] : [];

  return <View style={{ flex: 1, backgroundColor: theme.bg }}>
    <View style={[styles.header, { paddingTop: top, borderColor: theme.border }]}><TouchableOpacity accessibilityLabel="Wstecz" onPress={back} style={[styles.back, { backgroundColor: theme.surface, borderColor: theme.border2 }]}><MaterialCommunityIcons name="arrow-left" size={25} color={theme.text} /></TouchableOpacity><View><Text style={[styles.eyebrow, { color: theme.primaryText }]}>VROOM</Text><Text style={[styles.headerTitle, { color: theme.text }]}>{details?.season.name || 'Sezony'}</Text></View></View>
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} refreshControl={<RefreshControl refreshing={loading && hasContent} onRefresh={load} tintColor={theme.primary} />}>
      {message && hasContent ? <View style={[styles.notice, { backgroundColor: theme.primaryBg, borderColor: theme.primaryBorder }]}><MaterialCommunityIcons name="wifi-alert" size={17} color={theme.primaryText} /><Text style={[styles.noticeText, { color: theme.primaryText }]}>Nie udało się odświeżyć. Pokazujemy ostatnie dane.</Text><TouchableOpacity onPress={() => void load()}><MaterialCommunityIcons name="refresh" size={20} color={theme.primaryText} /></TouchableOpacity></View> : null}
      {loading && !hasContent ? <View style={styles.center}><ActivityIndicator color={theme.primary} /><Text style={[styles.loadingText, { color: theme.textDim }]}>ŁADOWANIE HISTORII</Text></View> : loadFailed && !hasContent ? <View style={styles.center}><View style={[styles.failureIcon, { backgroundColor: theme.primaryBg }]}><MaterialCommunityIcons name="cloud-refresh-outline" size={32} color={theme.primaryText} /></View><Text style={[styles.failureTitle, { color: theme.text }]}>Nie udało się odświeżyć</Text><Text style={[styles.failureText, { color: theme.textDim }]}>{message}</Text><TouchableOpacity onPress={() => void load()} style={[styles.retry, { borderColor: theme.primaryBorder2 }]}><MaterialCommunityIcons name="refresh" size={18} color={theme.primaryText} /><Text style={[styles.retryText, { color: theme.primaryText }]}>Spróbuj ponownie</Text></TouchableOpacity></View> : !selectedId ? <>
        <View style={styles.intro}><Text style={[styles.introTitle, { color: theme.text }]}>TWOJA HISTORIA VROOM</Text><Text style={[styles.introText, { color: theme.textDim }]}>Każdy sezon zostaje tutaj na stałe. Punkty konta, trasy i osiągnięcia nie znikają po zmianie splitu.</Text></View>
        <View>{ordered.map((season, index) => seasonCard(season, index, ordered.length))}</View>
      </> : details ? <>
        {details.season.kind === 'beta' && <View style={[styles.info, { backgroundColor: theme.surface, borderColor: theme.border2 }]}><MaterialCommunityIcons name="shield-check-outline" size={23} color={theme.primaryText} /><Text style={[styles.infoText, { color: theme.textDim }]}>{details.season.status === 'completed' ? 'To zachowane podsumowanie bety. Wyniki nadal należą do całkowitego dorobku konta.' : 'Beta trwa do 1 października 2026. Wtedy zapiszemy podsumowanie bez zerowania dorobku konta.'}</Text></View>}
        <SectionTitle label="TWOJE WYNIKI" theme={theme} />{statsGrid(details.stats)}
        {!!details.season.splits?.length && <><SectionTitle label="SPLITY" theme={theme} /><View>{[...details.season.splits].sort(seasonOrder).map((season, index, list) => seasonCard(season, index, list.length))}</View></>}
        {details.season.kind === 'split' && isCurrent(details.season) && <TouchableOpacity onPress={() => router.push('/seasons/current')} style={styles.passButton}><LinearGradient colors={[theme.primary, '#ad1715']} style={styles.passGradient}><MaterialCommunityIcons name="crown-outline" size={21} color="#fff" /><Text style={styles.passText}>VROOM PASS I NAGRODY</Text><MaterialCommunityIcons name="arrow-right" size={20} color="#fff" /></LinearGradient></TouchableOpacity>}
        {details.ranking && <><SectionTitle label={`RANKING${details.ranking.myPosition ? `  •  TWOJE MIEJSCE #${details.ranking.myPosition}` : ''}`} theme={theme} /><View style={[styles.ranking, { backgroundColor: theme.surface, borderColor: theme.border2 }]}>{details.ranking.users.map((user) => <View key={user.id} style={[styles.rankRow, { borderBottomColor: theme.border2 }]}><Text style={[styles.rankPosition, { color: user.position <= 3 ? theme.gold : theme.textDim }]}>#{user.position}</Text><Text style={[styles.rankName, { color: theme.text }]}>{user.username}</Text><Text style={[styles.rankScore, { color: theme.textSecondary }]}>{user.score.toLocaleString('pl-PL')} pkt</Text></View>)}</View></>}
        {!!details.season.achievementDefinitions?.length && <><SectionTitle label="OSIĄGNIĘCIA" theme={theme} />{details.season.achievementDefinitions.map((item) => <View key={item.id} style={[styles.achievement, { backgroundColor: theme.surface, borderColor: theme.border2 }]}><Text style={styles.achievementIcon}>{item.icon}</Text><Text style={[styles.rankName, { color: theme.text }]}>{item.label}</Text><MaterialCommunityIcons name={details.unlocks.some((u) => u.definitionId === item.id) ? 'check-decagram' : 'lock-outline'} size={20} color={details.unlocks.some((u) => u.definitionId === item.id) ? theme.primaryText : theme.textDim} /></View>)}</>}
        {!!grants.length && <SectionTitle label="MOJE NAGRODY" theme={theme} />}{grants.map((grant) => { const canClaim = (grant.kind === 'pass' ? ['available', 'problem'] : ['awaiting_claim']).includes(grant.status) && (!grant.claimBy || new Date(grant.claimBy).getTime() > Date.now()); return <View key={grant.id} style={[styles.reward, { backgroundColor: theme.surface, borderColor: theme.border2 }]}><View style={[styles.icon, { backgroundColor: theme.primaryBg }]}><MaterialCommunityIcons name="gift-outline" size={21} color={theme.primaryText} /></View><View style={styles.rewardBody}><Text style={[styles.rewardName, { color: theme.text }]}>{grant.reward.name}</Text><Text style={[styles.rewardMeta, { color: theme.textDim }]}>{statuses[grant.status] || grant.status}{grant.levelNumber ? `  •  Poziom ${grant.levelNumber}` : ''}</Text>{grant.claimBy && <Text style={[styles.rewardMeta, { color: theme.textDim }]}>Odbierz do {deadline(grant.claimBy)}</Text>}</View>{canClaim && <TouchableOpacity disabled={Boolean(busy)} onPress={() => grant.kind === 'ranking' ? setAddressGrant(grant) : void claim(grant)} style={[styles.claim, { backgroundColor: theme.primary }]}><Text style={styles.claimText}>{busy === grant.id ? '…' : 'ODBIERZ'}</Text></TouchableOpacity>}</View>; })}
        {addressGrant && <View style={[styles.address, { backgroundColor: theme.surface, borderColor: theme.primaryBorder2 }]}><Text style={[styles.sectionTitle, { color: theme.text }]}>DANE DO WYSYŁKI</Text>{Object.entries(address).map(([key, value]) => <TextInput key={key} value={value} onChangeText={(text) => setAddress((old) => ({ ...old, [key]: text }))} placeholder={labels[key]} placeholderTextColor={theme.textDim} style={[styles.input, { color: theme.text, borderColor: theme.border2, backgroundColor: theme.bgAlt }]} />)}<TouchableOpacity disabled={Boolean(busy)} onPress={() => void claim(addressGrant, true)} style={[styles.confirm, { backgroundColor: theme.primary }]}><Text style={styles.claimText}>POTWIERDŹ DANE</Text></TouchableOpacity><TouchableOpacity onPress={() => setAddressGrant(null)}><Text style={[styles.cancel, { color: theme.textDim }]}>Anuluj</Text></TouchableOpacity></View>}
      </> : null}
    </ScrollView>
  </View>;
}

function SectionTitle({ label, theme }: { label: string; theme: ReturnType<typeof useTheme>['theme'] }) { return <View style={styles.sectionHead}><Text style={[styles.sectionTitle, { color: theme.text }]}>{label}</Text><View style={[styles.sectionLine, { backgroundColor: theme.border2 }]} /></View>; }
const styles = StyleSheet.create({
  header: { minHeight: 96, flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 18, paddingBottom: 14, borderBottomWidth: 1 }, back: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center', borderWidth: 1 }, eyebrow: { fontSize: 10, fontWeight: '900', letterSpacing: 2.2 }, headerTitle: { fontSize: 22, fontWeight: '900' }, content: { paddingHorizontal: 18, paddingTop: 22, paddingBottom: 80, gap: 18 },
  intro: { gap: 8 }, introTitle: { fontSize: 12, fontWeight: '900', letterSpacing: 1.6 }, introText: { fontSize: 14, lineHeight: 21 }, timelineRow: { flexDirection: 'row', minHeight: 150 }, rail: { width: 28, alignItems: 'center' }, lineTop: { position: 'absolute', top: 0, width: 2, height: 20 }, lineBottom: { position: 'absolute', top: 34, bottom: 0, width: 2 }, dot: { marginTop: 20, width: 15, height: 15, borderRadius: 8, borderWidth: 2, alignItems: 'center', justifyContent: 'center', zIndex: 2 }, dotCore: { width: 5, height: 5, borderRadius: 3, backgroundColor: '#fff' },
  card: { flex: 1, minHeight: 128, marginBottom: 16, borderRadius: 20, borderWidth: 1, padding: 15, overflow: 'hidden' }, cardTop: { flexDirection: 'row', alignItems: 'center', gap: 11 }, icon: { width: 40, height: 40, borderRadius: 13, alignItems: 'center', justifyContent: 'center' }, cardTitleWrap: { flex: 1, gap: 2 }, cardTitle: { fontSize: 17, fontWeight: '900' }, status: { fontSize: 10, fontWeight: '900', letterSpacing: 1.1 }, chevron: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' }, divider: { height: 1, marginVertical: 12 }, meta: { flexDirection: 'row', alignItems: 'center', gap: 7 }, cardDate: { fontSize: 13, fontWeight: '600' }, splits: { marginTop: 8, fontSize: 12.5 },
  notice: { flexDirection: 'row', alignItems: 'center', gap: 9, padding: 12, borderRadius: 14, borderWidth: 1 }, noticeText: { flex: 1, fontSize: 12.5, fontWeight: '700' }, center: { minHeight: 360, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28, gap: 13 }, loadingText: { fontSize: 11, fontWeight: '900', letterSpacing: 1.6 }, failureIcon: { width: 64, height: 64, borderRadius: 22, alignItems: 'center', justifyContent: 'center' }, failureTitle: { fontSize: 18, fontWeight: '900', textAlign: 'center' }, failureText: { fontSize: 14, lineHeight: 21, textAlign: 'center' }, retry: { minHeight: 46, paddingHorizontal: 19, borderRadius: 14, borderWidth: 1, flexDirection: 'row', alignItems: 'center', gap: 8 }, retryText: { fontSize: 13, fontWeight: '900' },
  sectionHead: { marginTop: 5, flexDirection: 'row', alignItems: 'center', gap: 12 }, sectionTitle: { fontSize: 12, fontWeight: '900', letterSpacing: 1.4 }, sectionLine: { height: 1, flex: 1 }, info: { flexDirection: 'row', gap: 12, borderRadius: 18, borderWidth: 1, padding: 16 }, infoText: { flex: 1, fontSize: 13.5, lineHeight: 20 }, grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 }, stat: { width: '48.5%', minHeight: 84, padding: 14, borderWidth: 1, borderRadius: 17, justifyContent: 'center', gap: 5 }, value: { fontSize: 18, fontWeight: '900' }, statLabel: { fontSize: 11, fontWeight: '700' }, softEmpty: { minHeight: 120, borderRadius: 18, borderWidth: 1, alignItems: 'center', justifyContent: 'center', padding: 20, gap: 10 }, softEmptyText: { fontSize: 13, textAlign: 'center', lineHeight: 19 },
  passButton: { borderRadius: 17, overflow: 'hidden' }, passGradient: { minHeight: 54, paddingHorizontal: 17, flexDirection: 'row', alignItems: 'center', gap: 10 }, passText: { flex: 1, color: '#fff', fontSize: 13, fontWeight: '900' }, ranking: { borderRadius: 18, borderWidth: 1, overflow: 'hidden' }, rankRow: { minHeight: 50, paddingHorizontal: 15, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1 }, rankPosition: { width: 45, fontWeight: '900' }, rankName: { flex: 1, fontSize: 14, fontWeight: '800' }, rankScore: { fontSize: 12, fontWeight: '700' }, achievement: { minHeight: 58, borderRadius: 16, borderWidth: 1, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 11 }, achievementIcon: { fontSize: 23 },
  reward: { borderRadius: 17, borderWidth: 1, padding: 13, flexDirection: 'row', alignItems: 'center', gap: 11 }, rewardBody: { flex: 1, gap: 3 }, rewardName: { fontSize: 14, fontWeight: '800' }, rewardMeta: { fontSize: 11.5 }, claim: { minHeight: 38, paddingHorizontal: 12, borderRadius: 11, justifyContent: 'center' }, claimText: { color: '#fff', fontSize: 11, fontWeight: '900' }, address: { borderRadius: 20, borderWidth: 1, padding: 16, gap: 11 }, input: { minHeight: 48, borderWidth: 1, borderRadius: 13, paddingHorizontal: 13 }, confirm: { minHeight: 48, borderRadius: 13, alignItems: 'center', justifyContent: 'center' }, cancel: { textAlign: 'center', paddingVertical: 5, fontWeight: '700' },
});
