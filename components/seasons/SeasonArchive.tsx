import React, { useCallback, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { AppText as Text, AppTextInput as TextInput } from '../ui/AppText';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect, useRouter } from 'expo-router';
import { useTheme } from '../../contexts/ThemeContext';
import { useScreenHeaderTop } from '../../lib/screenHeaderInsets';
import { API_URL } from '../../constants/config';

type Stats = Record<string, number | null>;
type Season = { id: string; name: string; kind: string; status: string; startsAt: string; endsAt: string; current?: boolean; splits: Season[]; achievementDefinitions?: { id: string; label: string; icon: string }[] };
type Grant = { id: string; rewardId: string; levelNumber?: number; status: string; claimBy: string | null; reward: { name: string }; kind: 'pass' | 'ranking' };
type Details = { season: Season; stats: Stats | null; ranking: { users: { id: number; username: string; position: number; score: number }[]; myPosition: number | null } | null; passRewards: Grant[]; rankingRewards: Grant[]; unlocks: { definitionId: string }[] };
const dates = (value: string) => new Date(value).toLocaleDateString('pl-PL', { timeZone: 'Europe/Warsaw' });
const deadline = (value: string) => new Date(value).toLocaleString('pl-PL', { timeZone: 'Europe/Warsaw' });
const blankAddress = { fullName: '', phone: '', street: '', postalCode: '', city: '', country: 'Polska' };
const labels: Record<string, string> = { fullName: 'Imię i nazwisko', phone: 'Telefon', street: 'Ulica i numer', postalCode: 'Kod pocztowy', city: 'Miasto', country: 'Kraj' };
const metrics = [['points', 'Punkty'], ['distanceKm', 'Kilometry'], ['ridesCount', 'Przejazdy'], ['driveSeconds', 'Czas jazdy'], ['maxSpeed', 'Maks. km/h'], ['maxStreak', 'Najlepsza seria'], ['spotsCreated', 'Spoty'], ['citiesDiscovered', 'Miasta'], ['meetsJoined', 'Spotkania'], ['achievementsUnlocked', 'Osiągnięcia']];
const statuses: Record<string, string> = { available: 'Do odbioru', granted: 'Odebrano', expired: 'Termin minął', revoked: 'Cofnięto', processing: 'Przetwarzanie', address_submitted: 'Dane wysłane', awaiting_claim: 'W realizacji', preparing: 'Przygotowanie', shipped: 'Wysłano', delivered: 'Dostarczono', problem: 'Ponów odbiór' };

