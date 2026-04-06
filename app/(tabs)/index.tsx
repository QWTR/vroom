import React, { useEffect, useState } from 'react';
import Toast from 'react-native-toast-message';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import {
  ActivityIndicator, Dimensions, Image, ScrollView,
  StyleSheet, TouchableOpacity, View, StatusBar, RefreshControl,
} from 'react-native';
import { Text } from '@react-navigation/elements';
import { LinearGradient } from 'expo-linear-gradient';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import FontAwesome5 from '@expo/vector-icons/FontAwesome5';
import { API_URL } from '../../constants/config';
import { useTheme } from '../../contexts/ThemeContext';

const { width } = Dimensions.get('window');

// ─── TYPY ─────────────────────────────────────────────────
type MainCar     = { brand: string; specs: string; photo: string | null };
type Achievement = { type: string; label: string; unlockedAt: string };
type User = {
  username: string; email: string; userId: string;
  avatar?: string; bio?: string; location?: string; createdAt?: string;
  position: number; points: number;
  totalDistance: number; monthlyDistance: number; weeklyDistance: number; dailyDistance: number;
  topSpeed: number; avgSpeed: string | number; avgMaxSpeed: string | number;
  totalRides: number; monthlyRides: number;
  streak: number; meetCount: number; cityCount: number; carCount: number;
  mainCar?: MainCar | null; spotCount: number;
  achievementCount: number; latestAchievement?: Achievement | null;
};

const getToken = async () =>
  (await AsyncStorage.getItem('userToken')) ?? (await AsyncStorage.getItem('token'));

