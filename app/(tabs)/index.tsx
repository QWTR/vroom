import React, { useEffect, useState } from 'react';
import Toast from 'react-native-toast-message';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import {
  ActivityIndicator,
  Dimensions,
  Image,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
  StatusBar,
} from 'react-native';
import { Text } from '@react-navigation/elements';
import { LinearGradient } from 'expo-linear-gradient';

import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import Feather from '@expo/vector-icons/Feather';
import FontAwesome5 from '@expo/vector-icons/FontAwesome5';
import Ionicons from '@expo/vector-icons/Ionicons';

const { width } = Dimensions.get('window');
const CARD_W = (width - 48 - 10) / 2;

// ─── TYPY ────────────────────────────────────────────────
type MainCar = { brand: string; specs: string; photo: string | null };
type Achievement = { type: string; label: string; unlockedAt: string };

type User = {
  username: string;
  email: string;
  userId: string;
  avatar?: string;
  bio?: string;
  location?: string;
  createdAt?: string;
  position: number;
  points: number;
  totalDistance: number;
  monthlyDistance: string | number;
  weeklyDistance: string | number;
  dailyDistance: number;
  topSpeed: number;
  avgMaxSpeed: string | number;
  totalRides: number;
  monthlyRides: number;
  streak: number;
  meetCount: number;
  cityCount: number;
  carCount: number;
  mainCar?: MainCar | null;
  spotCount: number;
  achievementCount: number;
  latestAchievement?: Achievement | null;
};

