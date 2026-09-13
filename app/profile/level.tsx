import React, { useCallback, useState } from 'react';
import { View, ScrollView, TouchableOpacity, ActivityIndicator, RefreshControl, Alert } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { AppText as Text } from '../../components/ui/AppText';
import { ShopAvatarDecoration } from '../../components/shop/ShopAvatarDecoration';
import { useTheme } from '../../contexts/ThemeContext';
import { useAccountProgression, levelRequest } from '../../hooks/useAccountProgression';
import { useProfileShop, type CatalogItem } from '../../hooks/useProfileShop';
type Reward = { id: string; level: number; seenAt: string | null; item: CatalogItem };
export default function AccountLevelScreen() {
  const router = useRouter();
  const { theme } = useTheme();
  const { data, loading, error, reload } = useAccountProgression();
  const [rewards, setRewards] = useState<Reward[]>([]);
  const [cursor, setCursor] = useState<number | null>(null);
  const [rewardError, setRewardError] = useState('');
  const { equip } = useProfileShop();
  const loadRewards = useCallback(async (after = 0) => {
    try {
      const result = await levelRequest(`/rewards?after=${after}`);
      setRewards(previous => after ? [...previous, ...result.rewards] : result.rewards);
      setCursor(result.nextCursor); setRewardError('');
    } catch (e) { setRewardError(e instanceof Error ? e.message : 'Nie udało się pobrać ramek.'); }
  }, []);
  useFocusEffect(useCallback(() => { void loadRewards(); }, [loadRewards]));
  return <SafeAreaView style={{ flex: 1, backgroundColor: theme.bg }}>
    <View style={{ padding: 20, flexDirection: 'row', alignItems: 'center', gap: 18 }}><TouchableOpacity onPress={() => router.back()} accessibilityLabel="Wróć"><MaterialIcons name="arrow-back" size={28} color={theme.text} /></TouchableOpacity><Text style={{ color: theme.text, fontSize: 24, fontWeight: '900' }}>Poziom i nagrody</Text></View>
    <ScrollView contentContainerStyle={{ padding: 20, gap: 20 }} refreshControl={<RefreshControl refreshing={loading} onRefresh={() => { void reload(); void loadRewards(); }} tintColor={theme.primary} />}>
      {loading && !data && <ActivityIndicator color={theme.primary} />}
      {!!error && <TouchableOpacity onPress={reload}><Text style={{ color: theme.primary }}>{error} Dotknij, aby ponowić.</Text></TouchableOpacity>}
      {data?.enabled ? <>
        <View style={{ backgroundColor: theme.surface2, padding: 24, borderRadius: 24, gap: 14 }}>
          <Text style={{ color: theme.primary, fontWeight: '800' }}>TWÓJ DOROBEK VROOM</Text>
          <Text style={{ color: theme.text, fontWeight: '900', fontSize: 42 }}>Poziom {data.level}</Text>
          <View style={{ height: 8, borderRadius: 4, backgroundColor: theme.border2, overflow: 'hidden' }}><View style={{ height: 8, width: `${Math.min(100, data.progress * 100)}%`, backgroundColor: theme.primary }} /></View>
          <Text style={{ color: theme.textDim }}>{data.xp} XP łącznie · {data.xpToNextLevel} XP do awansu</Text>
          <Text style={{ color: theme.text }}>Kolejna ramka: poziom {data.nextRewardLevel}</Text>
        </View>
        <Text style={{ color: theme.textDim }}>Zdobyte punkty rozwijają konto. Wymiana na Nitro nie obniża poziomu. Sezony mają osobne wyniki, a Twój dorobek zostaje.</Text>
        <Text style={{ color: theme.text, fontSize: 22, fontWeight: '800' }}>Twoje ramki</Text>
        {data.rewardsPending && <Text style={{ color: theme.textDim }}>Przygotowujemy zdobyte ramki. Pojawią się tutaj po zakończeniu przyznawania.</Text>}
        {!rewards.length && !data.rewardsPending && <Text style={{ color: theme.textDim }}>Pierwsza ramka czeka na poziomie 5.</Text>}
        {rewards.map(reward => <View key={reward.id} style={{ backgroundColor: theme.surface2, padding: 20, borderRadius: 20, gap: 16 }}>
          <View style={{ height: 130, alignItems: 'center', justifyContent: 'center' }}><ShopAvatarDecoration item={reward.item} size={100} /></View>
          <Text style={{ color: theme.text, fontSize: 18, fontWeight: '800' }}>Poziom {reward.level}</Text>
          <TouchableOpacity style={{ padding: 14, borderRadius: 14, backgroundColor: theme.primary }} onPress={async () => { try { const result = await equip('avatar_frame', reward.item.id); Alert.alert(result.ok ? 'Ramka założona' : 'Nie udało się założyć ramki'); } catch { Alert.alert('Nie udało się założyć ramki'); } }}><Text style={{ color: '#fff', textAlign: 'center', fontWeight: '800' }}>Załóż</Text></TouchableOpacity>
        </View>)}
        {!!rewardError && <Text style={{ color: theme.primary }}>{rewardError}</Text>}
        {cursor !== null && <TouchableOpacity onPress={() => void loadRewards(cursor)}><Text style={{ color: theme.primary }}>Pokaż kolejne ramki</Text></TouchableOpacity>}
      </> : data && <Text style={{ color: theme.textDim }}>Poziomy konta pojawią się po uruchomieniu nowej ekonomii.</Text>}
    </ScrollView>
  </SafeAreaView>;
}
