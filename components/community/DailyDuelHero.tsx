import React, { useEffect, useState } from 'react';
import {
  View, Text, TouchableOpacity, Image, ActivityIndicator,
} from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useTheme } from '../../contexts/ThemeContext';
import {
  type DailyDuelData,
  formatDuelCount,
  formatDuelTimer,
  carDisplayLabel,
} from './dailyDuelTypes';

interface Props {
  duel: DailyDuelData | null;
  loading?: boolean;
  onPressVote?: () => void;
  compact?: boolean;
}

const cardShell = (isDark: boolean, theme: ReturnType<typeof useTheme>['theme']) => ({
  marginHorizontal: 16,
  marginBottom: 28,
  backgroundColor: theme.bgAlt,
  borderRadius: 24,
  borderWidth: 1,
  borderColor: isDark ? '#ffffff10' : theme.border2,
  overflow: 'hidden' as const,
  shadowColor: '#000',
  shadowOffset: { width: 0, height: 2 },
  shadowOpacity: isDark ? 0.4 : 0.06,
  shadowRadius: 8,
  elevation: 2,
});

export function DailyDuelHero({ duel, loading, onPressVote, compact }: Props) {
  const { theme, isDark } = useTheme();
  const [nowMs, setNowMs] = useState(Date.now());

  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  if (loading) {
    return (
      <View style={{ ...cardShell(isDark, theme), padding: 28, alignItems: 'center' }}>
        <ActivityIndicator color={theme.primary} />
      </View>
    );
  }

  if (!duel) {
    return (
      <View style={{ ...cardShell(isDark, theme), padding: 20 }}>
        <Text style={{ fontSize: 11, color: theme.textDim, fontWeight: '600', letterSpacing: 1, textTransform: 'uppercase' }}>
          Pojedynek dnia
        </Text>
        <Text style={{ fontSize: 13, color: theme.textMuted, marginTop: 8, lineHeight: 18 }}>
          Brak pojedynku — za mało aut z mocą i zdjęciem w bazie.
        </Text>
      </View>
    );
  }

  const endsMs = new Date(duel.endsAt).getTime();
  const timer = formatDuelTimer(endsMs - nowMs);
  const imageH = compact ? 120 : 150;
  const voted = duel.myVoteCarId != null;

  return (
    <TouchableOpacity
      activeOpacity={onPressVote ? 0.92 : 1}
      onPress={onPressVote}
      disabled={!onPressVote}
      style={cardShell(isDark, theme)}
    >
      <View style={{
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingTop: 16,
        paddingBottom: 12,
        borderBottomWidth: 1,
        borderBottomColor: isDark ? '#ffffff08' : theme.border2,
      }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <MaterialCommunityIcons name="sword-cross" size={14} color={theme.primary} />
          <Text style={{ fontSize: 11, color: theme.text, fontWeight: '600', letterSpacing: 0.5, textTransform: 'uppercase' }}>
            Pojedynek dnia
          </Text>
        </View>
        <Text style={{ fontSize: 12, color: theme.primary, fontWeight: '700', fontVariant: ['tabular-nums'] }}>
          {timer}
        </Text>
      </View>

      <View style={{ flexDirection: 'row', height: imageH, position: 'relative' }}>
        <View style={{ flex: 1, backgroundColor: theme.surface }}>
          {duel.carA.photo ? (
            <Image source={{ uri: duel.carA.photo }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
          ) : (
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
              <MaterialCommunityIcons name="car-sports" size={36} color={theme.textFaint} />
            </View>
          )}
          <View style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            paddingVertical: 8,
            paddingHorizontal: 10,
            backgroundColor: theme.overlay,
          }}>
            <Text style={{ fontSize: 10, color: theme.text, fontWeight: '600' }} numberOfLines={1}>
              {carDisplayLabel(duel.carA)}
            </Text>
          </View>
        </View>

        <View style={{
          position: 'absolute',
          left: '50%',
          top: '50%',
          marginLeft: -20,
          marginTop: -20,
          width: 40,
          height: 40,
          borderRadius: 20,
          backgroundColor: theme.bg,
          borderWidth: 1,
          borderColor: isDark ? '#ffffff15' : theme.border2,
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 2,
        }}>
          <Text style={{ fontSize: 10, color: theme.primary, fontWeight: '800' }}>VS</Text>
        </View>

        <View style={{ flex: 1, backgroundColor: theme.surface }}>
          {duel.carB.photo ? (
            <Image source={{ uri: duel.carB.photo }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
          ) : (
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
              <MaterialCommunityIcons name="car-sports" size={36} color={theme.textFaint} />
            </View>
          )}
          <View style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            paddingVertical: 8,
            paddingHorizontal: 10,
            backgroundColor: theme.overlay,
          }}>
            <Text style={{ fontSize: 10, color: theme.text, fontWeight: '600' }} numberOfLines={1}>
              {carDisplayLabel(duel.carB)}
            </Text>
          </View>
        </View>
      </View>

      <View style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 16,
        paddingVertical: 14,
      }}>
        <Text style={{ fontSize: 11, color: theme.textDim, fontWeight: '600' }}>
          {duel.percentA}% · {formatDuelCount(duel.votesA)}
        </Text>
        <Text style={{ fontSize: 11, color: theme.primary, fontWeight: '700' }}>
          {voted ? 'Zagłosowano ✓' : 'Głosuj →'}
        </Text>
        <Text style={{ fontSize: 11, color: theme.textDim, fontWeight: '600' }}>
          {duel.percentB}% · {formatDuelCount(duel.votesB)}
        </Text>
      </View>

      <View style={{
        flexDirection: 'row',
        height: 3,
        marginHorizontal: 16,
        marginBottom: 16,
        borderRadius: 2,
        overflow: 'hidden',
        backgroundColor: isDark ? '#ffffff08' : theme.border2,
      }}>
        <View style={{ flex: duel.percentA || 1, backgroundColor: theme.primary }} />
        <View style={{ flex: duel.percentB || 1, backgroundColor: isDark ? '#ffffff18' : theme.surface4 }} />
      </View>
    </TouchableOpacity>
  );
}