// ─── MAIN ────────────────────────────────────────────────
export default function HomeScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    const checkSession = async () => {
      try {
        const data = await AsyncStorage.getItem('user');
        if (data) {
          setUser(JSON.parse(data));
          setLoading(false);
        } else {
          Toast.show({ type: 'error', text1: 'SESJA WYGASŁA', text2: 'Zaloguj się ponownie.' });
          router.replace('/login');
        }
      } catch {
        Toast.show({ type: 'error', text1: 'BŁĄD SESJI', text2: 'Nie można odczytać danych sesji.' });
        router.replace('/login');
      }
    };
    checkSession();
  }, []);

  if (loading || !user) {
    return (
      <View style={styles.loadingContainer}>
        <MaterialCommunityIcons name="car-sports" size={42} color="#e33835" />
        <Text style={styles.loadingTitle}>VROOM</Text>
        <ActivityIndicator size="small" color="#e3383560" style={{ marginTop: 20 }} />
      </View>
    );
  }

  return (
    <>
      <StatusBar barStyle="light-content" backgroundColor="#0a0a0a" />
      <ScrollView style={styles.root} contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

        {/* ══════════════════════════
            HERO
        ══════════════════════════ */}
        <View style={styles.hero}>
          <LinearGradient
            colors={['#200808', '#140404', '#0a0a0a']}
            start={{ x: 0, y: 0 }} end={{ x: 1.3, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
          <View style={[styles.blob, { top: -70, right: -50, width: 220, height: 220, opacity: 0.15 }]} />
          <View style={[styles.blob, { bottom: -50, left: -30, width: 140, height: 140, opacity: 0.07 }]} />

          {/* TOP ROW */}
          <View style={styles.heroTop}>
            <View style={styles.onlinePill}>
              <View style={styles.onlineDot} />
              <Text style={styles.onlineTxt}>ONLINE</Text>
            </View>
            <TouchableOpacity onPress={() => router.push('/account')} style={styles.avatarBtn}>
              {user.avatar
                ? <Image source={{ uri: user.avatar }} style={styles.avatarImg} />
                : <MaterialIcons name="person-outline" size={22} color="#e33835" />
              }
            </TouchableOpacity>
          </View>

          {/* NAME */}
          <Text style={styles.heroGreet}>WITAMY Z POWROTEM</Text>
          <Text style={styles.heroName}>{user.username}</Text>

          {/* MAIN CAR PILL */}
          {user.mainCar && (
            <View style={styles.carPill}>
              <MaterialCommunityIcons name="car-sports" size={12} color="#e33835" />
              <Text style={styles.carPillTxt}>{user.mainCar.brand} · {user.mainCar.specs}</Text>
            </View>
          )} 

          <View style={styles.heroSep} />

          {/* 3 BIG STATS */}
          <View style={styles.heroStatsRow}>
            <HeroStat label="POZYCJA" value={`#${user.position ?? '—'}`} />
            <View style={styles.heroStatLine} />
            <HeroStat label="PUNKTY" value={String(user.points ?? 0)} />
            <View style={styles.heroStatLine} />
            <HeroStat label="STREAK" value={`${user.streak ?? 0}`} />
          </View>

          {/* LAST ACHIEVEMENT */}
          {user.latestAchievement && (
            <View style={styles.achievePill}>
              <MaterialIcons name="emoji-events" size={12} color="#f5c518" />
              <Text style={styles.achieveTxt}>
                Ostatnie: {user.latestAchievement.label}
              </Text>
            </View>
          )}
        </View>

        {/* ══════════════════════════
            QUICK NAV
        ══════════════════════════ */}
        <SectionLabel text="NAWIGACJA" />
        <View style={styles.navRow}>
          <NavBtn icon={<MaterialIcons name="map" size={24} color="#e33835" />}                          label="MAPA"      onPress={() => router.push('/map')} />
          <NavBtn icon={<MaterialCommunityIcons name="car-multiple" size={24} color="#e33835" />}        label="MEETY"     onPress={() => router.push('/Community/meets/events')} />
          <NavBtn icon={<MaterialIcons name="leaderboard" size={24} color="#e33835" />}                  label="RANKING"   onPress={() => router.push('/Community/Ranks/stats')} />
          <NavBtn icon={<MaterialIcons name="chat-bubble-outline" size={24} color="#e33835" />}          label="CZAT"      onPress={() => router.push('/(tabs)/community')} />
        </View>

        {/* ══════════════════════════
            TOP SPEED — HERO STAT
        ══════════════════════════ */}
        <SectionLabel text="STATYSTYKI" />
        <View style={styles.speedCard}>
          <LinearGradient
            colors={['#e3383528', '#e3383508', 'transparent']}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
          <View style={[styles.blob, { top: -30, right: 0, width: 110, height: 110, opacity: 0.18 }]} />
          <View style={styles.speedLeft}>
            <View style={styles.cardIconRow}>
              <View style={styles.iconWrap}>
                <MaterialCommunityIcons name="speedometer" size={16} color="#e33835" />
              </View>
              <Text style={styles.cardLbl}>TOP SPEED</Text>
              <View style={styles.badge}><Text style={styles.badgeTxt}>REKORD</Text></View>
            </View>
            <Text style={styles.speedVal}>{user.topSpeed ?? 0}</Text>
            <Text style={styles.speedUnit}>km/h</Text>
          </View>
          <View style={styles.speedRight}>
            <MiniStat label="ŚREDNIA" value={`${user.avgMaxSpeed} km/h`} />
            <MiniStat label="TRASY" value={String(user.totalRides ?? 0)} />
            <MiniStat label="MIESIĘCZNIE" value={String(user.monthlyRides ?? 0)} />
          </View>
        </View>

        {/* DISTANCE ROW */}
        <View style={styles.row2}>
          <DistCard
            icon={<MaterialCommunityIcons name="road-variant" size={17} color="#e33835" />}
            label="TEN TYDZIEŃ" value={`${user.weeklyDistance}`} unit="km"
          />
          <DistCard
            icon={<FontAwesome5 name="route" size={15} color="#e33835" />}
            label="TEN MIESIĄC" value={`${user.monthlyDistance}`} unit="km"
          />
        </View>
        <View style={styles.row2}>
          <DistCard
            icon={<MaterialIcons name="straighten" size={17} color="#e33835" />}
            label="ŁĄCZNIE" value={`${user.totalDistance}`} unit="km"
          />
          <DistCard
            icon={<MaterialIcons name="location-city" size={17} color="#e33835" />}
            label="MIASTA" value={String(user.cityCount ?? 0)} unit="odw."
          />
        </View>

        {/* GARAGE + SPOTS ROW */}
        <View style={styles.row2}>
          <TouchableOpacity style={styles.distCard} onPress={() => router.push('/account')} activeOpacity={0.8}>
            <View style={styles.cardIconRow}>
              <View style={styles.iconWrap}>
                <MaterialCommunityIcons name="garage" size={17} color="#e33835" />
              </View>
              <Text style={styles.cardLbl}>GARAŻ</Text>
            </View>
            <Text style={styles.distVal}>{user.carCount ?? 0}</Text>
            <Text style={styles.distUnit}>aut</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.distCard} onPress={() => router.push('/(tabs)/spotmap')} activeOpacity={0.8}>
            <View style={styles.cardIconRow}>
              <View style={styles.iconWrap}>
                <MaterialIcons name="place" size={17} color="#e33835" />
              </View>
              <Text style={styles.cardLbl}>SPOTY</Text>
            </View>
            <Text style={styles.distVal}>{user.spotCount ?? 0}</Text>
            <Text style={styles.distUnit}>dodane</Text>
          </TouchableOpacity>
        </View>

        {/* MEETS + ACHIEVEMENTS ROW */}
        <View style={[styles.row2, { marginBottom: 28 }]}>
          <TouchableOpacity style={styles.distCard} onPress={() => router.push('/Community/meets/events')} activeOpacity={0.8}>
            <View style={styles.cardIconRow}>
              <View style={styles.iconWrap}>
                <MaterialCommunityIcons name="flag-checkered" size={17} color="#e33835" />
              </View>
              <Text style={styles.cardLbl}>MEETY</Text>
            </View>
            <Text style={styles.distVal}>{user.meetCount ?? 0}</Text>
            <Text style={styles.distUnit}>łącznie</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.distCard} onPress={() => router.push('/account')} activeOpacity={0.8}>
            <View style={styles.cardIconRow}>
              <View style={styles.iconWrap}>
                <MaterialIcons name="emoji-events" size={17} color="#e33835" />
              </View>
              <Text style={styles.cardLbl}>OSIĄGNIĘCIA</Text>
            </View>
            <Text style={styles.distVal}>{user.achievementCount ?? 0}</Text>
            <Text style={styles.distUnit}>odblokowane</Text>
          </TouchableOpacity>
        </View>

        {/* ══════════════════════════
            CHAT / COMMUNITY BANNER
        ══════════════════════════ */}
        <SectionLabel text="SPOŁECZNOŚĆ" />
        <TouchableOpacity onPress={() => router.push('/(tabs)/community')} activeOpacity={0.82} style={styles.communityCard}>
          <LinearGradient
            colors={['#e3383522', '#e3383508', 'transparent']}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
          <View style={[styles.blob, { left: -20, top: -20, width: 80, height: 80, opacity: 0.2 }]} />
          <View style={styles.communityIconWrap}>
            <MaterialIcons name="chat-bubble-outline" size={26} color="#e33835" />
          </View>
          <View style={styles.communityText}>
            <Text style={styles.communityTitle}>Czat & Znajomi</Text>
            <Text style={styles.communitySub}>Napisz do kogoś · Sprawdź co słychać</Text>
          </View>
          <View style={styles.communityArrow}>
            <MaterialIcons name="arrow-forward-ios" size={14} color="#e33835" />
          </View>
        </TouchableOpacity>

        {/* SPOT MAP BANNER */}
        <TouchableOpacity onPress={() => router.push('/(tabs)/spotmap')} activeOpacity={0.82} style={styles.spotCard}>
          <LinearGradient
            colors={['#ffffff0a', '#ffffff03', 'transparent']}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
          <View style={styles.communityIconWrap}>
            <MaterialIcons name="place" size={26} color="#ffffff55" />
          </View>
          <View style={styles.communityText}>
            <Text style={[styles.communityTitle, { color: '#ffffffcc' }]}>Mapa Spotów</Text>
            <Text style={styles.communitySub}>Znajdź miejsca · Dodaj nowy spot</Text>
          </View>
          <View style={[styles.communityArrow, { backgroundColor: '#ffffff08', borderColor: '#ffffff15' }]}>
            <MaterialIcons name="arrow-forward-ios" size={14} color="#ffffff40" />
          </View>
        </TouchableOpacity>

        <View style={{ height: 50 }} />
      </ScrollView>
    </>
  );
}

