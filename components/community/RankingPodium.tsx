import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useTheme } from '../../contexts/ThemeContext';

export interface RankingUser {
  id: number;
  username: string;
  avatar: string | null;
  position: number;
  score: number;
  sub: string;
  streak?: number;
  isPremium?: boolean;
  isWinner?: boolean;
  nickColor?: string | null;
}

const MEDALS = {
  1: { color: '#FFD447', dark: '#9B6500', icon: 'crown' as const, label: 'MISTRZ' },
  2: { color: '#D9E3F0', dark: '#66778C', icon: 'medal' as const, label: 'II MIEJSCE' },
  3: { color: '#D88B45', dark: '#75401F', icon: 'medal' as const, label: 'III MIEJSCE' },
};

export function formatRankingScore(value: number, unit: string): string {
  const maximumFractionDigits = unit === 'km' ? 1 : 0;
  return Number(value || 0).toLocaleString('pl-PL', { maximumFractionDigits });
}

function useReducedMotion() {
  const [reduced, setReduced] = useState(true);
  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled().then((value) => mounted && setReduced(value));
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);
  return reduced;
}

function RankingAvatar({ user, size, accent }: { user: RankingUser; size: number; accent: string }) {
  const { theme } = useTheme();
  return (
    <LinearGradient
      colors={[accent, `${accent}88`, theme.surface2]}
      style={[styles.avatarRing, { width: size + 7, height: size + 7, borderRadius: (size + 7) / 2 }]}
    >
      <View style={[styles.avatar, { width: size, height: size, borderRadius: size / 2, backgroundColor: theme.surface2 }]}>
        {user.avatar ? (
          <Image
            source={{ uri: user.avatar }}
            style={{ width: size, height: size }}
            contentFit="cover"
            recyclingKey={String(user.id)}
            transition={150}
          />
        ) : (
          <Text style={[styles.initials, { color: theme.text }]}>{user.username.slice(0, 2).toUpperCase()}</Text>
        )}
      </View>
    </LinearGradient>
  );
}

function PodiumPlace({
  user,
  myId,
  scoreLabel,
  index,
  onPress,
}: {
  user: RankingUser;
  myId: number | null;
  scoreLabel: string;
  index: number;
  onPress: () => void;
}) {
  const { theme } = useTheme();
  const reducedMotion = useReducedMotion();
  const entrance = useRef(new Animated.Value(reducedMotion ? 1 : 0)).current;
  const config = MEDALS[user.position as 1 | 2 | 3] ?? MEDALS[3];
  const isWinner = user.position === 1;
  const isMe = user.id === myId;

  useEffect(() => {
    if (reducedMotion) {
      entrance.setValue(1);
      return;
    }
    entrance.setValue(0);
    Animated.spring(entrance, {
      toValue: 1,
      delay: index * 90,
      damping: 14,
      stiffness: 115,
      mass: 0.8,
      useNativeDriver: true,
    }).start();
  }, [entrance, index, reducedMotion, user.id]);

  const towerHeight = isWinner ? 112 : user.position === 2 ? 82 : 66;
  const avatarSize = isWinner ? 72 : 58;
  return (
    <Animated.View
      style={[
        styles.placeWrap,
        isWinner && styles.winnerWrap,
        {
          opacity: entrance,
          transform: [
            { translateY: entrance.interpolate({ inputRange: [0, 1], outputRange: [28, 0] }) },
            { scale: entrance.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1] }) },
          ],
        },
      ]}
    >
      <TouchableOpacity
        activeOpacity={0.86}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`${user.position}. miejsce, ${user.username}, ${formatRankingScore(user.score, scoreLabel)} ${scoreLabel}`}
        style={styles.placePressable}
      >
        <View style={styles.identityBlock}>
          {isWinner ? (
            <MaterialCommunityIcons name="crown" size={28} color={config.color} style={styles.crown} />
          ) : null}
          <RankingAvatar user={user} size={avatarSize} accent={config.color} />
          <View style={[styles.positionBadge, { backgroundColor: config.color, borderColor: '#ffffff99' }]}>
            <Text style={[styles.positionBadgeText, { color: user.position === 2 ? '#26313D' : '#241400' }]}>
              {user.position}
            </Text>
          </View>
          <Text
            numberOfLines={1}
            style={[styles.podiumName, { color: user.nickColor || theme.text }, isWinner && styles.winnerName]}
          >
            {user.username}{isMe ? ' · TY' : ''}
          </Text>
          <Text numberOfLines={1} style={[styles.podiumScore, { color: config.color }]}>
            {formatRankingScore(user.score, scoreLabel)} <Text style={styles.podiumUnit}>{scoreLabel}</Text>
          </Text>
        </View>

        <LinearGradient
          colors={[`${config.color}EE`, config.dark, '#170B0B']}
          start={{ x: 0.15, y: 0 }}
          end={{ x: 0.85, y: 1 }}
          style={[
            styles.tower,
            { height: towerHeight, borderColor: `${config.color}AA`, shadowColor: config.color },
          ]}
        >
          <LinearGradient
            colors={['#FFFFFF35', 'transparent']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFillObject}
          />
          <Text style={[styles.towerNumber, { color: '#FFF' }]}>{user.position}</Text>
          <Text style={styles.towerLabel}>{config.label}</Text>
        </LinearGradient>
      </TouchableOpacity>
    </Animated.View>
  );
}