async function fetchFreshUser(): Promise<User | null> {
  try {
    const token = await getToken();
    if (!token) return null;
    const meRes = await fetch(`${API_URL}/api/profile/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!meRes.ok) return null;
    const fresh = await meRes.json();
    const raw   = await AsyncStorage.getItem('user');
    if (!raw) return null;
    const old    = JSON.parse(raw);
    const merged = { ...old, ...fresh, avatar: fresh.avatarUrl ?? fresh.avatar ?? old.avatar ?? null };
    delete merged.avatarUrl;
    await AsyncStorage.setItem('user', JSON.stringify(merged));
    return merged;
  } catch { return null; }
}

// ─── MAIN ─────────────────────────────────────────────────
export default function HomeScreen() {
  const router = useRouter();
  const { theme, isDark } = useTheme();
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [user,       setUser]       = useState<User | null>(null);

  const t = theme; // skrót

  const loadUser = async (showSpinner = true) => {
    if (showSpinner) setLoading(true);
    try {
      const raw = await AsyncStorage.getItem('user');
      if (!raw) { router.replace('/login'); return; }
      const cached = JSON.parse(raw) as User;
      setUser(cached);
      setLoading(false);
      const fresh = await fetchFreshUser();
      if (fresh) setUser(fresh);
    } catch {
      Toast.show({ type: 'error', text1: 'BŁĄD SESJI', text2: 'Nie można odczytać danych sesji.' });
      router.replace('/login');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => { loadUser(); }, []);
  const onRefresh = () => { setRefreshing(true); loadUser(false); };

  if (loading || !user) {
    return (
      <View style={[styles.loadingContainer, { backgroundColor: t.bg }]}>
        <MaterialCommunityIcons name="car-sports" size={42} color="#e33835" />
        <Text style={[styles.loadingTitle, { color: '#e33835' }]}>VROOM</Text>
        <ActivityIndicator size="small" color="#e3383560" style={{ marginTop: 20 }} />
      </View>
    );
  }

  // ── Gradient hero zależny od trybu ──
  const heroGradient = isDark
    ? ['#200808', '#140404', '#0a0a0a'] as const
    : ['#fdeaea', '#fdf0f0', t.bg]     as const;

  const spotCardBorder  = isDark ? '#ffffff12' : '#00000012';
  const spotIconColor   = isDark ? '#ffffff55' : '#00000055';
  const spotTitleColor  = isDark ? '#ffffffcc' : '#000000cc';
  const spotArrowBg     = isDark ? '#ffffff08' : '#00000008';
  const spotArrowBorder = isDark ? '#ffffff15' : '#00000015';
  const spotArrowColor  = isDark ? '#ffffff40' : '#00000040';

  return (
    <>
      <StatusBar
        barStyle={isDark ? 'light-content' : 'dark-content'}
        backgroundColor={t.bg}
      />
      <ScrollView
        style={{ flex: 1, backgroundColor: t.bg }}
        contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 62 }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#e33835" colors={['#e33835']} />
        }
      >
        {/* ══ HERO ══ */}
        <View style={[styles.hero, { borderColor: t.primaryBorder }]}>
          <LinearGradient colors={heroGradient} start={{ x: 0, y: 0 }} end={{ x: 1.3, y: 1 }} style={StyleSheet.absoluteFill} />
          <View style={[styles.blob, { top: -70,   right: -50, width: 220, height: 220, opacity: 0.15 }]} />
          <View style={[styles.blob, { bottom: -50, left: -30, width: 140, height: 140, opacity: 0.07 }]} />

          {/* TOP ROW */}
          <View style={styles.heroTop}>
            <View style={[styles.onlinePill]}>
              <View style={styles.onlineDot} />
              <Text style={styles.onlineTxt}>ONLINE</Text>
            </View>
            <TouchableOpacity onPress={() => router.push('/account')}
              style={[styles.avatarBtn, { backgroundColor: t.primaryBg, borderColor: t.primaryBorder }]}>
              {user.avatar
                ? <Image source={{ uri: user.avatar }} style={styles.avatarImg} />
                : <MaterialIcons name="person-outline" size={22} color="#e33835" />}
            </TouchableOpacity>
          </View>

          <Text style={[styles.heroGreet, { color: t.textDim }]}>WITAMY Z POWROTEM</Text>
          <Text style={[styles.heroName,  { color: t.text }]}>{user.username}</Text>

          {user.mainCar && (
            <View style={[styles.carPill, { backgroundColor: t.primaryBg, borderColor: t.primaryBorder }]}>
              <MaterialCommunityIcons name="car-sports" size={12} color="#e33835" />
              <Text style={[styles.carPillTxt, { color: t.textMuted }]}>
                {user.mainCar.brand} · {user.mainCar.specs}
              </Text>
            </View>
          )}

          <View style={[styles.heroSep, { backgroundColor: t.border }]} />

          <View style={styles.heroStatsRow}>
            <HeroStat label="POZYCJA" value={`#${user.position ?? '—'}`} textColor={t.text} lblColor={t.textDim} />
            <View style={[styles.heroStatLine, { backgroundColor: t.border }]} />
            <HeroStat label="PUNKTY"  value={String(user.points ?? 0)}      textColor={t.text} lblColor={t.textDim} />
            <View style={[styles.heroStatLine, { backgroundColor: t.border }]} />
            <HeroStat label="STREAK"  value={`${user.streak ?? 0}`}         textColor={t.text} lblColor={t.textDim} />
          </View>

          {user.latestAchievement && (
            <View style={styles.achievePill}>
              <MaterialIcons name="emoji-events" size={12} color="#f5c518" />
              <Text style={styles.achieveTxt}>Ostatnie: {user.latestAchievement.label}</Text>
            </View>
          )}
        </View>

        {/* ══ QUICK NAV ══ */}
        <SectionLabel text="NAWIGACJA" color={t.textDim} />
        <View style={styles.navRow}>
          <NavBtn icon={<MaterialIcons name="map"               size={24} color="#e33835" />} label="MAPA"    onPress={() => router.push('/map')}                        bg={t.surface2} border={t.border} lblColor={t.textMuted} />
          <NavBtn icon={<MaterialCommunityIcons name="car-multiple" size={24} color="#e33835" />} label="MEETY"   onPress={() => router.push('/Community/meets/events')} bg={t.surface2} border={t.border} lblColor={t.textMuted} />
          <NavBtn icon={<MaterialIcons name="leaderboard"       size={24} color="#e33835" />} label="RANKING" onPress={() => router.push('/Community/Ranks/stats')}      bg={t.surface2} border={t.border} lblColor={t.textMuted} />
          <NavBtn icon={<MaterialIcons name="chat-bubble-outline" size={24} color="#e33835" />} label="CZAT"   onPress={() => router.push('/(tabs)/community')}          bg={t.surface2} border={t.border} lblColor={t.textMuted} />
        </View>

        {/* ══ STATYSTYKI ══ */}
        <SectionLabel text="STATYSTYKI" color={t.textDim} />
        <View style={[styles.speedCard, { backgroundColor: t.surface, borderColor: t.primaryBorder }]}>
          <LinearGradient colors={['#e3383528', '#e3383508', 'transparent']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
          <View style={[styles.blob, { top: -30, right: 0, width: 110, height: 110, opacity: 0.18 }]} />
          <View style={styles.speedLeft}>
            <View style={styles.cardIconRow}>
              <View style={[styles.iconWrap, { backgroundColor: t.primaryBg }]}>
                <MaterialCommunityIcons name="speedometer" size={16} color="#e33835" />
              </View>
              <Text style={[styles.cardLbl, { color: t.textDim }]}>TOP SPEED</Text>
              <View style={[styles.badge, { backgroundColor: t.primaryBg, borderColor: t.primaryBorder }]}>
                <Text style={styles.badgeTxt}>REKORD</Text>
              </View>
            </View>
            <Text style={styles.speedVal}>{user.topSpeed ?? 0}</Text>
            <Text style={[styles.speedUnit, { color: t.textDim }]}>km/h</Text>
          </View>
          <View style={styles.speedRight}>
            <MiniStat label="ŚREDNIA"     value={`${user.avgSpeed} km/h`}          textColor={t.text} lblColor={t.textDim} />
            <MiniStat label="TRASY"       value={String(user.totalRides ?? 0)}      textColor={t.text} lblColor={t.textDim} />
            <MiniStat label="MIESIĘCZNIE" value={String(user.monthlyRides ?? 0)}    textColor={t.text} lblColor={t.textDim} />
          </View>
        </View>

        {/* DISTANCE ROWS */}
        <View style={styles.row2}>
          <DistCard icon={<MaterialCommunityIcons name="road-variant" size={17} color="#e33835" />} label="TEN TYDZIEŃ" value={`${Math.round(user.weeklyDistance)}`}  unit="km"   bg={t.surface} border={t.border} iconBg={t.primaryBg} lbl={t.textDim} val={t.text} />
          <DistCard icon={<FontAwesome5 name="route"                  size={15} color="#e33835" />} label="TEN MIESIĄC" value={`${Math.round(user.monthlyDistance)}`} unit="km"   bg={t.surface} border={t.border} iconBg={t.primaryBg} lbl={t.textDim} val={t.text} />
        </View>
        <View style={styles.row2}>
          <DistCard icon={<MaterialIcons name="straighten"   size={17} color="#e33835" />} label="ŁĄCZNIE" value={`${Math.round(user.totalDistance)}`} unit="km"   bg={t.surface} border={t.border} iconBg={t.primaryBg} lbl={t.textDim} val={t.text} />
          <DistCard icon={<MaterialIcons name="location-city" size={17} color="#e33835" />} label="MIASTA" value={String(user.cityCount ?? 0)}          unit="odw." bg={t.surface} border={t.border} iconBg={t.primaryBg} lbl={t.textDim} val={t.text} />
        </View>

        {/* GARAŻ + SPOTY */}
        <View style={styles.row2}>
          <TouchableOpacity style={[styles.distCard, { backgroundColor: t.surface, borderColor: t.border }]} onPress={() => router.push('/account')} activeOpacity={0.8}>
            <View style={styles.cardIconRow}>
              <View style={[styles.iconWrap, { backgroundColor: t.primaryBg }]}>
                <MaterialCommunityIcons name="garage" size={17} color="#e33835" />
              </View>
              <Text style={[styles.cardLbl, { color: t.textDim }]}>GARAŻ</Text>
            </View>
            <Text style={[styles.distVal, { color: t.text }]}>{user.carCount ?? 0}</Text>
            <Text style={[styles.distUnit, { color: t.textDim }]}>aut</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.distCard, { backgroundColor: t.surface, borderColor: t.border }]} onPress={() => router.push('/(tabs)/spotmap')} activeOpacity={0.8}>
            <View style={styles.cardIconRow}>
              <View style={[styles.iconWrap, { backgroundColor: t.primaryBg }]}>
                <MaterialIcons name="place" size={17} color="#e33835" />
              </View>
              <Text style={[styles.cardLbl, { color: t.textDim }]}>SPOTY</Text>
            </View>
            <Text style={[styles.distVal, { color: t.text }]}>{user.spotCount ?? 0}</Text>
            <Text style={[styles.distUnit, { color: t.textDim }]}>dodane</Text>
          </TouchableOpacity>
        </View>

        {/* MEETY + OSIĄGNIĘCIA */}
        <View style={[styles.row2, { marginBottom: 28 }]}>
          <TouchableOpacity style={[styles.distCard, { backgroundColor: t.surface, borderColor: t.border }]} onPress={() => router.push('/Community/meets/events')} activeOpacity={0.8}>
            <View style={styles.cardIconRow}>
              <View style={[styles.iconWrap, { backgroundColor: t.primaryBg }]}>
                <MaterialCommunityIcons name="flag-checkered" size={17} color="#e33835" />
              </View>
              <Text style={[styles.cardLbl, { color: t.textDim }]}>MEETY</Text>
            </View>
            <Text style={[styles.distVal, { color: t.text }]}>{user.meetCount ?? 0}</Text>
            <Text style={[styles.distUnit, { color: t.textDim }]}>łącznie</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.distCard, { backgroundColor: t.surface, borderColor: t.border }]} onPress={() => router.push('/account')} activeOpacity={0.8}>
            <View style={styles.cardIconRow}>
              <View style={[styles.iconWrap, { backgroundColor: t.primaryBg }]}>
                <MaterialIcons name="emoji-events" size={17} color="#e33835" />
              </View>
              <Text style={[styles.cardLbl, { color: t.textDim }]}>OSIĄGNIĘCIA</Text>
            </View>
            <Text style={[styles.distVal, { color: t.text }]}>{user.achievementCount ?? 0}</Text>
            <Text style={[styles.distUnit, { color: t.textDim }]}>odblokowane</Text>
          </TouchableOpacity>
        </View>

        {/* ══ SPOŁECZNOŚĆ ══ */}
        <SectionLabel text="SPOŁECZNOŚĆ" color={t.textDim} />
        <TouchableOpacity onPress={() => router.push('/(tabs)/community')} activeOpacity={0.82}
          style={[styles.communityCard, { borderColor: t.primaryBorder }]}>
          <LinearGradient colors={['#e3383522', '#e3383508', 'transparent']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
          <View style={[styles.blob, { left: -20, top: -20, width: 80, height: 80, opacity: 0.2 }]} />
          <View style={[styles.communityIconWrap, { backgroundColor: t.primaryBg, borderColor: t.primaryBorder }]}>
            <MaterialIcons name="chat-bubble-outline" size={26} color="#e33835" />
          </View>
          <View style={styles.communityText}>
            <Text style={[styles.communityTitle, { color: t.text }]}>Czat & Znajomi</Text>
            <Text style={[styles.communitySub,  { color: t.textDim }]}>Napisz do kogoś · Sprawdź co słychać</Text>
          </View>
          <View style={[styles.communityArrow, { backgroundColor: t.primaryBg, borderColor: t.primaryBorder }]}>
            <MaterialIcons name="arrow-forward-ios" size={14} color="#e33835" />
          </View>
        </TouchableOpacity>

        {/* SPOT MAP BANNER */}
        <TouchableOpacity onPress={() => router.push('/(tabs)/spotmap')} activeOpacity={0.82}
          style={[styles.spotCard, { borderColor: spotCardBorder }]}>
          <LinearGradient colors={[isDark ? '#ffffff0a' : '#0000000a', isDark ? '#ffffff03' : '#00000003', 'transparent']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
          <View style={[styles.communityIconWrap, { backgroundColor: t.primaryBg, borderColor: t.primaryBorder }]}>
            <MaterialIcons name="place" size={26} color={spotIconColor} />
          </View>
          <View style={styles.communityText}>
            <Text style={[styles.communityTitle, { color: spotTitleColor }]}>Mapa Spotów</Text>
            <Text style={[styles.communitySub,   { color: t.textDim }]}>Znajdź miejsca · Dodaj nowy spot</Text>
          </View>
          <View style={[styles.communityArrow, { backgroundColor: spotArrowBg, borderColor: spotArrowBorder }]}>
            <MaterialIcons name="arrow-forward-ios" size={14} color={spotArrowColor} />
          </View>
        </TouchableOpacity>

        <View style={{ height: 50 }} />
      </ScrollView>
    </>
  );
}

