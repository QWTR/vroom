import React, { useEffect, useMemo, useRef } from 'react';
import {
  ActivityIndicator,
  Animated,
  Dimensions,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../contexts/ThemeContext';
import { DailyDuelResetTimer } from './DailyDuelResetTimer';
import { COMMUNITY_ACCENTS } from './communityTheme';
import {
  type DailyDuelCarSide,
  type DailyDuelData,
  carDisplayLabel,
  formatDuelCount,
  getCarPhotos,
} from './dailyDuelTypes';
import { DailyDuelHistorySection } from './DailyDuelHistorySection';

const { width: SCREEN_W } = Dimensions.get('window');
const CARD_W = SCREEN_W - 32;
const HERO_PHOTO_H = Math.min(390, Math.max(310, SCREEN_W * 0.78));

interface ArenaCardProps {
  car: DailyDuelCarSide;
  side: 'A' | 'B';
  color: string;
  accentLabel: string;
  percent: number;
  votes: number;
  selected: boolean;
  voted: boolean;
  voting?: boolean;
  onVote: (carId: number) => void;
  entranceStyle: unknown;
}

function CarStat({ label, value, color }: { label: string; value: string | number; color: string }) {
  return (
    <View style={{ flex: 1 }}>
      <Text style={{ fontFamily: 'Orbitron', fontSize: 13, color, fontWeight: '900' }} numberOfLines={1}>
        {value}
      </Text>
      <Text style={{ fontSize: 8, color: '#ffffff88', letterSpacing: 1.4, marginTop: 2, textTransform: 'uppercase' }}>
        {label}
      </Text>
    </View>
  );
}

const DuelArenaCarCard = React.memo(function DuelArenaCarCard({
  car,
  side,
  color,
  accentLabel,
  percent,
  votes,
  selected,
  voted,
  voting,
  onVote,
  entranceStyle,
}: ArenaCardProps) {
  const router = useRouter();
  const photos = useMemo(() => getCarPhotos(car), [car]);
  const heroPhoto = photos[0] ?? null;
  const canVote = !voted && !voting;
  const shine = useRef(new Animated.Value(0)).current;
  const selectedPulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(shine, { toValue: 1, duration: 2100, useNativeDriver: true }),
        Animated.delay(side === 'A' ? 850 : 350),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [shine, side]);

  useEffect(() => {
    if (!selected) {
      selectedPulse.setValue(0);
      return undefined;
    }

    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(selectedPulse, { toValue: 1, duration: 760, useNativeDriver: true }),
        Animated.timing(selectedPulse, { toValue: 0, duration: 760, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [selected, selectedPulse]);

  const shineX = shine.interpolate({ inputRange: [0, 1], outputRange: [-120, CARD_W + 70] });
  const selectedGlowOpacity = selectedPulse.interpolate({ inputRange: [0, 1], outputRange: [0.22, 0.58] });
  const selectedGlowScale = selectedPulse.interpolate({ inputRange: [0, 1], outputRange: [0.98, 1.035] });

  return (
    <Animated.View style={[{ width: CARD_W }, entranceStyle as object]}>
      <TouchableOpacity
        activeOpacity={canVote ? 0.84 : 1}
        disabled={!canVote}
        onPress={() => onVote(car.id)}
        style={{
          borderRadius: 22,
          overflow: 'hidden',
          backgroundColor: '#070707',
          borderWidth: selected ? 2 : 1,
          borderColor: selected ? color : '#ffffff22',
          shadowColor: color,
          shadowOpacity: selected ? 0.55 : 0.18,
          shadowRadius: selected ? 18 : 10,
          elevation: selected ? 10 : 4,
          position: 'relative',
        }}
      >
        {selected ? (
          <Animated.View
            pointerEvents="none"
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              borderRadius: 22,
              borderWidth: 3,
              borderColor: color,
              opacity: selectedGlowOpacity,
              transform: [{ scale: selectedGlowScale }],
              zIndex: 5,
            }}
          />
        ) : null}

        <View style={{ height: HERO_PHOTO_H, backgroundColor: '#000', overflow: 'hidden' }}>
          {heroPhoto ? (
            <Image source={{ uri: heroPhoto }} style={{ width: '100%', height: '100%' }} contentFit="cover" />
          ) : (
            <LinearGradient colors={['#111', '#050505']} style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
              <MaterialCommunityIcons name="car-sports" size={52} color="#ffffff33" />
            </LinearGradient>
          )}

          <Animated.View
            pointerEvents="none"
            style={{
              position: 'absolute',
              top: -70,
              bottom: -70,
              width: 70,
              transform: [{ translateX: shineX }, { rotate: '18deg' }],
              opacity: selected ? 0.42 : 0.24,
            }}
          >
            <LinearGradient
              colors={['transparent', 'rgba(255,255,255,0.28)', 'transparent']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={{ flex: 1 }}
            />
          </Animated.View>

          <LinearGradient
            colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.12)', '#050505']}
            style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 132 }}
          />
          <LinearGradient
            colors={side === 'A' ? [`${color}44`, 'transparent'] : ['transparent', `${color}44`]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 96 }}
          />

          <View style={{
            position: 'absolute',
            top: 10,
            left: 10,
            borderRadius: 999,
            backgroundColor: '#000000aa',
            borderWidth: 1,
            borderColor: `${color}99`,
            paddingHorizontal: 10,
            paddingVertical: 5,
          }}>
            <Text style={{ fontFamily: 'Orbitron', color, fontSize: 8, fontWeight: '900', letterSpacing: 1.3 }}>
              {accentLabel}
            </Text>
          </View>

          {photos.length > 1 ? (
            <View style={{
              position: 'absolute',
              top: 10,
              right: 10,
              backgroundColor: '#00000099',
              borderRadius: 999,
              paddingHorizontal: 8,
              paddingVertical: 4,
            }}>
              <Text style={{ fontFamily: 'Orbitron', color: '#fff', fontSize: 8 }}>
                +{photos.length - 1}
              </Text>
            </View>
          ) : null}

          {selected ? (
            <View style={{
              position: 'absolute',
              right: 14,
              bottom: 18,
              width: 54,
              height: 54,
              borderRadius: 27,
              backgroundColor: color,
              alignItems: 'center',
              justifyContent: 'center',
              shadowColor: color,
              shadowOpacity: 0.75,
              shadowRadius: 18,
            }}>
              <MaterialIcons name="check" size={30} color="#000" />
            </View>
          ) : null}
        </View>

        <View style={{ padding: 16, gap: 10 }}>
          <Text style={{ fontFamily: 'Orbitron', color: '#fff', fontSize: 21, fontWeight: '900', lineHeight: 27 }} numberOfLines={2}>
            {carDisplayLabel(car)}
          </Text>
          <Text style={{ color: '#ffffff99', fontSize: 13, lineHeight: 18 }} numberOfLines={2}>
            {car.specs}
          </Text>

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 18 }}>
            <CarStat label="Moc" value={`${car.power} KM`} color={color} />
            <CarStat label="Głosy" value={`${percent}%`} color="#fff" />
          </View>

          <TouchableOpacity
            onPress={() => router.push({ pathname: '/profile/[userId]', params: { userId: String(car.owner.id) } })}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}
          >
            <MaterialIcons name="person" size={12} color={color} />
            <Text style={{ color, fontFamily: 'Orbitron', fontSize: 11 }} numberOfLines={1}>
              @{car.owner.username}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => onVote(car.id)}
            disabled={!canVote}
            activeOpacity={0.86}
            style={{
              marginTop: 2,
              height: 52,
              borderRadius: 18,
              overflow: 'hidden',
              opacity: voted && !selected ? 0.42 : 1,
            }}
          >
            <LinearGradient
              colors={selected ? [color, '#ffffff'] : [color, `${color}aa`]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={{ flex: 1, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 7 }}
            >
              {voting ? (
                <ActivityIndicator color="#000" size="small" />
              ) : (
                <>
                  <MaterialCommunityIcons name={selected ? 'check-decagram' : 'vote'} size={16} color="#050505" />
                  <Text style={{ color: '#050505', fontFamily: 'Orbitron', fontSize: 12, fontWeight: '900', letterSpacing: 1.5 }}>
                    {selected ? 'TWÓJ WYBÓR' : `GŁOSUJ ${side}`}
                  </Text>
                </>
              )}
            </LinearGradient>
          </TouchableOpacity>

          <Text style={{ color: '#ffffff70', fontFamily: 'Orbitron', fontSize: 8, textAlign: 'center' }}>
            {formatDuelCount(votes)} głosów
          </Text>
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
});

