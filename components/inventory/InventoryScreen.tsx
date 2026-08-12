import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, RefreshControl, ScrollView, Switch, Text, TouchableOpacity, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { API_URL } from '../../constants/config';
import { useTheme } from '../../contexts/ThemeContext';
import type { ShopItemCategory } from '../../constants/shopCosmetics';
import type { CatalogItem } from '../../hooks/useProfileShop';
import { VehicleModelPreview3D } from '../shop/VehicleModelPreview3D';
import { emitMapVehicleChanged } from '../../lib/mapVehicleEvents';

type InventoryItem = CatalogItem & { active?: boolean; acquiredAt?: string; sources?: { id: string; label: string; grantedAt: string }[] };
type InventoryResponse = { public: boolean; user: { id: number; username: string; avatarUrl?: string | null }; equipped?: Record<string, string | null>; items: InventoryItem[] };
const labels: Partial<Record<ShopItemCategory, string>> = { avatar_frame: 'Ramki', profile_banner: 'Banery', entrance_effect: 'Efekty wejścia', profile_background_animation: 'Tła', map_vehicle_3d: 'Pojazdy 3D', limited_vehicle_slot: 'Sloty', collectible: 'Kolekcjonerskie' };
const equipable = new Set<ShopItemCategory>(['avatar_frame', 'profile_banner', 'entrance_effect', 'profile_background_animation', 'map_vehicle_3d']);

