import React, { useEffect, useState } from 'react';
import {
  View, Text, TouchableOpacity, Image, ActivityIndicator,
} from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useTheme } from '../../contexts/ThemeContext';
import { COMMUNITY_ACCENTS } from './communityTheme';
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

export function DailyDuelHero({ duel, loading, onPressVote, compact }: Props) {
  const { theme, isDark } = useTheme();
  const [nowMs, setNowMs] = useState(Date.now());

  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const gold = COMMUNITY_ACCENTS.duel;
  const red = COMMUNITY_ACCENTS.duelAlt;

  if (loading) {
    return (
      <View style={{
        marginHorizontal: 16,
        marginBottom: 20,
        backgroundColor: theme.surface,
        borderRadius: 24,
        borderWidth: 1,
        borderColor: theme.border2,
        padding: 24,
        alignItems: 'center',
      }}>
        <ActivityIndicator color={gold} />
      </View>
    );
  }

  if (!duel) {
    return (
      <View style={{
        marginHorizontal: 16,
        marginBottom: 20,
        backgroundColor: theme.surface,
        borderRadius: 24,
        borderWidth: 1,
        borderColor: theme.border2,
        padding: 20,
      }}>
        <Text style={{ fontFamily: 'Orbitron', fontSize: 10, color: theme.textDim, letterSpacing: 2 }}>
          POJEDYNEK DNIA
        </Text>
        <Text style={{ fontFamily: 'Orbitron', fontSize: 11, color: theme.textMuted, marginTop: 10, lineHeight: 16 }}>
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
      style={{
        marginHorizontal: 16,
        marginBottom: 20,
        backgroundColor: theme.surface,
        borderRadius: 24,
        borderWidth: 1,
        borderColor: gold + '35',
        overflow: 'hidden',
        shadowColor: gold,
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: isDark ? 0.2 : 0.1,
        shadowRadius: 16,
        elevation: 6,
      }}
    >
      <View style={{
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingTop: 14,
        paddingBottom: 10,
      }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <MaterialCommunityIcons name="sword-cross" size={14} color={gold} />
          <Text style={{ fontFamily: 'Orbitron', fontSize: 9, color: gold, letterSpacing: 3, fontWeight: '800' }}>
            POJEDYNEK DNIA
          </Text>
        </View>
        <Text style={{ fontFamily: 'Orbitron', fontSize: 11, color: gold, fontWeight: '800' }}>
          {timer}
        </Text>
      </View>

      <View style={{ flexDirection: 'row', height: imageH, position: 'relative' }}>
        <View style={{ flex: 1, backgroundColor: theme.surface3 }}>
          {duel.carA.photo ? (
            <Image source={{ uri: duel.carA.photo }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
          ) : (
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
              <MaterialCommunityIcons name="car-sports" size={40} color={theme.border3} />
            </View>
          )}
          <View style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            paddingVertical: 8,
            paddingHorizontal: 8,
            backgroundColor: '#000000aa',
          }}>
            <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: '#fff', fontWeight: '800' }} numberOfLines={1}>
              {carDisplayLabel(duel.carA)}
            </Text>
          </View>
        </View>

        <View style={{
          position: 'absolute',
          left: '50%',
          top: '50%',
          marginLeft: -22,
          marginTop: -22,
          width: 44,
          height: 44,
          borderRadius: 22,
          backgroundColor: theme.bg,
          borderWidth: 2,
          borderColor: gold,
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 2,
        }}>
          <Text style={{ fontFamily: 'Orbitron', fontSize: 11, color: gold, fontWeight: '900' }}>VS</Text>
        </View>

        <View style={{ flex: 1, backgroundColor: theme.surface3 }}>
          {duel.carB.photo ? (
            <Image source={{ uri: duel.carB.photo }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
          ) : (
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
              <MaterialCommunityIcons name="car-sports" size={40} color={theme.border3} />
            </View>
          )}
          <View style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            paddingVertical: 8,
            paddingHorizontal: 8,
            backgroundColor: '#000000aa',
          }}>
            <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: '#fff', fontWeight: '800' }} numberOfLines={1}>
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
        paddingVertical: 12,
      }}>
        <Text style={{ fontFamily: 'Orbitron', fontSize: 10, color: red, fontWeight: '800' }}>
          {duel.percentA}% · {formatDuelCount(duel.votesA)}
        </Text>
        <Text style={{ fontFamily: 'Orbitron', fontSize: 10, color: gold, fontWeight: '800', letterSpacing: 1 }}>
          {voted ? 'ZAGŁOSOWANO ✓' : 'GŁOSUJ →'}
        </Text>
        <Text style={{ fontFamily: 'Orbitron', fontSize: 10, color: gold, fontWeight: '800' }}>
          {duel.percentB}% · {formatDuelCount(duel.votesB)}
        </Text>
      </View>

      <View style={{
        flexDirection: 'row',
        height: 6,
        marginHorizontal: 16,
        marginBottom: 14,
        borderRadius: 3,
        overflow: 'hidden',
        backgroundColor: theme.surface3,
      }}>
        <View style={{ flex: duel.percentA || 1, backgroundColor: red }} />
        <View style={{ flex: duel.percentB || 1, backgroundColor: gold }} />
      </View>
    </TouchableOpacity>
  );
}