// ─── SUB-COMPONENTS ──────────────────────────────────────

function SectionLabel({ text }: { text: string }) {
  return <Text style={styles.sectionLbl}>{text}</Text>;
}

function HeroStat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.heroStatItem}>
      <Text style={styles.heroStatVal}>{value}</Text>
      <Text style={styles.heroStatLbl}>{label}</Text>
    </View>
  );
}

function NavBtn({ icon, label, onPress }: { icon: React.ReactNode; label: string; onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.navBtn} onPress={onPress} activeOpacity={0.72}>
      <View style={styles.navIconWrap}>{icon}</View>
      <Text style={styles.navLbl}>{label}</Text>
    </TouchableOpacity>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.miniStat}>
      <Text style={styles.miniStatVal}>{value}</Text>
      <Text style={styles.miniStatLbl}>{label}</Text>
    </View>
  );
}

function DistCard({ icon, label, value, unit }: { icon: React.ReactNode; label: string; value: string; unit: string }) {
  return (
    <View style={styles.distCard}>
      <View style={styles.cardIconRow}>
        <View style={styles.iconWrap}>{icon}</View>
        <Text style={styles.cardLbl}>{label}</Text>
      </View>
      <Text style={styles.distVal}>{value}</Text>
      <Text style={styles.distUnit}>{unit}</Text>
    </View>
  );
}