export default function SeasonArchive() {
  const { theme } = useTheme(); const router = useRouter(); const top = useScreenHeaderTop(8);
  const [seasons, setSeasons] = useState<Season[]>([]); const [details, setDetails] = useState<Details | null>(null);
  const [trail, setTrail] = useState<string[]>([]); const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState(''); const [busy, setBusy] = useState('');
  const [addressGrant, setAddressGrant] = useState<Grant | null>(null); const [address, setAddress] = useState(blankAddress);
  const selectedId = trail[trail.length - 1];
  const api = useCallback(async (path: string, options?: RequestInit) => {
    const token = (await AsyncStorage.getItem('token')) ?? (await AsyncStorage.getItem('userToken'));
    const response = await fetch(`${API_URL}${path}`, { ...options, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
    const data = await response.json();
    if (!response.ok) throw Object.assign(new Error(data.error || 'Nie udało się pobrać danych'), { code: data.code });
    return data;
  }, []);
  const load = useCallback(async () => {
    setLoading(true); setMessage('');
    try { if (selectedId) setDetails(await api(`/api/seasons/archive/${selectedId}`)); else { setSeasons(await api('/api/seasons/archive')); setDetails(null); } }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Nie udało się pobrać sezonów'); }
    finally { setLoading(false); }
  }, [api, selectedId]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));
  const open = (id: string) => { setDetails(null); setAddressGrant(null); setTrail((old) => [...old, id]); };
  const back = () => { if (trail.length) { setDetails(null); setTrail((old) => old.slice(0, -1)); } else router.back(); };
  const claim = async (grant: Grant, withAddress = false) => {
    if (busy) return; setBusy(grant.id); setMessage('');
    try {
      await api(`/api/seasons/${grant.kind === 'pass' ? 'pass/' : ''}rewards/${grant.kind === 'pass' ? grant.rewardId : grant.id}/claim`, { method: 'POST', body: JSON.stringify(withAddress ? { shippingAddress: address } : {}) });
      setAddressGrant(null); setAddress(blankAddress); await load(); setMessage('Zapisano odbiór nagrody.');
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ADDRESS_REQUIRED') setAddressGrant(grant);
      else setMessage(error instanceof Error ? error.message : 'Nie udało się odebrać nagrody');
    } finally { setBusy(''); }
  };
  const statsGrid = (stats: Stats | null) => !stats ? <Text style={{ color: theme.textDim }}>Brak zapisanych statystyk tego okresu.</Text> : <View style={styles.grid}>{metrics.map(([key, label]) => {
    const value = stats[key];
    const formatted = value == null ? '—' : key === 'driveSeconds' ? `${Math.floor(value / 3600)} h ${Math.floor(value % 3600 / 60)} min` : value.toLocaleString('pl-PL', { maximumFractionDigits: 1 });
    return <View key={key} style={[styles.stat, { borderColor: theme.border, backgroundColor: theme.surface }]}><Text style={[styles.value, { color: theme.text }]}>{formatted}</Text><Text style={{ color: theme.textDim, fontSize: 12 }}>{label}</Text></View>;
  })}</View>;
  const card = (season: Season) => <TouchableOpacity testID={`season-${season.id}`} key={season.id} onPress={() => open(season.id)} style={[styles.card, { backgroundColor: theme.surface, borderColor: season.current ? theme.primary : theme.border }]}>
    <View style={styles.row}><MaterialCommunityIcons name={season.kind === 'beta' ? 'flag-checkered' : 'calendar-star'} size={27} color={theme.primary} /><Text style={[styles.title, { color: theme.text }]}>{season.name}</Text><MaterialCommunityIcons name="chevron-right" size={24} color={theme.textDim} /></View>
    <Text style={{ color: season.current ? theme.primary : theme.textDim }}>{season.current ? 'TRWA TERAZ' : season.status === 'scheduled' ? 'NADCHODZĄCY' : season.kind === 'beta' ? 'TWOJE POCZĄTKI W VROOM' : 'HISTORIA SEZONU'}</Text>
    <Text style={{ color: theme.textDim }}>{dates(season.startsAt)} – {dates(new Date(new Date(season.endsAt).getTime() - 1).toISOString())}</Text>
    {season.splits?.length ? <Text style={{ color: theme.textDim }}>{season.splits.map((split) => split.name).join(' · ')}</Text> : null}
  </TouchableOpacity>;
  const grants: Grant[] = details ? [...details.passRewards.map((g) => ({ ...g, kind: 'pass' as const })), ...details.rankingRewards.map((g) => ({ ...g, kind: 'ranking' as const }))] : [];
  return <View style={{ flex: 1, backgroundColor: theme.bg }}>
    <View style={[styles.header, { paddingTop: top, borderColor: theme.border }]}><TouchableOpacity accessibilityLabel="Wstecz" onPress={back}><MaterialCommunityIcons name="arrow-left" size={25} color={theme.text} /></TouchableOpacity><Text style={[styles.title, { color: theme.text }]}>{details?.season.name || 'Sezony'}</Text></View>
    <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={theme.primary} />}>
      {message ? <Text accessibilityRole="alert" style={{ color: theme.primary }}>{message}</Text> : null}
      {loading ? <ActivityIndicator color={theme.primary} /> : !selectedId ? <>
        <Text style={{ color: theme.textDim }}>Twoja historia VROOM — od bety do kolejnych sezonów. Statystyki całego konta pozostają zachowane.</Text>
        {[...seasons].sort((a, b) => Number(Boolean(b.current)) - Number(Boolean(a.current))).map(card)}
        {!seasons.length && <Text style={{ color: theme.textDim }}>Historia sezonów pojawi się tutaj.</Text>}
      </> : details ? <>
        {details.season.kind === 'beta' && <Text style={{ color: theme.textDim }}>{details.season.status === 'completed' ? 'Zapisane statystyki bety pozostają częścią całkowitego dorobku.' : 'Beta trwa do 1 października 2026. Jej końcowe statystyki zachowamy tutaj.'} „—” oznacza brak potwierdzonej wartości.</Text>}
        {statsGrid(details.stats)}{details.season.splits?.map(card)}
        {details.season.kind === 'split' && new Date(details.season.startsAt).getTime() <= Date.now() && new Date(details.season.endsAt).getTime() > Date.now() && <TouchableOpacity onPress={() => router.push('/seasons/current')} style={[styles.button, { backgroundColor: theme.primary }]}><Text style={styles.buttonText}>VROOM PASS I BIEŻĄCE NAGRODY</Text></TouchableOpacity>}
        {details.ranking && <><Text style={[styles.title, { color: theme.text }]}>Ranking · Twoje miejsce: {details.ranking.myPosition ? `#${details.ranking.myPosition}` : '—'}</Text>{details.ranking.users.map((user) => <Text key={user.id} style={{ color: theme.text }}>#{user.position} · {user.username} · {user.score} pkt</Text>)}</>}
        {!!details.season.achievementDefinitions?.length && <Text style={[styles.title, { color: theme.text }]}>Osiągnięcia</Text>}
        {details.season.achievementDefinitions?.map((item) => <Text key={item.id} style={{ color: theme.text }}>{item.icon} {item.label} {details.unlocks.some((u) => u.definitionId === item.id) ? '✓' : ''}</Text>)}
        {!!grants.length && <Text style={[styles.title, { color: theme.text }]}>Moje nagrody</Text>}
        {grants.map((grant) => {
          const canClaim = (grant.kind === 'pass' ? ['available', 'problem'] : ['awaiting_claim']).includes(grant.status) && (!grant.claimBy || new Date(grant.claimBy).getTime() > Date.now());
          return <View key={grant.id} style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}><Text style={[styles.value, { color: theme.text }]}>{grant.reward.name}</Text><Text style={{ color: theme.textDim }}>{statuses[grant.status] || grant.status}{grant.levelNumber ? ` · Poziom ${grant.levelNumber}` : ''}</Text>{grant.claimBy && <Text style={{ color: theme.textDim }}>Odbiór do {deadline(grant.claimBy)}</Text>}{canClaim && <TouchableOpacity disabled={Boolean(busy)} onPress={() => grant.kind === 'ranking' ? setAddressGrant(grant) : void claim(grant)} style={[styles.button, { backgroundColor: theme.primary }]}><Text style={styles.buttonText}>{busy === grant.id ? 'Odbieranie…' : 'Odbierz'}</Text></TouchableOpacity>}</View>;
        })}
        {addressGrant && <View style={[styles.card, { borderColor: theme.primary }]}><Text style={[styles.title, { color: theme.text }]}>Dane do wysyłki</Text>{Object.entries(address).map(([key, value]) => <TextInput key={key} value={value} onChangeText={(text) => setAddress((old) => ({ ...old, [key]: text }))} placeholder={labels[key]} placeholderTextColor={theme.textDim} style={[styles.input, { color: theme.text, borderColor: theme.border }]} />)}<TouchableOpacity disabled={Boolean(busy)} onPress={() => void claim(addressGrant, true)} style={[styles.button, { backgroundColor: theme.primary }]}><Text style={styles.buttonText}>Potwierdź dane</Text></TouchableOpacity><TouchableOpacity onPress={() => setAddressGrant(null)}><Text style={{ color: theme.textDim }}>Anuluj</Text></TouchableOpacity></View>}
      </> : null}
    </ScrollView>
  </View>;
}
const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 16, padding: 16, borderBottomWidth: 1 }, content: { padding: 16, paddingBottom: 60, gap: 16 },
  title: { fontSize: 19, fontWeight: '800', flexShrink: 1 }, row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  card: { borderWidth: 1, borderRadius: 18, padding: 18, gap: 10 }, grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  stat: { width: '48%', padding: 14, borderWidth: 1, borderRadius: 14, gap: 8 }, value: { fontSize: 17, fontWeight: '700' },
  button: { padding: 13, borderRadius: 12, alignItems: 'center' }, buttonText: { color: '#fff', fontWeight: '800' }, input: { borderWidth: 1, borderRadius: 10, padding: 12 },
});
