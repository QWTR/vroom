import React, { useEffect } from 'react';
import { Image, StyleSheet, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import Animated, { cancelAnimation, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import Svg, { Circle, Path } from 'react-native-svg';
import { AppText as Text } from '../ui/AppText';
import { StaticHudGrid } from '../motion/vroomHudPrimitives';
import { useTheme } from '../../contexts/ThemeContext';
import { useReadability } from '../../contexts/ReadabilityContext';
import { withAlpha } from '../../constants/theme';
import { allowNotificationCenterEntry } from '../../lib/notifications/notificationCenterAccess';
import { useAccountProgression } from '../../hooks/useAccountProgression';
import { AccountRewardModal } from '../profile/AccountRewardModal';

type Props = {
  user: {
    username: string; avatar?: string; location?: string;
    position: number; points: number; totalDistance: number; totalRides: number;
    mainCar?: { brand: string; specs: string; photo: string | null } | null;
  };
  topInset: number; onlineCount: number | null; unread: number; premium: boolean;
  premiumBadge: React.ReactNode; streak: React.ReactNode;
  active: boolean; reduceMotion: boolean;
};

const number = (value: unknown) => Math.max(0, Number(value) || 0).toLocaleString('pl-PL', { maximumFractionDigits: 0 });

export function HomeCockpit({ user, topInset, onlineCount, unread, premium, premiumBadge, streak, active, reduceMotion }: Props) {
  const router = useRouter();
  const { data: progression } = useAccountProgression();
  const { theme: t, isDark } = useTheme();
  const { width, fontScale } = useWindowDimensions();
  const { textScale } = useReadability();
  const expanded = width < 370 || fontScale * textScale >= 1.2;
  const intro = useSharedValue(1);
  const entrance = useAnimatedStyle(() => ({ opacity: intro.value, transform: [{ translateY: (1 - intro.value) * 16 }] }));
  const panel = isDark ? '#111216' : t.surface;
  const border = isDark ? '#ffffff18' : t.border3;

  useEffect(() => {
    if (!active || reduceMotion) { intro.value = 1; return; }
    intro.value = 0;
    intro.value = withTiming(1, { duration: 420 });
    return () => cancelAnimation(intro);
  }, [active, intro, reduceMotion]);

  const openMap = () => {
    void Haptics.selectionAsync().catch(() => {});
    router.push('/map');
  };

  return (
    <View testID="home-cockpit" style={{ paddingTop: topInset + 12, paddingBottom: 22 }}>
      <AccountRewardModal />
      <View style={[s.topBar, expanded && s.wrap]}>
        <View style={s.brandRow}>
          <View style={[s.brandMark, { backgroundColor: t.primary }]}><MaterialCommunityIcons name="car-sports" size={23} color="#fff" /></View>
          <View><Text style={[s.brand, { color: t.text }]}>VROOM</Text><Text style={[s.micro, { color: t.primary }]}>DRIVER HQ</Text></View>
        </View>
        <View style={s.actions}>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="VROOM Premium" onPress={() => router.push('/premium')} style={[s.iconButton, { backgroundColor: panel, borderColor: premium ? t.gold : border }]}>{premiumBadge}</TouchableOpacity>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel={unread ? 'Powiadomienia, nieprzeczytane: ' + unread : 'Powiadomienia'} onPress={() => { allowNotificationCenterEntry(); router.push('/notifications'); }} style={[s.iconButton, { backgroundColor: panel, borderColor: border }]}>
            <MaterialIcons name="notifications-none" size={23} color={t.text} />
            {unread > 0 && <View style={s.badge}><Text contrastBackground="#e33835" style={s.badgeText}>{unread > 99 ? '99+' : unread}</Text></View>}
          </TouchableOpacity>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Twój profil" onPress={() => router.navigate('/(tabs)/account')} style={[s.iconButton, { backgroundColor: panel, borderColor: border, overflow: 'hidden' }]}>
            {user.avatar ? <Image source={{ uri: user.avatar }} style={StyleSheet.absoluteFillObject} /> : <Text style={{ color: t.primary, fontWeight: '900', fontSize: 19 }}>{user.username.charAt(0).toUpperCase()}</Text>}
          </TouchableOpacity>
        </View>
      </View>

      <Animated.View style={[s.body, entrance]}>
        <View style={[s.sessionRow, expanded && s.wrap]}>
          <View style={s.location}><MaterialIcons name="location-on" size={14} color={t.textDim} /><Text numberOfLines={1} style={[s.micro, { color: t.textDim, flexShrink: 1 }]}>{user.location || 'TWOJA STREFA'}</Text></View>
          <View style={s.online}><View style={[s.dot, { backgroundColor: isDark ? '#7ce3ac' : '#207347' }]} /><Text style={[s.micro, { color: isDark ? '#7ce3ac' : '#207347' }]}>{onlineCount == null ? 'ŁĄCZENIE…' : number(onlineCount) + ' ONLINE'}</Text></View>
        </View>

        <View style={[s.hero, { backgroundColor: panel, borderColor: border }]}>
          <View pointerEvents="none" style={[StyleSheet.absoluteFillObject, { overflow: 'hidden', borderRadius: 22 }]}>
            <LinearGradient colors={isDark ? ['#1f1014', '#101115', '#111216'] : [withAlpha(t.primary, '15'), t.surface, t.surface]} style={StyleSheet.absoluteFillObject} />
            <StaticHudGrid isDark={isDark} primary={t.primary} />
            <View style={[s.speedLine, { backgroundColor: withAlpha(t.primary, '22') }]} />
            <View style={[s.speedLine, { top: 105, right: -30, backgroundColor: withAlpha(t.primary, '12') }]} />
          </View>
          <View style={[s.heroTop, expanded && s.wrap]}>
            <Text style={[s.micro, { color: t.primary, flexShrink: 1 }]}>TWÓJ DZIEŃ. TWOJA TRASA.</Text>
            <View accessible={false} importantForAccessibility="no-hide-descendants" style={s.lights}>{[0, 1, 2, 3, 4].map(i => <View key={i} style={[s.light, { backgroundColor: i === 4 ? t.primary : withAlpha(t.primary, '35') }]} />)}</View>
          </View>
          <Text style={[s.greeting, { color: t.textDim }]}>Siema, <Text style={{ color: t.text, fontWeight: '800' }}>{user.username}</Text></Text>
          <Text style={[s.headline, { color: t.text, fontSize: width < 370 ? 32 : 39 }]}>GOTOWY</Text>
          <Text style={[s.headline, { color: t.primary, fontSize: width < 370 ? 32 : 39 }]}>NA TRASĘ?</Text>

          <TouchableOpacity accessibilityRole="button" accessibilityLabel={user.mainCar ? 'Zobacz swój garaż' : 'Dodaj pierwsze auto'} onPress={() => user.mainCar ? router.navigate('/(tabs)/account') : router.push('/profile/add-car')} style={[s.car, { borderColor: border, backgroundColor: withAlpha(t.surface3, 'bb') }]}>
            <View style={[s.carImage, { backgroundColor: t.surface3 }]}>{user.mainCar?.photo ? <Image source={{ uri: user.mainCar.photo }} resizeMode="cover" style={StyleSheet.absoluteFillObject} /> : <MaterialCommunityIcons name="car-sports" size={28} color={t.primary} />}</View>
            <View style={{ flex: 1, minWidth: 0 }}><Text style={[s.micro, { color: t.textDim }]}>{user.mainCar ? 'W TWOIM GARAŻU' : 'TWÓJ GARAŻ'}</Text><Text style={[s.carName, { color: t.text }]}>{user.mainCar ? user.mainCar.brand + ' ' + user.mainCar.specs : 'Dodaj swoje pierwsze auto'}</Text></View>
            <MaterialIcons name="arrow-forward" size={20} color={t.primary} />
          </TouchableOpacity>
          <TouchableOpacity testID="home-open-map" accessibilityRole="button" accessibilityLabel="Otwórz mapę VROOM" onPress={openMap} activeOpacity={0.85} style={[s.cta, { backgroundColor: t.primary }]}>
            <MaterialCommunityIcons name="map-marker-path" size={22} color="#fff" /><Text contrastBackground={t.primary} style={s.ctaText}>RUSZAMY W TRASĘ</Text><MaterialIcons name="arrow-forward" size={24} color="#fff" />
          </TouchableOpacity>
          <Text style={[s.mapHint, { color: t.textDim }]}>Mapa · nawigacja · kierowcy w pobliżu</Text>
        </View>

        <View style={s.sectionHeading}><Text style={[s.micro, { color: t.primary }]}>01 / TWOJE TEMPO</Text><View style={[s.rule, { backgroundColor: border }]} /><MaterialCommunityIcons name="speedometer" size={17} color={t.textDim} /></View>
        <View style={[s.stats, expanded && s.statsExpanded, { backgroundColor: panel, borderColor: border }]}>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Zobacz ranking" onPress={() => router.push('/Community/Ranks/stats')} style={[s.stat, expanded ? s.statWide : s.statDivider, { borderColor: border }]}>
            <MaterialIcons name="leaderboard" size={17} color={t.primary} /><Text style={[s.statValue, { color: t.text }]}>{user.position > 0 ? '#' + number(user.position) : '—'}</Text><Text style={[s.micro, { color: t.textDim }]}>POZYCJA</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => progression?.enabled && router.push('/profile/level' as any)} disabled={!progression?.enabled} style={[s.stat, expanded ? s.statWide : s.statDivider, { borderColor: border }]}>
            <MaterialIcons name="stars" size={17} color={t.primary} /><Text style={[s.statValue, { color: t.text }]}>{number(progression?.enabled ? progression.level : user.points)}</Text><Text style={[s.micro, { color: t.textDim }]}>{progression?.enabled ? 'POZIOM' : 'PUNKTY'}</Text>
            {progression?.enabled && <><View style={{ width: '80%', height: 4, backgroundColor: border, borderRadius: 2 }}><View style={{ width: `${Math.min(100, progression.progress * 100)}%`, height: 4, backgroundColor: t.primary }} /></View><Text style={{ color: t.textDim, fontSize: 10 }}>{progression.xpToNextLevel} XP do awansu</Text></>}
          </TouchableOpacity>
          <View style={[s.stat, expanded && s.statWide]}>{streak}</View>
        </View>

        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Zobacz historię przejazdów" onPress={() => router.push('/profile/history-rides')} style={[s.telemetry, expanded && s.wrap, { borderColor: border }]}>
          <View style={{ flex: 1, minWidth: 150 }}><Text style={[s.micro, { color: t.textDim }]}>KILOMETRY ZA TOBĄ</Text><Text style={[s.distance, { color: t.text }]}>{number(user.totalDistance)} <Text style={[s.micro, { color: t.textDim }]}>KM</Text></Text><Text style={{ color: t.textDim, fontSize: 12 }}>{number(user.totalRides)} przejazdów · Twoja historia</Text></View>
          <View pointerEvents="none" accessible={false} importantForAccessibility="no-hide-descendants" style={{ width: 100, height: 64 }}><Svg viewBox="0 0 120 76" width="100%" height="100%"><Path d="M8 57 L28 57 Q36 57 36 48 L36 24 Q36 14 46 14 L93 14 Q107 14 107 27 L107 44 Q107 56 94 56 L70 56 Q60 56 60 45 L60 37 Q60 30 52 30 L48 30" stroke={withAlpha(t.primary, '30')} strokeWidth={10} fill="none" /><Path d="M8 57 L28 57 Q36 57 36 48 L36 24 Q36 14 46 14 L93 14 Q107 14 107 27 L107 44 Q107 56 94 56 L70 56 Q60 56 60 45 L60 37 Q60 30 52 30 L48 30" stroke={t.primary} strokeWidth={2} fill="none" /><Circle cx={8} cy={57} r={4} fill={t.primary} /><Circle cx={48} cy={30} r={4} fill={t.text} /></Svg></View>
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
}

const s = StyleSheet.create({
  topBar: { paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 },
  brandMark: { width: 35, height: 35, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  brand: { fontSize: 19, fontWeight: '900', letterSpacing: 1 },
  micro: { fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  iconButton: { width: 44, height: 44, borderRadius: 14, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  badge: { position: 'absolute', right: -3, top: -4, minWidth: 18, paddingHorizontal: 3, borderRadius: 8, backgroundColor: '#e33835', alignItems: 'center' },
  badgeText: { fontSize: 10, color: '#fff', fontWeight: '900' },
  body: { paddingHorizontal: 20 },
  sessionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginVertical: 20 },
  location: { flexDirection: 'row', alignItems: 'center', gap: 4, flex: 1, minWidth: 0 },
  online: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 5, height: 5, borderRadius: 3 },
  wrap: { flexWrap: 'wrap' },
  hero: { borderRadius: 22, borderWidth: 1, padding: 20 },
  heroTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 23 },
  lights: { flexDirection: 'row', gap: 4 },
  light: { width: 6, height: 14, borderRadius: 2, transform: [{ skewX: '-16deg' }] },
  speedLine: { position: 'absolute', width: 120, height: 340, right: 0, top: 45, transform: [{ rotate: '32deg' }] },
  greeting: { fontSize: 13, marginBottom: 8 },
  headline: { fontWeight: '900', letterSpacing: -1.7, lineHeight: 44 },
  car: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderWidth: 1, borderRadius: 13, marginTop: 24, marginBottom: 13 },
  carImage: { width: 50, height: 45, borderRadius: 8, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  carName: { fontSize: 13, fontWeight: '800', marginTop: 3 },
  cta: { minHeight: 56, borderRadius: 13, paddingHorizontal: 15, paddingVertical: 14, flexDirection: 'row', alignItems: 'center', gap: 10 },
  ctaText: { flex: 1, color: '#fff', fontSize: 13, fontWeight: '900', letterSpacing: 0.8 },
  mapHint: { textAlign: 'center', fontSize: 11, marginTop: 12 },
  sectionHeading: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 24, marginBottom: 12 },
  rule: { height: 1, flex: 1 },
  stats: { flexDirection: 'row', borderWidth: 1, borderRadius: 18, paddingVertical: 16 },
  statsExpanded: { flexWrap: 'wrap', gap: 18 },
  stat: { flex: 1, minWidth: 0, alignItems: 'center', justifyContent: 'flex-start', gap: 5, paddingHorizontal: 6 },
  statWide: { flexBasis: '100%' },
  statDivider: { borderRightWidth: 1 },
  statValue: { fontSize: 25, fontWeight: '900', letterSpacing: -0.6, textAlign: 'center' },
  telemetry: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 14, borderBottomWidth: 1, paddingVertical: 20 },
  distance: { fontSize: 29, fontWeight: '900', letterSpacing: -0.8, marginVertical: 4 },
});
