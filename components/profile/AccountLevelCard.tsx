import React from 'react';
import { TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { AppText as Text } from '../ui/AppText';
import { useTheme } from '../../contexts/ThemeContext';
import { useAccountProgression } from '../../hooks/useAccountProgression';
export function AccountLevelCard({ compact = false }: { compact?: boolean }) {
  const { data } = useAccountProgression();
  const { theme } = useTheme();
  const router = useRouter();
  if (!data?.enabled) return null;
  return <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Poziom ${data.level}. Poziom i nagrody`} onPress={() => router.push('/profile/level' as any)} style={{ padding: compact ? 8 : 18, gap: 8, flex: compact ? 1 : undefined, marginBottom: compact ? 0 : 16, backgroundColor: theme.surface2, borderRadius: 20 }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}><MaterialIcons name="military-tech" size={compact ? 20 : 30} color={theme.primary} /><Text style={{ color: theme.text, fontWeight: '900', fontSize: compact ? 18 : 24 }}>Poziom {data.level}</Text></View>
    <View style={{ height: 5, backgroundColor: theme.border2, borderRadius: 3, overflow: 'hidden' }}><View style={{ width: `${Math.min(100, data.progress * 100)}%`, height: 5, backgroundColor: theme.primary }} /></View>
    <Text style={{ color: theme.textDim, fontSize: 12 }}>{data.xpToNextLevel} XP do awansu{!compact ? ` · Ramka na poziomie ${data.nextRewardLevel}` : ''}</Text>
  </TouchableOpacity>;
}
