import React, { useEffect, useState } from 'react';
import {
  View, Text, TouchableOpacity, Image, ActivityIndicator,
  Dimensions, StyleSheet,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useTheme } from '../../contexts/ThemeContext';
import { getThemeChrome, withAlpha } from '../../constants/theme';
import type { AppAnimation } from '../../constants/appAnimations';
import AppAnimationLayer from '../animations/AppAnimationLayer';
import {
  type DailyDuelData,
  formatDuelCount,
  formatDuelTimer,
  carDisplayLabel,
} from './dailyDuelTypes';

const SCREEN_W = Dimensions.get('window').width;

interface Props {
  duel: DailyDuelData | null;
  loading?: boolean;
  onPressVote?: () => void;
  compact?: boolean;
  vsAnimation?: AppAnimation | null;
}

export function DailyDuelHero({ duel, loading, onPressVote, compact, vsAnimation }: Props) {
  const { theme, isDark } = useTheme();
  const chrome = getThemeChrome(theme, isDark);
  const [nowMs, setNowMs] = useState(Date.now());

  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const shellBg = theme.surface;
  const shellGradient = chrome.pageGradient;
  const headerBg = withAlpha(theme.surface, isDark ? 'dd' : 'ee');
  const headerBorder = theme.border2;
  const footerBg = theme.surface2;
  const footerBorder = theme.border2;
  const progressTrack = theme.surface4;
  const progressRemainder = theme.border3;
  const placeholderGradientA = [theme.surface3, theme.surface] as const;
  const placeholderGradientB = [theme.surface, theme.surface3] as const;
  const placeholderIcon = isDark ? theme.textFaint : theme.textDim;
  const imageOverlay = isDark
    ? ['transparent', 'rgba(0,0,0,0.7)', 'rgba(0,0,0,0.95)']
    : ['transparent', 'rgba(0,0,0,0.45)', 'rgba(0,0,0,0.75)'];
  const slashBlend = isDark
    ? ['transparent', 'rgba(0,0,0,0.4)', 'transparent']
    : ['transparent', 'rgba(255,255,255,0.35)', 'transparent'];
  const vsBadgeBg = theme.surface;

  const shellStyle = {
    marginHorizontal: 0,
    marginBottom: 28,
    overflow: 'hidden' as const,
    backgroundColor: shellBg,
  };

  if (loading) {
    return (
      <View style={[shellStyle, { height: compact ? 200 : 280, alignItems: 'center', justifyContent: 'center' }]}>
        <LinearGradient colors={shellGradient} style={StyleSheet.absoluteFillObject} />
        <ActivityIndicator color={theme.primary} size="large" />
      </View>
    );
  }

  if (!duel) {
    return (
      <View style={[shellStyle, { padding: 24 }]}>
        <LinearGradient colors={shellGradient} style={StyleSheet.absoluteFillObject} />
        <Text style={{
          fontSize: 11,
          color: theme.text,
          fontWeight: '900',
          letterSpacing: 2,
          textTransform: 'uppercase',
        }}>
          Pojedynek dnia
        </Text>
        <Text style={{ fontSize: 13, color: theme.textDim, marginTop: 10, lineHeight: 18, fontWeight: '500' }}>
          Brak pojedynku — za mało aut z mocą i zdjęciem w bazie.
        </Text>
      </View>
    );
  }

  const endsMs = new Date(duel.endsAt).getTime();
  const timer = formatDuelTimer(endsMs - nowMs);
  const imageH = compact ? 160 : 190;
  const voted = duel.myVoteCarId != null;
  const labelA = carDisplayLabel(duel.carA);
  const labelB = carDisplayLabel(duel.carB);

  return (
    <TouchableOpacity
      activeOpacity={onPressVote ? 0.94 : 1}
      onPress={onPressVote}
      disabled={!onPressVote}
      style={shellStyle}
    >
      <View style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 16,
        paddingVertical: 12,
        backgroundColor: headerBg,
        borderBottomWidth: 1,
        borderBottomColor: headerBorder,
      }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
          <MaterialCommunityIcons name="sword-cross" size={14} color={theme.primary} />
          <Text style={{
            fontSize: 10,
            color: theme.text,
            fontWeight: '900',
            letterSpacing: 2,
            textTransform: 'uppercase',
          }}>
            Pojedynek dnia
          </Text>
        </View>
        <Text style={{
          fontSize: 12,
          color: theme.primary,
          fontWeight: '800',
          fontVariant: ['tabular-nums'],
        }}>
          {timer}
        </Text>
      </View>

      <View style={{ height: imageH, position: 'relative' }}>
        <View style={{ flexDirection: 'row', height: imageH, overflow: 'hidden' }}>
          <View style={{ flex: 1, overflow: 'hidden' }}>
            {duel.carA.photo ? (
              <Image source={{ uri: duel.carA.photo }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
            ) : (
              <LinearGradient colors={placeholderGradientA} style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                <MaterialCommunityIcons name="car-sports" size={40} color={placeholderIcon} />
              </LinearGradient>
            )}
          </View>

          <View style={{ flex: 1, overflow: 'hidden', marginLeft: -SCREEN_W * 0.06 }}>
            {duel.carB.photo ? (
              <Image
                source={{ uri: duel.carB.photo }}
                style={{ width: '108%', height: '100%' }}
                resizeMode="cover"
              />
            ) : (
              <LinearGradient colors={placeholderGradientB} style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                <MaterialCommunityIcons name="car-sports" size={40} color={placeholderIcon} />
              </LinearGradient>
            )}
          </View>

          <LinearGradient
            colors={slashBlend as [string, string, string]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={{
              position: 'absolute',
              left: '42%',
              width: '16%',
              top: 0,
              bottom: 0,
              zIndex: 2,
            }}
            pointerEvents="none"
          />

          <View style={{
            position: 'absolute',
            left: '50%',
            top: -30,
            bottom: -30,
            width: 3,
            marginLeft: -1.5,
            backgroundColor: theme.primary,
            transform: [{ rotate: '12deg' }],
            zIndex: 3,
          }} />

          <View style={{
            position: 'absolute',
            left: '50%',
            top: '50%',
            marginLeft: -22,
            marginTop: -22,
            width: 44,
            height: 44,
            borderRadius: 22,
            backgroundColor: vsBadgeBg,
            borderWidth: 2,
            borderColor: theme.primary,
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 4,
          }}>
            {vsAnimation ? (
              <AppAnimationLayer
                animation={vsAnimation}
                style={{ width: 40, height: 40 }}
                fallbackIcon={<Text style={{ fontSize: 11, color: theme.primary, fontWeight: '900' }}>VS</Text>}
              />
            ) : (
              <Text style={{ fontSize: 11, color: theme.primary, fontWeight: '900' }}>VS</Text>
            )}
          </View>
        </View>

        <LinearGradient
          colors={imageOverlay as [string, string, string]}
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            height: 72,
            zIndex: 5,
          }}
          pointerEvents="none"
        />

        <View style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 10,
          zIndex: 6,
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: 12,
          gap: 8,
        }}>
          <Text style={{
            flex: 1,
            fontSize: 11,
            color: '#ffffff',
            fontWeight: '700',
            textTransform: 'uppercase',
            paddingRight: 28,
          }} numberOfLines={1} ellipsizeMode="tail">
            {labelA}
          </Text>
          <Text style={{
            flex: 1,
            fontSize: 11,
            color: '#ffffff',
            fontWeight: '700',
            textTransform: 'uppercase',
            textAlign: 'right',
            paddingLeft: 28,
          }} numberOfLines={1} ellipsizeMode="tail">
            {labelB}
          </Text>
        </View>
      </View>

      <View style={{
        paddingHorizontal: 16,
        paddingTop: 14,
        paddingBottom: 16,
        backgroundColor: footerBg,
        borderTopWidth: 1,
        borderTopColor: footerBorder,
      }}>
        <View style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 12,
        }}>
          <Text style={{ fontSize: 12, color: theme.text, fontWeight: '600' }}>
            {duel.percentA}% · {formatDuelCount(duel.votesA)}
          </Text>
          <Text style={{
            fontSize: 12,
            color: theme.text,
            fontWeight: '900',
            letterSpacing: 0.5,
            textTransform: 'uppercase',
          }}>
            {voted ? 'Zagłosowano ✓' : 'Głosuj →'}
          </Text>
          <Text style={{ fontSize: 12, color: theme.text, fontWeight: '600' }}>
            {duel.percentB}% · {formatDuelCount(duel.votesB)}
          </Text>
        </View>

        <View style={{
          height: 8,
          borderRadius: 4,
          overflow: 'hidden',
          backgroundColor: progressTrack,
        }}>
          <View style={{ flexDirection: 'row', height: '100%' }}>
            <View style={{ flex: duel.percentA || 1, backgroundColor: theme.primary }} />
            <View style={{ flex: duel.percentB || 1, backgroundColor: progressRemainder }} />
          </View>
        </View>
      </View>
    </TouchableOpacity>
  );
}