export function RankingPodium({
  users,
  myId,
  scoreLabel,
  onPressUser,
}: {
  users: RankingUser[];
  myId: number | null;
  scoreLabel: string;
  onPressUser: (id: number) => void;
}) {
  const { theme } = useTheme();
  const ordered = useMemo(() => {
    const first = users.find((u) => u.position === 1);
    const second = users.find((u) => u.position === 2);
    const third = users.find((u) => u.position === 3);
    if (users.length === 1) return first ? [first] : users;
    return [second, first, third].filter(Boolean) as RankingUser[];
  }, [users]);

  if (!ordered.length) return null;
  return (
    <View style={[styles.podiumShell, { borderColor: theme.border2, backgroundColor: theme.surface }]}>
      <LinearGradient
        colors={['#E338351D', 'transparent', '#FFD4470C']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFillObject}
      />
      <View style={[styles.ambientGlow, { backgroundColor: '#E3383520' }]} />
      <View style={[styles.podiumRow, ordered.length === 1 && styles.singlePodium]}>
        {ordered.map((user, index) => (
          <PodiumPlace
            key={user.id}
            user={user}
            myId={myId}
            scoreLabel={scoreLabel}
            index={index}
            onPress={() => onPressUser(user.id)}
          />
        ))}
      </View>
    </View>
  );
}