interface Props {
  duel: DailyDuelData | null;
  history?: DailyDuelData[];
  historyLoading?: boolean;
  loading?: boolean;
  voting?: boolean;
  onVote: (carId: number) => void;
  onRefresh?: () => void;
}

export function DailyDuelVotePanel({
  duel,
  history = [],
  historyLoading = false,
  loading,
  voting,
  onVote,
  onRefresh,
}: Props) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { isDark } = useTheme();
  const fade = useRef(new Animated.Value(0)).current;
  const slideA = useRef(new Animated.Value(-34)).current;
  const slideB = useRef(new Animated.Value(34)).current;
  const vsPulse = useRef(new Animated.Value(0)).current;
  const gold = COMMUNITY_ACCENTS.duel;
  const red = COMMUNITY_ACCENTS.duelAlt;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fade, { toValue: 1, duration: 420, useNativeDriver: true }),
      Animated.spring(slideA, { toValue: 0, damping: 14, stiffness: 110, useNativeDriver: true }),
      Animated.spring(slideB, { toValue: 0, damping: 14, stiffness: 110, useNativeDriver: true }),
    ]).start();

    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(vsPulse, { toValue: 1, duration: 780, useNativeDriver: true }),
        Animated.timing(vsPulse, { toValue: 0, duration: 780, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [fade, slideA, slideB, vsPulse]);

  if (loading || !duel) {
    return (
      <View style={{ flex: 1, backgroundColor: '#030303', justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator color={gold} size="large" />
      </View>
    );
  }

  const voted = duel.myVoteCarId != null;
  const pulseScale = vsPulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.08] });
  const pulseOpacity = vsPulse.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0.78] });

  return (
    <View style={{ flex: 1, backgroundColor: '#030303' }}>
      <LinearGradient
        colors={isDark ? ['#210707', '#050505', '#000000'] : ['#260909', '#111111', '#050505']}
        style={StyleSheet.absoluteFillObject}
      />
      <View style={{
        position: 'absolute',
        top: -120,
        right: -130,
        width: 310,
        height: 310,
        borderRadius: 155,
        borderWidth: 1,
        borderColor: `${red}33`,
        backgroundColor: `${red}12`,
      }} />
      <View style={{
        position: 'absolute',
        bottom: 170,
        left: -150,
        width: 280,
        height: 280,
        borderRadius: 140,
        backgroundColor: `${gold}10`,
      }} />

      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={onRefresh ? <RefreshControl refreshing={false} onRefresh={onRefresh} tintColor={gold} /> : undefined}
        contentContainerStyle={{ paddingTop: insets.top + 12, paddingBottom: 34 }}
      >
        <View style={{ paddingHorizontal: 16, marginBottom: 16 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <TouchableOpacity
              onPress={() => router.back()}
              style={{
                width: 42,
                height: 42,
                borderRadius: 21,
                backgroundColor: '#ffffff12',
                borderWidth: 1,
                borderColor: '#ffffff20',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <MaterialIcons name="arrow-back" size={22} color="#fff" />
            </TouchableOpacity>

            <View style={{ alignItems: 'center' }}>
              <Text style={{ color: '#ffffff88', fontFamily: 'Orbitron', fontSize: 8, letterSpacing: 3 }}>
                VROOM ARENA
              </Text>
              <Text style={{ color: '#fff', fontFamily: 'Orbitron', fontSize: 18, fontWeight: '900', letterSpacing: 2, marginTop: 4 }}>
                POJEDYNEK DNIA
              </Text>
            </View>

            <TouchableOpacity
              onPress={onRefresh}
              disabled={!onRefresh}
              style={{
                width: 42,
                height: 42,
                borderRadius: 21,
                backgroundColor: '#ffffff12',
                borderWidth: 1,
                borderColor: '#ffffff20',
                alignItems: 'center',
                justifyContent: 'center',
                opacity: onRefresh ? 1 : 0.35,
              }}
            >
              <MaterialCommunityIcons name="refresh" size={20} color="#fff" />
            </TouchableOpacity>
          </View>

          <View style={{
            marginTop: 16,
            alignSelf: 'center',
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            paddingHorizontal: 14,
            paddingVertical: 8,
            borderRadius: 999,
            borderWidth: 1,
            borderColor: `${gold}55`,
            backgroundColor: '#00000088',
          }}>
            <MaterialCommunityIcons name="timer-sand" size={14} color={gold} />
            <DailyDuelResetTimer endsAt={duel.endsAt} />
          </View>
        </View>

        <Animated.View style={{ opacity: fade }}>
          <View style={{ paddingHorizontal: 16, position: 'relative' }}>
            <DuelArenaCarCard
              car={duel.carA}
              side="A"
              color={red}
              accentLabel="LEFT LANE"
              percent={duel.percentA}
              votes={duel.votesA}
              selected={duel.myVoteCarId === duel.carA.id}
              voted={voted}
              voting={voting}
              onVote={onVote}
              entranceStyle={{ transform: [{ translateX: slideA }] }}
            />

            <View style={{ height: 86, alignItems: 'center', justifyContent: 'center', marginVertical: -12, zIndex: 10 }}>
              <Animated.View
                pointerEvents="none"
                style={{
                  position: 'absolute',
                  width: 96,
                  height: 96,
                  borderRadius: 48,
                  transform: [{ scale: pulseScale }],
                  opacity: pulseOpacity,
                  backgroundColor: `${red}33`,
                }}
              />
              <View style={{
                width: 76,
                height: 76,
                borderRadius: 38,
                backgroundColor: '#050505',
                borderWidth: 2,
                borderColor: '#ffffff28',
                alignItems: 'center',
                justifyContent: 'center',
                shadowColor: red,
                shadowOpacity: 0.6,
                shadowRadius: 16,
                elevation: 12,
                overflow: 'hidden',
              }}>
                <LinearGradient
                  colors={[red, gold]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={{ position: 'absolute', top: -2, left: -2, right: -2, bottom: -2, opacity: 0.28 }}
                />
                <Text style={{ color: '#fff', fontFamily: 'Orbitron', fontSize: 20, fontWeight: '900', fontStyle: 'italic' }}>
                  VS
                </Text>
              </View>
            </View>

            <DuelArenaCarCard
              car={duel.carB}
              side="B"
              color={gold}
              accentLabel="RIGHT LANE"
              percent={duel.percentB}
              votes={duel.votesB}
              selected={duel.myVoteCarId === duel.carB.id}
              voted={voted}
              voting={voting}
              onVote={onVote}
              entranceStyle={{ transform: [{ translateX: slideB }] }}
            />
          </View>

          <View style={{
            marginHorizontal: 16,
            marginTop: 18,
            borderRadius: 18,
            borderWidth: 1,
            borderColor: '#ffffff18',
            backgroundColor: '#090909cc',
            padding: 14,
          }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 }}>
              <Text style={{ color: red, fontFamily: 'Orbitron', fontSize: 11, fontWeight: '900' }}>
                {duel.percentA}% · {formatDuelCount(duel.votesA)}
              </Text>
              <Text style={{ color: '#ffffffaa', fontFamily: 'Orbitron', fontSize: 10 }}>
                {voted ? 'GŁOS ODDANY' : 'WYBIERZ STRONĘ'}
              </Text>
              <Text style={{ color: gold, fontFamily: 'Orbitron', fontSize: 11, fontWeight: '900' }}>
                {duel.percentB}% · {formatDuelCount(duel.votesB)}
              </Text>
            </View>
            <View style={{ height: 12, borderRadius: 6, backgroundColor: '#ffffff14', overflow: 'hidden', flexDirection: 'row' }}>
              <View style={{ flex: duel.percentA || 1, backgroundColor: red }} />
              <View style={{ flex: duel.percentB || 1, backgroundColor: gold }} />
            </View>
            <Text style={{ color: '#ffffff70', fontSize: 10, textAlign: 'center', marginTop: 10 }}>
              Łącznie {duel.totalVotes} głosów
            </Text>
          </View>
        </Animated.View>

        <View style={{ marginTop: 26 }}>
          <DailyDuelHistorySection history={history} loading={historyLoading} />
        </View>
      </ScrollView>
    </View>
  );
}
