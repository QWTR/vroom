import React, { useCallback, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, TouchableOpacity, View } from 'react-native';
import { AppText as Text, AppTextInput as TextInput } from '../../../components/ui/AppText';
import { useFocusEffect, useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Toast from 'react-native-toast-message';
import { API_URL } from '../../../constants/config';
import { useTheme } from '../../../contexts/ThemeContext';
import { CommunityScreenHeader } from '../../../components/community';

const money = (grosze: number) => `${(grosze / 100).toFixed(2)} PLN`;

export default function MarketWalletScreen() {
  const { theme } = useTheme();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [wallet, setWallet] = useState<any>(null);
  const [profile, setProfile] = useState<any>(null);
  const [withdrawals, setWithdrawals] = useState<any[]>([]);
  const [entries, setEntries] = useState<any[]>([]);
  const [limits, setLimits] = useState({ withdrawalMin: 5000 });
  const [beneficiaryName, setBeneficiaryName] = useState('');
  const [iban, setIban] = useState('');
  const [amount, setAmount] = useState('');
  const [saving, setSaving] = useState(false);

  const getToken = async () =>
    (await AsyncStorage.getItem('userToken')) ?? (await AsyncStorage.getItem('token')) ?? '';

  const load = useCallback(async () => {
    try {
      const token = await getToken();
      const res = await fetch(`${API_URL}/api/market/wallet`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Błąd');
      setWallet(data.wallet);
      setProfile(data.payoutProfile);
      setWithdrawals(data.withdrawals || []);
      setEntries(data.entries || []);
      setLimits(data.limits || { withdrawalMin: 5000 });
      if (data.payoutProfile?.beneficiaryName) setBeneficiaryName(data.payoutProfile.beneficiaryName);
    } catch (e: any) {
      Toast.show({ type: 'error', text1: e.message } as never);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => {
    setLoading(true);
    void load();
  }, [load]));

  const saveProfile = async () => {
    setSaving(true);
    try {
      const token = await getToken();
      const res = await fetch(`${API_URL}/api/market/wallet/payout-profile`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ beneficiaryName, iban }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Błąd');
      setProfile(data.payoutProfile);
      setIban('');
      Toast.show({ type: 'success', text1: 'Zapisano rachunek' } as never);
    } catch (e: any) {
      Toast.show({ type: 'error', text1: e.message } as never);
    } finally {
      setSaving(false);
    }
  };

  const requestWithdrawal = async () => {
    const grosze = Math.round(Number(String(amount).replace(',', '.')) * 100);
    if (!Number.isFinite(grosze) || grosze <= 0) {
      Toast.show({ type: 'error', text1: 'Podaj kwotę' } as never);
      return;
    }
    setSaving(true);
    try {
      const token = await getToken();
      const res = await fetch(`${API_URL}/api/market/wallet/withdrawals`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: grosze }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Błąd');
      setAmount('');
      Toast.show({ type: 'success', text1: 'Wniosek o wypłatę wysłany' } as never);
      void load();
    } catch (e: any) {
      Toast.show({ type: 'error', text1: e.message } as never);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.background, justifyContent: 'center' }}>
        <ActivityIndicator color={theme.primary} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <CommunityScreenHeader title="Portfel giełdy" subtitle="Zarobki z escrow" onBack={() => router.back()} />
      <ScrollView
        contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} tintColor={theme.primary} />}
      >
        <View style={{ flexDirection: 'row', gap: 10 }}>
          {[
            { label: 'Dostępne', value: wallet?.availableAmount || 0 },
            { label: 'Escrow', value: wallet?.pendingAmount || 0 },
            { label: 'Wypłaty', value: wallet?.reservedAmount || 0 },
          ].map((card) => (
            <View key={card.label} style={{ flex: 1, backgroundColor: theme.surface, borderRadius: 12, borderWidth: 1, borderColor: theme.border, padding: 12 }}>
              <Text style={{ color: theme.textDim, fontSize: 12 }}>{card.label}</Text>
              <Text style={{ color: theme.text, fontFamily: 'Manrope_600SemiBold', fontSize: 13, marginTop: 6 }}>{money(card.value)}</Text>
            </View>
          ))}
        </View>

        <View style={{ backgroundColor: theme.surface, borderRadius: 14, borderWidth: 1, borderColor: theme.border, padding: 14, gap: 10 }}>
          <Text style={{ color: theme.text, fontFamily: 'Manrope_600SemiBold', fontSize: 12 }}>Rachunek IBAN</Text>
          {profile && (
            <Text style={{ color: theme.textDim, fontSize: 12 }}>
              {profile.beneficiaryName} · {profile.ibanMasked}
            </Text>
          )}
          <TextInput
            placeholder="Imię i nazwisko / firma"
            placeholderTextColor={theme.textDim}
            value={beneficiaryName}
            onChangeText={setBeneficiaryName}
            style={{ backgroundColor: theme.surface2, color: theme.text, borderRadius: 10, padding: 12 }}
          />
          <TextInput
            placeholder="IBAN"
            placeholderTextColor={theme.textDim}
            value={iban}
            onChangeText={setIban}
            autoCapitalize="characters"
            style={{ backgroundColor: theme.surface2, color: theme.text, borderRadius: 10, padding: 12 }}
          />
          <TouchableOpacity
            onPress={saveProfile}
            disabled={saving}
            style={{ backgroundColor: theme.primary, borderRadius: 10, paddingVertical: 12, alignItems: 'center' }}
          >
            <Text style={{ color: '#fff', fontFamily: 'Manrope_600SemiBold', fontSize: 12, fontWeight: '700' }}>
              {saving ? '...' : 'ZAPISZ RACHUNEK'}
            </Text>
          </TouchableOpacity>
        </View>

        <View style={{ backgroundColor: theme.surface, borderRadius: 14, borderWidth: 1, borderColor: theme.border, padding: 14, gap: 10 }}>
          <Text style={{ color: theme.text, fontFamily: 'Manrope_600SemiBold', fontSize: 12 }}>
            Wypłata (min. {money(limits.withdrawalMin)})
          </Text>
          <TextInput
            placeholder="Kwota PLN"
            placeholderTextColor={theme.textDim}
            value={amount}
            onChangeText={setAmount}
            keyboardType="decimal-pad"
            style={{ backgroundColor: theme.surface2, color: theme.text, borderRadius: 10, padding: 12 }}
          />
          <TouchableOpacity
            onPress={requestWithdrawal}
            disabled={saving}
            style={{ backgroundColor: '#268bff', borderRadius: 10, paddingVertical: 12, alignItems: 'center' }}
          >
            <Text style={{ color: '#fff', fontFamily: 'Manrope_600SemiBold', fontSize: 12, fontWeight: '700' }}>WNIOSEK O WYPŁATĘ</Text>
          </TouchableOpacity>
        </View>

        {withdrawals.length > 0 && (
          <View style={{ gap: 8 }}>
            <Text style={{ color: theme.textDim, fontFamily: 'Manrope_600SemiBold', fontSize: 12 }}>WYPŁATY</Text>
            {withdrawals.map((w) => (
              <View key={w.id} style={{ backgroundColor: theme.surface, borderRadius: 10, padding: 12, borderWidth: 1, borderColor: theme.border }}>
                <Text style={{ color: theme.text }}>{money(w.amount)} · {w.status}</Text>
                <Text style={{ color: theme.textDim, fontSize: 12 }}>•••• {w.ibanLast4}</Text>
              </View>
            ))}
          </View>
        )}

        {entries.length > 0 && (
          <View style={{ gap: 8 }}>
            <Text style={{ color: theme.textDim, fontFamily: 'Manrope_600SemiBold', fontSize: 12 }}>HISTORIA</Text>
            {entries.slice(0, 15).map((e) => (
              <View key={e.id} style={{ backgroundColor: theme.surface, borderRadius: 10, padding: 12, borderWidth: 1, borderColor: theme.border }}>
                <Text style={{ color: theme.text, fontSize: 12 }}>{e.description || e.type}</Text>
                <Text style={{ color: theme.textDim, fontSize: 12 }}>
                  avail {e.availableDelta} · pend {e.pendingDelta} · res {e.reservedDelta}
                </Text>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}