export function RankingPodiumSkeleton() {
  const { theme } = useTheme();
  const opacity = useRef(new Animated.Value(0.45)).current;
  const reducedMotion = useReducedMotion();
  useEffect(() => {
    if (reducedMotion) return;
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(opacity, { toValue: 0.85, duration: 650, useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 0.45, duration: 650, useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [opacity, reducedMotion]);
  return (
    <Animated.View style={[styles.skeletonShell, { opacity, backgroundColor: theme.surface, borderColor: theme.border2 }]}>
      {[74, 110, 58].map((height, index) => (
        <View key={height} style={styles.skeletonPlace}>
          <View style={[styles.skeletonAvatar, { backgroundColor: theme.surface2 }]} />
          <View style={[styles.skeletonLine, { backgroundColor: theme.surface2 }]} />
          <View style={[styles.skeletonTower, { height, backgroundColor: theme.surface2 }, index === 1 && { width: '100%' }]} />
        </View>
      ))}
    </Animated.View>
  );
}

export function RankingListRow({
  user,
  isMe,
  scoreLabel,
  onPress,
}: {
  user: RankingUser;
  isMe: boolean;
  scoreLabel: string;
  onPress: () => void;
}) {
  const { theme } = useTheme();
  return (
    <TouchableOpacity
      activeOpacity={0.86}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${user.position}. miejsce, ${user.username}, ${formatRankingScore(user.score, scoreLabel)} ${scoreLabel}`}
      style={[
        styles.row,
        { backgroundColor: theme.surface, borderColor: isMe ? theme.primary : theme.border2 },
        isMe && { backgroundColor: '#E3383512', shadowColor: theme.primary },
      ]}
    >
      <View style={[styles.rowPositionBox, { backgroundColor: user.position <= 10 ? '#E3383515' : theme.surface2 }]}>
        <Text style={[styles.rowPosition, { color: user.position <= 10 ? theme.primary : theme.textDim }]}>
          {user.position}
        </Text>
      </View>
      <RankingAvatar user={user} size={44} accent={isMe ? theme.primary : theme.border2} />
      <View style={styles.rowMain}>
        <View style={styles.nameLine}>
          <Text style={[styles.username, { color: user.nickColor || theme.text }]} numberOfLines={1}>
            {user.username}{isMe ? ' · TY' : ''}
          </Text>
          {user.isPremium ? (
            <View style={styles.premiumPill}><Text style={styles.premiumText}>PREMIUM</Text></View>
          ) : null}
        </View>
        <Text style={[styles.sub, { color: theme.textDim }]} numberOfLines={1}>{user.sub}</Text>
      </View>
      <View style={styles.scoreBox}>
        <Text style={[styles.score, { color: isMe ? theme.primary : theme.text }]}>
          {formatRankingScore(user.score, scoreLabel)}
        </Text>
        <Text style={[styles.scoreUnit, { color: theme.textDim }]}>{scoreLabel}</Text>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  podiumShell: { marginHorizontal: 16, borderWidth: 1, borderRadius: 24, paddingHorizontal: 8, paddingTop: 30, overflow: 'hidden' },
  ambientGlow: { position: 'absolute', width: 190, height: 190, borderRadius: 95, top: -105, alignSelf: 'center' },
  podiumRow: { minHeight: 300, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center', gap: 5 },
  singlePodium: { paddingHorizontal: '31%' },
  placeWrap: { flex: 1, maxWidth: 132, minWidth: 0 },
  winnerWrap: { zIndex: 3 },
  placePressable: { alignItems: 'stretch' },
  identityBlock: { alignItems: 'center', minHeight: 154, justifyContent: 'flex-end', paddingHorizontal: 2 },
  crown: { marginBottom: -2, textShadowColor: '#FFD44788', textShadowRadius: 10 },
  avatarRing: { alignItems: 'center', justifyContent: 'center', padding: 3.5 },
  avatar: { overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  initials: { fontFamily: 'Orbitron', fontSize: 13, fontWeight: '900' },
  positionBadge: { width: 24, height: 24, borderRadius: 12, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center', marginTop: -14 },
  positionBadgeText: { fontFamily: 'Orbitron', fontSize: 11, fontWeight: '900' },
  podiumName: { width: '100%', textAlign: 'center', fontFamily: 'Orbitron', fontSize: 9, fontWeight: '800', marginTop: 8 },
  winnerName: { fontSize: 10 },
  podiumScore: { fontFamily: 'Orbitron', fontSize: 11, fontWeight: '900', marginTop: 5, marginBottom: 10 },
  podiumUnit: { fontSize: 8 },
  tower: { borderWidth: 1, borderBottomWidth: 0, borderTopLeftRadius: 13, borderTopRightRadius: 13, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', shadowOpacity: 0.35, shadowRadius: 12, elevation: 7 },
  towerNumber: { fontFamily: 'Orbitron', fontSize: 30, fontWeight: '900', opacity: 0.95 },
  towerLabel: { color: '#FFFFFFB8', fontFamily: 'Orbitron', fontSize: 6, fontWeight: '800', letterSpacing: 0.7, marginTop: 2 },
  skeletonShell: { marginHorizontal: 16, height: 300, borderWidth: 1, borderRadius: 24, flexDirection: 'row', alignItems: 'flex-end', gap: 7, paddingHorizontal: 10 },
  skeletonPlace: { flex: 1, alignItems: 'center' },
  skeletonAvatar: { width: 54, height: 54, borderRadius: 27, marginBottom: 10 },
  skeletonLine: { width: '72%', height: 9, borderRadius: 5, marginBottom: 12 },
  skeletonTower: { width: '94%', borderTopLeftRadius: 12, borderTopRightRadius: 12 },
  row: { borderWidth: 1, borderRadius: 15, paddingVertical: 11, paddingHorizontal: 11, marginBottom: 9, flexDirection: 'row', alignItems: 'center', gap: 10, shadowOpacity: 0.12, shadowRadius: 9, elevation: 2 },
  rowPositionBox: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  rowPosition: { fontFamily: 'Orbitron', fontSize: 12, fontWeight: '900' },
  rowMain: { flex: 1, minWidth: 0 },
  nameLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  username: { flexShrink: 1, fontFamily: 'Orbitron', fontSize: 11, fontWeight: '800' },
  premiumPill: { borderRadius: 7, borderWidth: 1, borderColor: '#FFD70040', backgroundColor: '#FFD70018', paddingHorizontal: 5, paddingVertical: 2 },
  premiumText: { fontFamily: 'Orbitron', fontSize: 6, color: '#FFD700', fontWeight: '800' },
  sub: { fontSize: 11, marginTop: 4 },
  scoreBox: { alignItems: 'flex-end', minWidth: 58 },
  score: { fontFamily: 'Orbitron', fontSize: 13, fontWeight: '900' },
  scoreUnit: { fontSize: 9, marginTop: 2, textTransform: 'uppercase' },
});