// ─── SUB-COMPONENTS ───────────────────────────────────────
function SectionLabel({ text, color }: { text: string; color: string }) {
  return <Text style={[styles.sectionLbl, { color }]}>{text}</Text>;
}

function HeroStat({ label, value, textColor, lblColor }: { label: string; value: string; textColor: string; lblColor: string }) {
  return (
    <View style={styles.heroStatItem}>
      <Text style={[styles.heroStatVal, { color: textColor }]}>{value}</Text>
      <Text style={[styles.heroStatLbl, { color: lblColor }]}>{label}</Text>
    </View>
  );
}

function NavBtn({ icon, label, onPress, bg, border, lblColor }: {
  icon: React.ReactNode; label: string; onPress: () => void;
  bg: string; border: string; lblColor: string;
}) {
  return (
    <TouchableOpacity style={[styles.navBtn, { backgroundColor: bg, borderColor: border }]} onPress={onPress} activeOpacity={0.72}>
      <View style={styles.navIconWrap}>{icon}</View>
      <Text style={[styles.navLbl, { color: lblColor }]}>{label}</Text>
    </TouchableOpacity>
  );
}

function MiniStat({ label, value, textColor, lblColor }: { label: string; value: string; textColor: string; lblColor: string }) {
  return (
    <View style={styles.miniStat}>
      <Text style={[styles.miniStatVal, { color: textColor }]}>{value}</Text>
      <Text style={[styles.miniStatLbl, { color: lblColor }]}>{label}</Text>
    </View>
  );
}

