import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  RefreshControl,
  ScrollView,
  Share,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { API_URL } from '../../constants/config';
import { useTheme } from '../../contexts/ThemeContext';
import { useScreenHeaderTop } from '../../lib/screenHeaderInsets';

type PremiumSource = { type: 'welcome' | 'admin' | 'purchase'; expiresAt?: string | null; plan?: string | null };
type Invitee = {
  id: string;
  status: 'valid' | 'invalid';
  invalidReason?: string | null;
  attributedAt: string;
  hasPaidSpend: boolean;
  user: { id: number; username: string; avatarUrl?: string | null; premiumSources: PremiumSource[] } | null;
};

const getToken = async () => (
  (await AsyncStorage.getItem('userToken')) ?? (await AsyncStorage.getItem('token'))
);

const money = (value: number) => `${(Number(value || 0) / 100).toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} zł`;

async function api(path: string, init: RequestInit = {}) {
  const token = await getToken();
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers || {}),
    },
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(json?.error || 'Operacja nie powiodła się');
  return json;
}

export default function ReferralProgramScreen() {
  const router = useRouter();
  const { theme } = useTheme();
  const top = useScreenHeaderTop(8);
  const [dashboard, setDashboard] = useState<any>(null);
  const [invitees, setInvitees] = useState<Invitee[]>([]);
  const [inviteePage, setInviteePage] = useState(1);
  const [inviteePages, setInviteePages] = useState(1);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showPayout, setShowPayout] = useState(false);
  const [beneficiaryName, setBeneficiaryName] = useState('');
  const [iban, setIban] = useState('');
  const [payoutAmount, setPayoutAmount] = useState('');

  const load = useCallback(async (silent = false) => {
    silent ? setRefreshing(true) : setLoading(true);
    try {
      const [dashboardJson, inviteesJson] = await Promise.all([
        api('/api/referral/dashboard'),
        api('/api/referral/invitees?limit=50'),
      ]);
      setDashboard(dashboardJson);
      setInvitees(inviteesJson.items || []);
      setInviteePage(inviteesJson.page || 1);
      setInviteePages(inviteesJson.pages || 1);
      setBeneficiaryName(dashboardJson.payoutProfile?.beneficiaryName || '');
    } catch (error) {
      Alert.alert('Program poleceń', error instanceof Error ? error.message : 'Nie udało się pobrać danych');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const loadMoreInvitees = async () => {
    if (loadingMore || inviteePage >= inviteePages) return;
    setLoadingMore(true);
    try {
      const nextPage = inviteePage + 1;
      const json = await api(`/api/referral/invitees?limit=50&page=${nextPage}`);
      setInvitees((current) => [...current, ...(json.items || [])]);
      setInviteePage(json.page || nextPage);
      setInviteePages(json.pages || inviteePages);
    } catch (error) {
      Alert.alert('Lista zaproszonych', error instanceof Error ? error.message : 'Nie udało się pobrać kolejnej strony');
    } finally { setLoadingMore(false); }
  };

  const progress = useMemo(() => {
    if (!dashboard?.nextTier) return 100;
    const previous = dashboard.currentTier?.inviteCount || 0;
    const span = Math.max(1, dashboard.nextTier.inviteCount - previous);
    return Math.max(0, Math.min(100, ((dashboard.qualifiedCount - previous) / span) * 100));
  }, [dashboard]);

  const saveProfile = async () => {
    if (!beneficiaryName.trim() || !iban.trim()) return Alert.alert('Dane wypłaty', 'Uzupełnij odbiorcę i IBAN.');
    setSaving(true);
    try {
      await api('/api/referral/payout-profile', { method: 'PUT', body: JSON.stringify({ beneficiaryName, iban }) });
      setIban('');
      await load(true);
      Alert.alert('Gotowe', 'Dane do wypłaty zostały zapisane.');
    } catch (error) {
      Alert.alert('Dane wypłaty', error instanceof Error ? error.message : 'Nie udało się zapisać danych');
    } finally { setSaving(false); }
  };

  const requestPayout = async () => {
    const value = Math.round(Number(payoutAmount.replace(',', '.')) * 100);
    if (!Number.isFinite(value) || value <= 0) return Alert.alert('Wypłata', 'Podaj poprawną kwotę.');
    setSaving(true);
    try {
      await api('/api/referral/payouts', {
        method: 'POST',
        body: JSON.stringify({ amount: value, requestKey: `mobile-${Date.now()}` }),
      });
      setPayoutAmount('');
      await load(true);
      Alert.alert('Wniosek wysłany', 'Wypłata trafiła do zatwierdzenia.');
    } catch (error) {
      Alert.alert('Wypłata', error instanceof Error ? error.message : 'Nie udało się wysłać wniosku');
    } finally { setSaving(false); }
  };

  const cancelPayout = async (payoutId: string) => {
    setSaving(true);
    try {
      await api(`/api/referral/payouts/${payoutId}/cancel`, { method: 'POST' });
      await load(true);
    } catch (error) {
      Alert.alert('Wypłata', error instanceof Error ? error.message : 'Nie udało się anulować wniosku');
    } finally { setSaving(false); }
  };

  if (loading || !dashboard) {
    return <View style={{ flex: 1, backgroundColor: theme.bg, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color={theme.primary} /></View>;
  }

  const card = { backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border, borderRadius: 18 } as const;
  const premiumLabel = (source: PremiumSource) => source.type === 'welcome' ? 'POWITALNE' : source.type === 'admin' ? 'PANEL' : source.plan ? `KUPIONE · ${String(source.plan).toUpperCase()}` : 'KUPIONE';

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <View style={{ paddingTop: top, paddingHorizontal: 16, paddingBottom: 13, borderBottomWidth: 1, borderBottomColor: theme.border, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <TouchableOpacity onPress={() => router.back()} style={{ width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border }}><MaterialIcons name="arrow-back" size={22} color={theme.text} /></TouchableOpacity>
        <View style={{ flex: 1 }}><Text style={{ color: theme.text, fontFamily: 'Orbitron', fontWeight: '900', fontSize: 15, letterSpacing: 1.5 }}>PROGRAM POLECEŃ</Text><Text style={{ color: theme.textDim, marginTop: 3, fontSize: 11 }}>{dashboard.qualifiedCount} ważnych zaproszeń</Text></View>
      </View>

      <ScrollView refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor={theme.primary} />} contentContainerStyle={{ padding: 16, paddingBottom: 44, gap: 14 }}>
        <View style={{ ...card, padding: 16 }}>
          <Text style={{ color: theme.textDim, fontFamily: 'Orbitron', fontSize: 8, letterSpacing: 1.5 }}>TWÓJ KOD</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8, gap: 10 }}>
            <Text selectable style={{ flex: 1, color: theme.primary, fontFamily: 'Orbitron', fontWeight: '900', fontSize: 22, letterSpacing: 2 }}>{dashboard.code}</Text>
            <TouchableOpacity onPress={() => void Share.share({ message: `Dołącz do VROOM z moim kodem ${dashboard.code}: ${dashboard.link}` })} style={{ padding: 10, borderRadius: 11, backgroundColor: `${theme.primary}20` }}><MaterialIcons name="share" size={20} color={theme.primary} /></TouchableOpacity>
          </View>
        </View>

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
          {[
            ['NALICZONE', dashboard.balances.earned], ['DOSTĘPNE', dashboard.balances.available],
            ['W TRAKCIE', dashboard.balances.reserved], ['WYPŁACONE', dashboard.balances.paid],
          ].map(([label, value]) => <View key={String(label)} style={{ ...card, width: '48%', padding: 14 }}><Text style={{ color: theme.textDim, fontFamily: 'Orbitron', fontSize: 7, letterSpacing: 1.3 }}>{label}</Text><Text style={{ color: Number(value) < 0 ? '#ff5368' : theme.text, fontFamily: 'Orbitron', fontWeight: '900', fontSize: 16, marginTop: 8 }}>{money(Number(value))}</Text></View>)}
        </View>

        <View style={{ ...card, padding: 16 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 10 }}><Text style={{ color: theme.text, fontWeight: '800' }}>{dashboard.currentTier ? `Próg ${dashboard.currentTier.inviteCount}` : 'Start programu'}</Text><Text style={{ color: theme.primary, fontWeight: '800' }}>{dashboard.nextTier ? `Następny: ${dashboard.nextTier.inviteCount}` : 'Najwyższy próg'}</Text></View>
          <View style={{ height: 8, borderRadius: 5, backgroundColor: theme.border, marginTop: 12, overflow: 'hidden' }}><View style={{ height: '100%', width: `${progress}%`, backgroundColor: theme.primary, borderRadius: 5 }} /></View>
          {!!dashboard.nextTier && <Text style={{ color: theme.textDim, fontSize: 11, marginTop: 9 }}>Do kolejnego progu brakuje {Math.max(0, dashboard.nextTier.inviteCount - dashboard.qualifiedCount)} osób · łączny zarobek {money(dashboard.nextTier.targetAmount)}</Text>}
        </View>

        <View style={{ ...card, overflow: 'hidden' }}>
          <TouchableOpacity onPress={() => setShowPayout((value) => !value)} style={{ padding: 16, flexDirection: 'row', alignItems: 'center', gap: 10 }}><MaterialCommunityIcons name="bank-transfer" size={24} color={theme.primary} /><View style={{ flex: 1 }}><Text style={{ color: theme.text, fontWeight: '800' }}>Wypłata środków</Text><Text style={{ color: theme.textDim, fontSize: 11, marginTop: 2 }}>Minimum {money(dashboard.payoutMinimum)}</Text></View><MaterialIcons name={showPayout ? 'expand-less' : 'expand-more'} size={22} color={theme.textDim} /></TouchableOpacity>
          {showPayout && <View style={{ padding: 16, paddingTop: 0, gap: 10 }}>
            <TextInput value={beneficiaryName} onChangeText={setBeneficiaryName} placeholder="Nazwa odbiorcy" placeholderTextColor={theme.textDim} style={{ color: theme.text, backgroundColor: theme.bg, borderWidth: 1, borderColor: theme.border, borderRadius: 12, padding: 12 }} />
            <TextInput value={iban} onChangeText={setIban} autoCapitalize="characters" placeholder={dashboard.payoutProfile?.ibanMasked || 'IBAN'} placeholderTextColor={theme.textDim} style={{ color: theme.text, backgroundColor: theme.bg, borderWidth: 1, borderColor: theme.border, borderRadius: 12, padding: 12 }} />
            <TouchableOpacity disabled={saving} onPress={() => void saveProfile()} style={{ padding: 12, borderRadius: 12, alignItems: 'center', borderWidth: 1, borderColor: theme.border }}><Text style={{ color: theme.text, fontWeight: '800' }}>ZAPISZ DANE</Text></TouchableOpacity>
            <TextInput value={payoutAmount} onChangeText={setPayoutAmount} keyboardType="decimal-pad" placeholder="Kwota wypłaty w PLN" placeholderTextColor={theme.textDim} style={{ color: theme.text, backgroundColor: theme.bg, borderWidth: 1, borderColor: theme.border, borderRadius: 12, padding: 12 }} />
            <TouchableOpacity disabled={saving || dashboard.balances.available <= 0} onPress={() => void requestPayout()} style={{ padding: 13, borderRadius: 12, alignItems: 'center', backgroundColor: theme.primary, opacity: saving || dashboard.balances.available <= 0 ? 0.5 : 1 }}><Text style={{ color: '#fff', fontWeight: '900' }}>ZŁÓŻ WNIOSEK</Text></TouchableOpacity>
          </View>}
        </View>

        {!!dashboard.ledger?.length && <View style={{ ...card, padding: 16 }}>
          <Text style={{ color: theme.text, fontFamily: 'Orbitron', fontWeight: '800', fontSize: 10, letterSpacing: 1.3 }}>HISTORIA SALDA</Text>
          {dashboard.ledger.slice(0, 8).map((entry: any) => <View key={entry.id} style={{ flexDirection: 'row', gap: 10, paddingTop: 11, marginTop: 11, borderTopWidth: 1, borderTopColor: theme.border }}><View style={{ flex: 1 }}><Text style={{ color: theme.text, fontWeight: '700', fontSize: 12 }}>{entry.type === 'award' || entry.type === 'opening' ? 'Nagroda za próg' : entry.type === 'correction' ? 'Korekta zaproszeń' : entry.type === 'payout_reserve' ? 'Rezerwacja wypłaty' : entry.type === 'payout_release' ? 'Zwolnienie rezerwacji' : entry.type}</Text><Text style={{ color: theme.textDim, fontSize: 9, marginTop: 3 }}>{new Date(entry.createdAt).toLocaleDateString('pl-PL')}</Text></View><Text style={{ color: Number(entry.amount) < 0 ? '#ff5368' : '#4de926', fontWeight: '900' }}>{Number(entry.amount) > 0 ? '+' : ''}{money(entry.amount)}</Text></View>)}
        </View>}

        {!!dashboard.payouts?.length && <View style={{ ...card, padding: 16 }}>
          <Text style={{ color: theme.text, fontFamily: 'Orbitron', fontWeight: '800', fontSize: 10, letterSpacing: 1.3 }}>HISTORIA WYPŁAT</Text>
          {dashboard.payouts.slice(0, 8).map((payout: any) => <View key={payout.id} style={{ flexDirection: 'row', gap: 10, paddingTop: 11, marginTop: 11, borderTopWidth: 1, borderTopColor: theme.border, alignItems: 'center' }}><View style={{ flex: 1 }}><Text style={{ color: theme.text, fontWeight: '700', fontSize: 12 }}>{payout.status === 'requested' ? 'Oczekuje' : payout.status === 'approved' ? 'Zatwierdzona' : payout.status === 'paid' ? 'Wypłacona' : payout.status === 'rejected' ? 'Odrzucona' : 'Anulowana'}</Text><Text style={{ color: theme.textDim, fontSize: 9, marginTop: 3 }}>{new Date(payout.requestedAt).toLocaleDateString('pl-PL')} · konto •••• {payout.ibanLast4}</Text></View><View style={{ alignItems: 'flex-end', gap: 5 }}><Text style={{ color: theme.text, fontWeight: '900' }}>{money(payout.amount)}</Text>{payout.status === 'requested' && <TouchableOpacity disabled={saving} onPress={() => void cancelPayout(payout.id)}><Text style={{ color: '#ff5368', fontSize: 9, fontWeight: '800' }}>ANULUJ</Text></TouchableOpacity>}</View></View>)}
        </View>}

        <Text style={{ color: theme.text, fontFamily: 'Orbitron', fontWeight: '800', fontSize: 11, letterSpacing: 1.5, marginTop: 4 }}>ZAPROSZENI ({dashboard.qualifiedCount})</Text>
        {invitees.length === 0 ? <View style={{ ...card, padding: 24, alignItems: 'center' }}><Text style={{ color: theme.textDim }}>Nikt jeszcze nie użył Twojego kodu.</Text></View> : invitees.map((item) => (
          <TouchableOpacity key={item.id} disabled={!item.user} onPress={() => item.user && router.push(`/profile/${item.user.id}` as any)} style={{ ...card, padding: 13, flexDirection: 'row', gap: 11, alignItems: 'center', opacity: item.status === 'invalid' ? 0.55 : 1 }}>
            {item.user?.avatarUrl ? <Image source={{ uri: item.user.avatarUrl }} style={{ width: 46, height: 46, borderRadius: 14 }} contentFit="cover" /> : <View style={{ width: 46, height: 46, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.border }}><MaterialIcons name="person" size={23} color={theme.textDim} /></View>}
            <View style={{ flex: 1 }}><Text style={{ color: theme.text, fontWeight: '800' }}>{item.user?.username || 'Konto usunięte'}</Text><View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: 6 }}>{item.user?.premiumSources?.map((source, index) => <Text key={`${source.type}-${index}`} style={{ color: source.type === 'purchase' ? '#ffd166' : source.type === 'welcome' ? '#4de926' : '#7bb6ff', backgroundColor: theme.bg, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 3, fontSize: 8, fontWeight: '800' }}>{premiumLabel(source)}</Text>)}{!item.user?.premiumSources?.length && <Text style={{ color: theme.textDim, fontSize: 9 }}>Bez premium</Text>}</View></View>
            <View style={{ alignItems: 'flex-end', gap: 5 }}><MaterialCommunityIcons name={item.hasPaidSpend ? 'cash-check' : 'cash-remove'} size={20} color={item.hasPaidSpend ? '#4de926' : theme.textDim} /><Text style={{ color: item.hasPaidSpend ? '#4de926' : theme.textDim, fontSize: 8 }}>{item.hasPaidSpend ? 'ZAPŁACIŁ' : 'BRAK PŁATNOŚCI'}</Text></View>
          </TouchableOpacity>
        ))}
        {inviteePage < inviteePages && <TouchableOpacity disabled={loadingMore} onPress={() => void loadMoreInvitees()} style={{ ...card, padding: 14, alignItems: 'center', opacity: loadingMore ? 0.65 : 1 }}>{loadingMore ? <ActivityIndicator color={theme.primary} /> : <Text style={{ color: theme.primary, fontWeight: '900' }}>POKAŻ KOLEJNYCH ZAPROSZONYCH</Text>}</TouchableOpacity>}
      </ScrollView>
    </View>
  );
}