export function InventoryScreen({ userId }: { userId?: string }) {
  const router = useRouter(); const { theme, isDark } = useTheme();
  const [data, setData] = useState<InventoryResponse | null>(null); const [filter, setFilter] = useState<string>('all'); const [loading, setLoading] = useState(true); const [pending, setPending] = useState(''); const [selected3d, setSelected3d] = useState<InventoryItem | null>(null);
  const isOwner = !userId;
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const token = (await AsyncStorage.getItem('userToken')) ?? (await AsyncStorage.getItem('token'));
      const response = await fetch(`${API_URL}/api/inventory/${isOwner ? 'me' : `users/${encodeURIComponent(userId)}`}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'Nie udało się pobrać ekwipunku.');
      setData(body);
    } catch (error) { Alert.alert('Ekwipunek', error instanceof Error ? error.message : 'Nie udało się pobrać ekwipunku.'); }
    finally { setLoading(false); }
  }, [isOwner, userId]);
  useEffect(() => { void load(); }, [load]);
  const categories = useMemo(() => [...new Set((data?.items || []).map((item) => item.category))], [data]);
  const items = (data?.items || []).filter((item) => filter === 'all' || item.category === filter);

  async function equip(item: InventoryItem) {
    if (!isOwner || pending) return;
    setPending(item.id);
    try {
      const token = (await AsyncStorage.getItem('userToken')) ?? (await AsyncStorage.getItem('token'));
      const active = data?.equipped?.[item.category] === item.id;
      const response = await fetch(`${API_URL}/api/inventory/equip`, { method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ category: item.category, itemId: active ? null : item.id }) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'Nie udało się zapisać wyposażenia.');
      if (item.category === 'map_vehicle_3d') emitMapVehicleChanged();
      await load();
    } catch (error) { Alert.alert('Ekwipunek', error instanceof Error ? error.message : 'Nie udało się zapisać wyposażenia.'); }
    finally { setPending(''); }
  }

  async function setPrivacy(value: boolean) {
    if (!isOwner) return;
    setPending('privacy');
    try {
      const token = (await AsyncStorage.getItem('userToken')) ?? (await AsyncStorage.getItem('token'));
      const response = await fetch(`${API_URL}/api/inventory/me/privacy`, { method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ public: value }) });
      if (!response.ok) throw new Error('Nie udało się zapisać prywatności.');
      setData((current) => current ? { ...current, public: value } : current);
    } catch (error) { Alert.alert('Prywatność', error instanceof Error ? error.message : 'Nie udało się zapisać prywatności.'); }
    finally { setPending(''); }
  }

  if (loading && !data) return <View style={{ flex: 1, backgroundColor: theme.bg, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color="#f21933" /></View>;
  return <ScrollView style={{ flex: 1, backgroundColor: theme.bg }} contentContainerStyle={{ padding: 18, paddingTop: 58, paddingBottom: 80 }} refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor="#f21933" />}>
    <TouchableOpacity onPress={() => router.back()} style={{ width: 42, height: 42, borderRadius: 14, borderWidth: 1, borderColor: theme.border, alignItems: 'center', justifyContent: 'center', marginBottom: 22 }}><MaterialCommunityIcons name="arrow-left" size={22} color={theme.text} /></TouchableOpacity>
    <Text style={{ color: '#ff5368', fontFamily: 'Orbitron', fontSize: 9, letterSpacing: 3 }}>VROOM INVENTORY</Text><Text style={{ color: theme.text, fontFamily: 'Orbitron', fontSize: 29, fontWeight: '900', marginTop: 8 }}>{isOwner ? 'Mój ekwipunek' : `Ekwipunek @${data?.user.username || ''}`}</Text><Text style={{ color: theme.textDim, marginTop: 8, lineHeight: 20 }}>Wszystkie itemy zdobyte za Nitro, w sklepie i nadane przez VROOM.</Text>
    {isOwner && data && <View style={{ marginTop: 18, padding: 15, borderRadius: 16, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.surface, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}><View style={{ flex: 1 }}><Text style={{ color: theme.text, fontWeight: '800' }}>Publiczny ekwipunek</Text><Text style={{ color: theme.textDim, fontSize: 11, marginTop: 4 }}>Inni mogą zobaczyć Twoją kolekcję.</Text></View><Switch value={data.public} disabled={pending === 'privacy'} onValueChange={setPrivacy} trackColor={{ true: '#f21933' }} /></View>}
    {!isOwner && data && !data.public && <View style={{ marginTop: 24, padding: 28, alignItems: 'center', borderRadius: 18, borderWidth: 1, borderColor: theme.border }}><MaterialCommunityIcons name="eye-off-outline" size={34} color={theme.textDim} /><Text style={{ color: theme.text, fontWeight: '800', marginTop: 12 }}>Ten ekwipunek jest prywatny</Text></View>}
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, marginTop: 22, marginBottom: 18 }}><TouchableOpacity onPress={() => setFilter('all')} style={{ paddingHorizontal: 14, paddingVertical: 10, borderRadius: 99, backgroundColor: filter === 'all' ? '#f21933' : theme.surface, borderWidth: 1, borderColor: filter === 'all' ? '#f21933' : theme.border }}><Text style={{ color: theme.text, fontWeight: '800', fontSize: 11 }}>Wszystkie</Text></TouchableOpacity>{categories.map((category) => <TouchableOpacity key={category} onPress={() => setFilter(category)} style={{ paddingHorizontal: 14, paddingVertical: 10, borderRadius: 99, backgroundColor: filter === category ? '#f21933' : theme.surface, borderWidth: 1, borderColor: filter === category ? '#f21933' : theme.border }}><Text style={{ color: theme.text, fontWeight: '800', fontSize: 11 }}>{labels[category] || category}</Text></TouchableOpacity>)}</ScrollView>
    <View style={{ gap: 13 }}>{items.map((item) => { const active = data?.equipped?.[item.category] === item.id; return <View key={item.id} style={{ overflow: 'hidden', borderRadius: 20, borderWidth: 1, borderColor: active ? '#38d99666' : theme.border, backgroundColor: theme.surface }}>
      {item.category === 'map_vehicle_3d' && selected3d?.id === item.id ? <VehicleModelPreview3D item={item} height={220} isDark={isDark} /> : <TouchableOpacity disabled={item.category !== 'map_vehicle_3d'} onPress={() => setSelected3d(item)} style={{ height: 170, alignItems: 'center', justifyContent: 'center', backgroundColor: isDark ? '#111115' : '#e7e7ea' }}>{item.previewUrl || item.assetUrl ? <Image source={{ uri: item.previewUrl || item.assetUrl }} style={{ width: '100%', height: '100%' }} contentFit="cover" /> : <MaterialCommunityIcons name="package-variant-closed" size={44} color={theme.textDim} />}{item.category === 'map_vehicle_3d' && <View style={{ position: 'absolute', right: 10, bottom: 10, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 99, backgroundColor: '#08080bcc' }}><Text style={{ color: '#fff', fontSize: 9, fontWeight: '900' }}>PODGLĄD 3D</Text></View>}</TouchableOpacity>}
      <View style={{ padding: 16 }}><View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}><View style={{ flex: 1 }}><Text style={{ color: '#ff5368', fontSize: 8, fontWeight: '900', letterSpacing: 1.5 }}>{labels[item.category] || item.category}</Text><Text style={{ color: theme.text, fontFamily: 'Orbitron', fontSize: 16, fontWeight: '900', marginTop: 5 }}>{item.name}</Text></View>{active && <View style={{ paddingHorizontal: 9, paddingVertical: 6, borderRadius: 99, backgroundColor: '#38d99622' }}><Text style={{ color: '#38d996', fontSize: 8, fontWeight: '900' }}>AKTYWNY</Text></View>}</View><Text style={{ color: theme.textDim, fontSize: 11, lineHeight: 17, marginTop: 8 }}>{item.tagLine || item.description || 'Item VROOM'}</Text>{item.sources?.[0] && <Text style={{ color: theme.textDim, fontSize: 9, marginTop: 10 }}>{item.sources[0].label} · {new Date(item.sources[0].grantedAt).toLocaleDateString('pl-PL')}</Text>}{isOwner && equipable.has(item.category) && <TouchableOpacity disabled={pending === item.id || item.active === false} onPress={() => equip(item)} style={{ marginTop: 14, minHeight: 44, borderRadius: 99, alignItems: 'center', justifyContent: 'center', backgroundColor: active ? 'transparent' : '#f21933', borderWidth: 1, borderColor: active ? theme.border : '#f21933' }}>{pending === item.id ? <ActivityIndicator color="#fff" /> : <Text style={{ color: theme.text, fontWeight: '900', fontSize: 11 }}>{active ? 'Zdejmij' : 'Użyj itemu'}</Text>}</TouchableOpacity>}</View>
    </View>; })}</View>
    {data?.public !== false && !items.length && <View style={{ padding: 40, alignItems: 'center' }}><MaterialCommunityIcons name="package-variant" size={42} color={theme.textDim} /><Text style={{ color: theme.textDim, marginTop: 12 }}>Brak itemów w tej kategorii.</Text></View>}
  </ScrollView>;
}
