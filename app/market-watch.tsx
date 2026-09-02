import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Switch, TouchableOpacity, View } from 'react-native';
import { AppText as Text, AppTextInput as TextInput } from '../components/ui/AppText';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import Toast from 'react-native-toast-message';
import { useTheme } from '../contexts/ThemeContext';
import { apiRequest } from '../lib/api/client';
import { getPremiumCatalog } from '../lib/premiumV2';

type SavedSearch = { id: string; name: string; filters: { query?: string }; notificationsEnabled: boolean; updatedAt: string };
type Listing = { id: number; title?: string | null; brand?: string | null; model?: string | null; isPromoted?: boolean; promotedUntil?: string | null };
type ListingAnalytics = { uniqueViews: number; conversations: number; saves: number; priceHistory: Array<{ id: string; priceCents: number; createdAt: string }> };

export default function MarketWatchScreen() {
  const { theme } = useTheme();
  const router = useRouter();
  const [items, setItems] = useState<SavedSearch[]>([]);
  const [listings, setListings] = useState<Listing[]>([]);
  const [analytics, setAnalytics] = useState<Record<number, ListingAnalytics>>({});
  const [name, setName] = useState('');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState<number | null>(null);
  const [grants, setGrants] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [response, catalog, own] = await Promise.all([
        apiRequest<{ searches: SavedSearch[] }>('/market/watch/saved-searches'),
        getPremiumCatalog(true),
        apiRequest<Listing[]>('/market/user/my'),
      ]);
      setItems(response.searches);
      setGrants(catalog.market.availablePromoGrants);
      setListings(own);
    } catch (error: any) {
      Toast.show({ type: 'error', text1: 'Market Watch', text2: error?.message || 'Nie udało się pobrać danych.' });
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const create = async () => {
    if (!name.trim()) return;
    try {
      await apiRequest('/market/watch/saved-searches', { method: 'POST', body: { name: name.trim(), filters: { query: query.trim() }, notificationsEnabled: true } });
      setName(''); setQuery(''); await load();
    } catch (error: any) { Toast.show({ type: 'error', text1: 'Nie zapisano alertu', text2: error?.message }); }
  };
  const toggle = async (item: SavedSearch) => {
    await apiRequest(`/market/watch/saved-searches/${item.id}`, { method: 'PATCH', body: { notificationsEnabled: !item.notificationsEnabled } });
    setItems((list) => list.map((value) => value.id === item.id ? { ...value, notificationsEnabled: !value.notificationsEnabled } : value));
  };
  const remove = async (id: string) => {
    await apiRequest(`/market/watch/saved-searches/${id}`, { method: 'DELETE' });
    setItems((list) => list.filter((value) => value.id !== id));
  };
  const loadAnalytics = async (listingId: number) => {
    setWorking(listingId);
    try {
      const value = await apiRequest<ListingAnalytics>(`/market/${listingId}/analytics`);
      setAnalytics((current) => ({ ...current, [listingId]: value }));
    } finally { setWorking(null); }
  };
  const useCoupon = (listing: Listing) => Alert.alert(
    'Promuj przez 7 dni',
    `Wykorzystać miesięczny kupon na „${listing.title || `${listing.brand || ''} ${listing.model || ''}`.trim() || `Ogłoszenie #${listing.id}`}”?`,
    [{ text: 'Anuluj', style: 'cancel' }, { text: 'Wykorzystaj kupon', onPress: async () => {
      setWorking(listing.id);
      try {
        await apiRequest(`/market/${listing.id}/promote/coupon`, { method: 'POST' });
        Toast.show({ type: 'success', text1: 'Promocja aktywna przez 7 dni' });
        await load();
      } catch (error: any) { Toast.show({ type: 'error', text1: 'Nie wykorzystano kuponu', text2: error?.message }); }
      finally { setWorking(null); }
    } }],
  );

  return <SafeAreaView style={[styles.safe, { backgroundColor: theme.bg }]}>
    <View style={styles.header}><TouchableOpacity onPress={() => router.back()}><MaterialIcons name="arrow-back" size={24} color={theme.text} /></TouchableOpacity><Text style={[styles.title, { color: theme.text }]}>MARKET WATCH</Text><TouchableOpacity onPress={() => void load()}><MaterialIcons name="refresh" size={23} color={theme.text} /></TouchableOpacity></View>
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View style={[styles.coupon, { backgroundColor: theme.surface, borderColor: grants ? '#4de92655' : theme.border }]}><MaterialIcons name="local-offer" size={24} color={grants ? '#4de926' : theme.textDim} /><View style={{ flex: 1 }}><Text style={{ color: grants ? '#4de926' : theme.textDim, fontWeight: '900' }}>{grants ? `${grants} KUPON GOTOWY` : 'BRAK KUPONU'}</Text><Text style={{ color: theme.textDim, fontSize: 12, marginTop: 3 }}>Jeden opłacony miesiąc = jedna promocja ogłoszenia na 7 dni.</Text></View></View>
      <Text style={[styles.section, { color: theme.text }]}>ZAPISANE WYSZUKIWANIA</Text>
      <TextInput value={name} onChangeText={setName} placeholder="Nazwa wyszukiwania" placeholderTextColor={theme.textDim} style={[styles.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.surface }]} />
      <TextInput value={query} onChangeText={setQuery} placeholder="Marka, model lub fraza" placeholderTextColor={theme.textDim} style={[styles.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.surface }]} />
      <TouchableOpacity onPress={() => void create()} style={styles.primary}><Text style={styles.primaryText}>ZAPISZ I WŁĄCZ ALERTY</Text></TouchableOpacity>
      {loading ? <ActivityIndicator color="#FFD447" /> : items.map((item) => <View key={item.id} style={[styles.row, { backgroundColor: theme.surface, borderColor: theme.border }]}><View style={{ flex: 1 }}><Text style={{ color: theme.text, fontWeight: '800' }}>{item.name}</Text><Text style={{ color: theme.textDim, fontSize: 12, marginTop: 4 }}>{item.filters?.query || 'Wszystkie dopasowania'}</Text></View><Switch value={item.notificationsEnabled} onValueChange={() => void toggle(item)} trackColor={{ true: '#FFD447' }} /><TouchableOpacity onPress={() => void remove(item.id)}><MaterialIcons name="delete-outline" size={22} color="#ff6b6b" /></TouchableOpacity></View>)}
      <Text style={[styles.section, { color: theme.text, marginTop: 14 }]}>TWOJE OGŁOSZENIA</Text>
      {!loading && !listings.length && <Text style={{ color: theme.textDim }}>Nie masz jeszcze ogłoszeń.</Text>}
      {listings.map((listing) => { const insight = analytics[listing.id]; return <View key={listing.id} style={[styles.listing, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        <Text style={{ color: theme.text, fontWeight: '900' }}>{listing.title || `${listing.brand || ''} ${listing.model || ''}`.trim() || `Ogłoszenie #${listing.id}`}</Text>
        {listing.isPromoted && <Text style={styles.promoted}>PROMOWANE DO {listing.promotedUntil ? new Date(listing.promotedUntil).toLocaleDateString('pl-PL') : '—'}</Text>}
        {insight && <View style={styles.stats}><Text style={{ color: theme.textDim }}>Wyświetlenia: {insight.uniqueViews}</Text><Text style={{ color: theme.textDim }}>Rozmowy: {insight.conversations}</Text><Text style={{ color: theme.textDim }}>Zapisy: {insight.saves}</Text><Text style={{ color: theme.textDim }}>Zmiany ceny: {insight.priceHistory.length}</Text></View>}
        <View style={styles.actions}><TouchableOpacity onPress={() => void loadAnalytics(listing.id)} style={[styles.secondary, { borderColor: theme.border }]}><Text style={{ color: theme.text, fontWeight: '800', fontSize: 12 }}>ANALITYKA</Text></TouchableOpacity>{grants > 0 && <TouchableOpacity disabled={working === listing.id} onPress={() => useCoupon(listing)} style={styles.couponButton}>{working === listing.id ? <ActivityIndicator size="small" color="#111" /> : <Text style={styles.primaryText}>UŻYJ KUPONU</Text>}</TouchableOpacity>}</View>
      </View>; })}
    </ScrollView>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1 }, header: { height: 56, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, title: { fontFamily: 'Manrope_700Bold', fontSize: 14, letterSpacing: 1 }, content: { padding: 18, gap: 11, paddingBottom: 44 }, section: { fontFamily: 'Manrope_600SemiBold', fontSize: 12, fontWeight: '900', letterSpacing: 1 }, coupon: { borderWidth: 1, borderRadius: 15, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 5 }, input: { borderWidth: 1, borderRadius: 12, padding: 13 }, primary: { height: 48, backgroundColor: '#FFD447', borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginBottom: 8 }, primaryText: { color: '#111', fontWeight: '900', fontSize: 12 }, row: { borderWidth: 1, borderRadius: 14, padding: 14, minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: 10 }, listing: { borderWidth: 1, borderRadius: 14, padding: 14, gap: 9 }, promoted: { color: '#4de926', fontFamily: 'Manrope_600SemiBold', fontSize: 12, fontWeight: '900' }, stats: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 14, rowGap: 5 }, actions: { flexDirection: 'row', gap: 8 }, secondary: { flex: 1, minHeight: 40, borderWidth: 1, borderRadius: 11, alignItems: 'center', justifyContent: 'center' }, couponButton: { flex: 1, minHeight: 40, borderRadius: 11, backgroundColor: '#FFD447', alignItems: 'center', justifyContent: 'center' },
});
