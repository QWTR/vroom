import React, { useCallback, useState } from 'react';
import { Modal, View, TouchableOpacity, ScrollView, Alert } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useIsFocused } from '@react-navigation/native';
import { AppText as Text } from '../ui/AppText';
import { useTheme } from '../../contexts/ThemeContext';
import { levelRequest } from '../../hooks/useAccountProgression';
import { useAccountRewardTripActive } from '../../lib/accountRewardTripState';
import { ShopAvatarDecoration } from '../shop/ShopAvatarDecoration';
import type { CatalogItem } from '../../hooks/useProfileShop';
type Reward = { id: string; level: number; item: CatalogItem };
export function AccountRewardModal() {
  const { theme } = useTheme();
  const router = useRouter();
  const focused = useIsFocused();
  const tripActive = useAccountRewardTripActive();
  const [rewards, setRewards] = useState<Reward[]>([]);
  const [summary, setSummary] = useState<{ count: number; throughLevel: number } | null>(null);
  useFocusEffect(useCallback(() => {
    let live = true;
    if (!tripActive) void (async () => {
      const state = await levelRequest('/me');
      if (!state.enabled || state.rewardsPending) return;
      const result = await levelRequest('/rewards?unseen=true&limit=50');
      if (live) { setRewards(result.rewards); setSummary(result.summary); }
    })().catch(() => {});
    return () => { live = false; };
  }, [tripActive]));
  const close = async (equip = false) => {
    try {
      await levelRequest('/rewards/seen', { method: 'POST', body: JSON.stringify({ ids: rewards.map(row => row.id), throughLevel: summary?.throughLevel }) });
      setRewards([]);
      if (equip) router.push('/profile/level' as any);
    } catch { Alert.alert('Nie udało się zapisać. Spróbuj ponownie.'); }
  };
  return <Modal transparent animationType="fade" visible={focused && !tripActive && rewards.length > 0} onRequestClose={() => void close()}>
    <View style={{ flex: 1, backgroundColor: '#000b', justifyContent: 'center', padding: 24 }}><ScrollView style={{ flexGrow: 0, maxHeight: '85%', backgroundColor: theme.surface2, borderRadius: 28 }} contentContainerStyle={{ padding: 24, gap: 20 }}>
      <Text style={{ color: theme.primary, fontWeight: '800' }}>NAGRODA ZA TWÓJ DOROBEK</Text>
      <Text style={{ color: theme.text, fontSize: 26, fontWeight: '900' }}>{(summary?.count || rewards.length) === 1 ? 'Odblokowano ramkę' : `Odblokowano ${summary?.count || rewards.length} ramek`}</Text>
      {rewards.at(-1)?.item && <View style={{ height: 150, alignItems: 'center', justifyContent: 'center' }}><ShopAvatarDecoration item={rewards.at(-1)!.item} size={112} /></View>}
      <Text style={{ color: theme.textDim }}>Poziomy: {rewards.map(row => row.level).join(', ')}. Wszystkie ramki są już w Twoim ekwipunku.</Text>
      <TouchableOpacity onPress={() => void close(true)} style={{ padding: 16, backgroundColor: theme.primary, borderRadius: 16 }}><Text style={{ color: '#fff', fontWeight: '800', textAlign: 'center' }}>Wybierz i załóż</Text></TouchableOpacity>
      <TouchableOpacity onPress={() => void close()} style={{ padding: 12 }}><Text style={{ color: theme.textDim, textAlign: 'center' }}>Później</Text></TouchableOpacity>
    </ScrollView></View>
  </Modal>;
}