// ─── STYLES ──────────────────────────────────────────────
const R        = '#e33835';
const R_BG     = '#e3383518';
const R_BORDER = '#e3383535';
const SURF     = '#111111';
const SURF2    = '#161616';
const W        = '#ffffff';
const W10      = '#ffffff10';
const W08      = '#ffffff08';
const W35      = '#ffffff35';
const W70      = '#ffffff70';

const styles = StyleSheet.create({
  // ── LOADING ──
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0a0a0a', gap: 8 },
  loadingTitle: { color: R, fontFamily: 'Orbitron', fontSize: 22, letterSpacing: 8, marginTop: 6 },

  // ── ROOT ──
  root: { flex: 1, backgroundColor: '#0a0a0a' },
  scroll: { paddingHorizontal: 20, paddingTop: 62 },
  blob: { position: 'absolute', borderRadius: 999, backgroundColor: R },

  // ── HERO ──
  hero: {
    borderRadius: 20, borderWidth: 1, borderColor: R_BORDER,
    padding: 22, marginBottom: 28, overflow: 'hidden', position: 'relative',
  },
  heroTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 },
  onlinePill: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: '#4de92612', borderWidth: 1, borderColor: '#4de92635',
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20,
  },
  onlineDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: '#4de926' },
  onlineTxt: { fontFamily: 'Orbitron', fontSize: 8, color: '#4de926', letterSpacing: 2 },
  avatarBtn: {
    width: 42, height: 42, borderRadius: 21, overflow: 'hidden',
    backgroundColor: R_BG, borderWidth: 1, borderColor: R_BORDER,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarImg: { width: 42, height: 42, borderRadius: 21 },
  heroGreet: { fontFamily: 'Orbitron', fontSize: 8, color: W35, letterSpacing: 3, marginBottom: 5 },
  heroName: { fontFamily: 'Orbitron', fontSize: 32, color: W, fontWeight: '700', letterSpacing: 0.5, marginBottom: 10 },
  carPill: {
    flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start',
    backgroundColor: R_BG, borderWidth: 1, borderColor: R_BORDER,
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20, marginBottom: 18,
  },
  carPillTxt: { fontFamily: 'Orbitron', fontSize: 9, color: W70 },
  heroSep: { height: 1, backgroundColor: W08, marginBottom: 18 },
  heroStatsRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  heroStatItem: { flex: 1, alignItems: 'center' },
  heroStatVal: { fontFamily: 'Orbitron', fontSize: 21, color: W, fontWeight: '700' },
  heroStatLbl: { fontFamily: 'Orbitron', fontSize: 7, color: W35, letterSpacing: 2, marginTop: 3 },
  heroStatLine: { width: 1, height: 32, backgroundColor: W08 },
  achievePill: {
    flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 16, alignSelf: 'flex-start',
    backgroundColor: '#f5c51815', borderWidth: 1, borderColor: '#f5c51830',
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20,
  },
  achieveTxt: { fontFamily: 'Orbitron', fontSize: 8, color: '#f5c518b0' },

  // ── SECTION LABEL ──
  sectionLbl: { fontFamily: 'Orbitron', fontSize: 8, color: W35, letterSpacing: 4, marginBottom: 12 },

  // ── QUICK NAV ──
  navRow: { flexDirection: 'row', gap: 8, marginBottom: 28 },
  navBtn: {
    flex: 1, backgroundColor: SURF2, borderRadius: 14, borderWidth: 1,
    borderColor: W08, paddingVertical: 16, alignItems: 'center', gap: 10,
  },
  navIconWrap: { backgroundColor: R_BG, padding: 9, borderRadius: 10 },
  navLbl: { fontFamily: 'Orbitron', fontSize: 6.5, color: W70, letterSpacing: 0.3 },

  // ── SPEED CARD ──
  speedCard: {
    backgroundColor: SURF, borderRadius: 18, borderWidth: 1, borderColor: R_BORDER,
    padding: 20, marginBottom: 10, overflow: 'hidden', position: 'relative',
    flexDirection: 'row', alignItems: 'center', gap: 16,
  },
  speedLeft: { flex: 1 },
  speedVal: { fontFamily: 'Orbitron', fontSize: 54, color: R, fontWeight: '700', letterSpacing: -2, marginTop: 4 },
  speedUnit: { fontFamily: 'Orbitron', fontSize: 9, color: W35, letterSpacing: 2 },
  speedRight: { gap: 12, alignItems: 'flex-end' },
  miniStat: { alignItems: 'flex-end', gap: 2 },
  miniStatVal: { fontFamily: 'Orbitron', fontSize: 14, color: W, fontWeight: '700' },
  miniStatLbl: { fontFamily: 'Orbitron', fontSize: 7, color: W35, letterSpacing: 1 },

  // ── DIST CARDS ──
  row2: { flexDirection: 'row', gap: 10, marginBottom: 10 },
  distCard: {
    flex: 1, backgroundColor: SURF, borderRadius: 16, borderWidth: 1,
    borderColor: W08, padding: 16, gap: 2,
  },
  cardIconRow: { flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 8 },
  iconWrap: { backgroundColor: R_BG, padding: 5, borderRadius: 7 },
  cardLbl: { fontFamily: 'Orbitron', fontSize: 7.5, color: W35, letterSpacing: 1, flexShrink: 1 },
  distVal: { fontFamily: 'Orbitron', fontSize: 26, color: W, fontWeight: '700', letterSpacing: -0.5 },
  distUnit: { fontFamily: 'Orbitron', fontSize: 8, color: W35, letterSpacing: 1 },
  badge: {
    marginLeft: 'auto', backgroundColor: R_BG, borderWidth: 1, borderColor: R_BORDER,
    borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2,
  },
  badgeTxt: { fontFamily: 'Orbitron', fontSize: 7, color: R, letterSpacing: 1 },

  // ── COMMUNITY / CHAT ──
  communityCard: {
    borderRadius: 16, borderWidth: 1, borderColor: R_BORDER, padding: 18,
    flexDirection: 'row', alignItems: 'center', gap: 14,
    overflow: 'hidden', position: 'relative', marginBottom: 10,
  },
  spotCard: {
    borderRadius: 16, borderWidth: 1, borderColor: '#ffffff12', padding: 18,
    flexDirection: 'row', alignItems: 'center', gap: 14,
    overflow: 'hidden', position: 'relative', marginBottom: 10,
  },
  communityIconWrap: {
    backgroundColor: R_BG, padding: 12, borderRadius: 12,
    borderWidth: 1, borderColor: R_BORDER,
  },
  communityText: { flex: 1, gap: 4 },
  communityTitle: { fontFamily: 'Orbitron', fontSize: 14, color: W, fontWeight: '700' },
  communitySub: { fontFamily: 'Orbitron', fontSize: 9, color: W35, letterSpacing: 0.3 },
  communityArrow: { backgroundColor: R_BG, padding: 8, borderRadius: 8, borderWidth: 1, borderColor: R_BORDER },
});