function DistCard({ icon, label, value, unit, bg, border, iconBg, lbl, val }: {
  icon: React.ReactNode; label: string; value: string; unit: string;
  bg: string; border: string; iconBg: string; lbl: string; val: string;
}) {
  return (
    <View style={[styles.distCard, { backgroundColor: bg, borderColor: border }]}>
      <View style={styles.cardIconRow}>
        <View style={[styles.iconWrap, { backgroundColor: iconBg }]}>{icon}</View>
        <Text style={[styles.cardLbl, { color: lbl }]}>{label}</Text>
      </View>
      <Text style={[styles.distVal,  { color: val }]}>{value}</Text>
      <Text style={[styles.distUnit, { color: lbl }]}>{unit}</Text>
    </View>
  );
}

// ─── STYLES (statyczne — kolory przekazywane inline) ──────
const styles = StyleSheet.create({
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 8 },
  loadingTitle:     { fontFamily: 'Orbitron', fontSize: 22, letterSpacing: 8, marginTop: 6 },
  blob:             { position: 'absolute', borderRadius: 999, backgroundColor: '#e33835' },

  hero:          { borderRadius: 20, borderWidth: 1, padding: 22, marginBottom: 28, overflow: 'hidden', position: 'relative' },
  heroTop:       { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 },
  onlinePill:    { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: '#4de92612', borderWidth: 1, borderColor: '#4de92635', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  onlineDot:     { width: 5, height: 5, borderRadius: 3, backgroundColor: '#4de926' },
  onlineTxt:     { fontFamily: 'Orbitron', fontSize: 8, color: '#4de926', letterSpacing: 2 },
  avatarBtn:     { width: 42, height: 42, borderRadius: 21, overflow: 'hidden', borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  avatarImg:     { width: 42, height: 42, borderRadius: 21 },
  heroGreet:     { fontFamily: 'Orbitron', fontSize: 8, letterSpacing: 3, marginBottom: 5 },
  heroName:      { fontFamily: 'Orbitron', fontSize: 32, fontWeight: '700', letterSpacing: 0.5, marginBottom: 10 },
  carPill:       { flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start', borderWidth: 1, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20, marginBottom: 18 },
  carPillTxt:    { fontFamily: 'Orbitron', fontSize: 9 },
  heroSep:       { height: 1, marginBottom: 18 },
  heroStatsRow:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  heroStatItem:  { flex: 1, alignItems: 'center' },
  heroStatVal:   { fontFamily: 'Orbitron', fontSize: 21, fontWeight: '700' },
  heroStatLbl:   { fontFamily: 'Orbitron', fontSize: 7, letterSpacing: 2, marginTop: 3 },
  heroStatLine:  { width: 1, height: 32 },
  achievePill:   { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 16, alignSelf: 'flex-start', backgroundColor: '#f5c51815', borderWidth: 1, borderColor: '#f5c51830', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  achieveTxt:    { fontFamily: 'Orbitron', fontSize: 8, color: '#f5c518b0' },
  sectionLbl:    { fontFamily: 'Orbitron', fontSize: 8, letterSpacing: 4, marginBottom: 12 },
  navRow:        { flexDirection: 'row', gap: 8, marginBottom: 28 },
  navBtn:        { flex: 1, borderRadius: 14, borderWidth: 1, paddingVertical: 16, alignItems: 'center', gap: 10 },
  navIconWrap:   { backgroundColor: '#e3383518', padding: 9, borderRadius: 10 },
  navLbl:        { fontFamily: 'Orbitron', fontSize: 6.5, letterSpacing: 0.3 },
  speedCard:     { borderRadius: 18, borderWidth: 1, padding: 20, marginBottom: 10, overflow: 'hidden', position: 'relative', flexDirection: 'row', alignItems: 'center', gap: 16 },
  speedLeft:     { flex: 1 },
  speedVal:      { fontFamily: 'Orbitron', fontSize: 54, color: '#e33835', fontWeight: '700', letterSpacing: -2, marginTop: 4 },
  speedUnit:     { fontFamily: 'Orbitron', fontSize: 9, letterSpacing: 2 },
  speedRight:    { gap: 12, alignItems: 'flex-end' },
  miniStat:      { alignItems: 'flex-end', gap: 2 },
  miniStatVal:   { fontFamily: 'Orbitron', fontSize: 14, fontWeight: '700' },
  miniStatLbl:   { fontFamily: 'Orbitron', fontSize: 7, letterSpacing: 1 },
  row2:          { flexDirection: 'row', gap: 10, marginBottom: 10 },
  distCard:      { flex: 1, borderRadius: 16, borderWidth: 1, padding: 16, gap: 2 },
  cardIconRow:   { flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 8 },
  iconWrap:      { padding: 5, borderRadius: 7 },
  cardLbl:       { fontFamily: 'Orbitron', fontSize: 7.5, letterSpacing: 1, flexShrink: 1 },
  distVal:       { fontFamily: 'Orbitron', fontSize: 26, fontWeight: '700', letterSpacing: -0.5 },
  distUnit:      { fontFamily: 'Orbitron', fontSize: 8, letterSpacing: 1 },
  badge:         { marginLeft: 'auto', borderWidth: 1, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 },
  badgeTxt:      { fontFamily: 'Orbitron', fontSize: 7, color: '#e33835', letterSpacing: 1 },
  communityCard: { borderRadius: 16, borderWidth: 1, padding: 18, flexDirection: 'row', alignItems: 'center', gap: 14, overflow: 'hidden', position: 'relative', marginBottom: 10 },
  spotCard:      { borderRadius: 16, borderWidth: 1, padding: 18, flexDirection: 'row', alignItems: 'center', gap: 14, overflow: 'hidden', position: 'relative', marginBottom: 10 },
  communityIconWrap: { padding: 12, borderRadius: 12, borderWidth: 1 },
  communityText: { flex: 1, gap: 4 },
  communityTitle:{ fontFamily: 'Orbitron', fontSize: 14, fontWeight: '700' },
  communitySub:  { fontFamily: 'Orbitron', fontSize: 9, letterSpacing: 0.3 },
  communityArrow:{ padding: 8, borderRadius: 8, borderWidth: 1 },
});