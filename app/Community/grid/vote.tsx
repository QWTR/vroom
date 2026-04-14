import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  View, Text, TouchableOpacity, Image, ActivityIndicator,
  Dimensions, StatusBar, Animated, Modal, FlatList, Platform,ScrollView
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Toast from 'react-native-toast-message';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '../../../contexts/ThemeContext';
import { API_URL } from '../../../constants/config';

const { width, height } = Dimensions.get('window');
const STATUS_H  = Platform.OS === 'ios' ? 54 : 32;
const DIVIDER_H = 60;
const BUTTONS_H = 120;
const CARD_H    = Math.floor((height - STATUS_H - DIVIDER_H - BUTTONS_H) / 2);

const getToken = async () =>
  (await AsyncStorage.getItem('userToken')) ?? (await AsyncStorage.getItem('token'));

interface Entry {
  id: number; photos: string[]; description: string | null;
  wins: number; userId: number;
  user: { id: number; username: string; avatarUrl: string | null };
  car:  { brand: string; specs: string } | null;
}
interface Battle {
  id: number; votesA: number; votesB: number; endsAt: string;
  entryA: Entry; entryB: Entry;
  votes: { entryId: number }[];
}

function timeLeft(endsAt: string): string {
  const diff = new Date(endsAt).getTime() - Date.now();
  if (diff <= 0) return 'KONIEC';
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  return h > 0 ? `${h}H ${m}M` : `${m}M`;
}

// ── Fullscreen galeria ───────────────────────────────────────────────────────
function GalleryModal({ photos, startIdx, username, onClose }: {
  photos: string[]; startIdx: number; username: string; onClose: () => void;
}) {
  const [current, setCurrent] = useState(startIdx);
  const flatRef  = useRef<FlatList>(null);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.96)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim,  { toValue: 1, duration: 280, useNativeDriver: true }),
      Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: true, tension: 100, friction: 10 }),
    ]).start();
    setTimeout(() => flatRef.current?.scrollToIndex({ index: startIdx, animated: false }), 80);
  }, []);

  const close = () => {
    Animated.parallel([
      Animated.timing(fadeAnim,  { toValue: 0, duration: 200, useNativeDriver: true }),
      Animated.timing(scaleAnim, { toValue: 0.96, duration: 200, useNativeDriver: true }),
    ]).start(onClose);
  };

  return (
    <Modal visible transparent animationType="none" statusBarTranslucent onRequestClose={close}>
      <Animated.View style={{ flex: 1, backgroundColor: '#000', opacity: fadeAnim }}>
        <StatusBar hidden />

        {/* Top bar */}
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 20, paddingTop: 56, paddingHorizontal: 20, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <View>
            <Text style={{ fontFamily: 'Orbitron', color: '#ffffff90', fontSize: 8, letterSpacing: 3 }}>GALERIA</Text>
            <Text style={{ fontFamily: 'Orbitron', color: '#fff', fontSize: 13, fontWeight: '900', marginTop: 2 }}>{username}</Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <View style={{ backgroundColor: '#ffffff12', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 5 }}>
              <Text style={{ fontFamily: 'Orbitron', color: '#fff', fontSize: 10, fontWeight: '700' }}>
                {current + 1} / {photos.length}
              </Text>
            </View>
            <TouchableOpacity onPress={close} style={{ backgroundColor: '#ffffff15', borderRadius: 22, padding: 10 }}>
              <MaterialIcons name="close" size={18} color="#fff" />
            </TouchableOpacity>
          </View>
        </View>

        {/* Zdjęcia */}
        <Animated.View style={{ flex: 1, transform: [{ scale: scaleAnim }] }}>
          <FlatList
            ref={flatRef}
            data={photos}
            horizontal pagingEnabled
            showsHorizontalScrollIndicator={false}
            keyExtractor={(_, i) => String(i)}
            getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
            onMomentumScrollEnd={e => setCurrent(Math.round(e.nativeEvent.contentOffset.x / width))}
            renderItem={({ item }) => (
              <View style={{ width, height, justifyContent: 'center', alignItems: 'center' }}>
                <Image source={{ uri: item }} style={{ width, height: height * 0.72 }} resizeMode="contain" />
              </View>
            )}
          />
        </Animated.View>

        {/* Dots */}
        {photos.length > 1 && (
          <View style={{ position: 'absolute', bottom: 52, left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', gap: 6 }}>
            {photos.map((_, i) => (
              <TouchableOpacity key={i} onPress={() => {
                flatRef.current?.scrollToIndex({ index: i, animated: true });
                setCurrent(i);
              }}>
                <View style={{ width: i === current ? 24 : 7, height: 7, borderRadius: 4, backgroundColor: i === current ? '#fff' : '#ffffff30' }} />
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* Strzałki boczne */}
        {current > 0 && (
          <TouchableOpacity
            style={{ position: 'absolute', left: 12, top: height / 2 - 24, backgroundColor: '#ffffff15', borderRadius: 26, padding: 12 }}
            onPress={() => { flatRef.current?.scrollToIndex({ index: current - 1, animated: true }); setCurrent(c => c - 1); }}
          >
            <MaterialIcons name="chevron-left" size={26} color="#fff" />
          </TouchableOpacity>
        )}
        {current < photos.length - 1 && (
          <TouchableOpacity
            style={{ position: 'absolute', right: 12, top: height / 2 - 24, backgroundColor: '#ffffff15', borderRadius: 26, padding: 12 }}
            onPress={() => { flatRef.current?.scrollToIndex({ index: current + 1, animated: true }); setCurrent(c => c + 1); }}
          >
            <MaterialIcons name="chevron-right" size={26} color="#fff" />
          </TouchableOpacity>
        )}
      </Animated.View>
    </Modal>
  );
}

// ── Karta zawodnika ──────────────────────────────────────────────────────────
function EntryCard({
  entry, photos, isVoted, isLoser, onGallery, label, goldColor,
}: {
  entry: Entry; photos: string[];
  isVoted: boolean; isLoser: boolean;
  onGallery: () => void; label: string; goldColor: string;
}) {
  const [photoIdx, setPhotoIdx] = useState(0);
  const scrollRef = useRef<ScrollView>(null);
  const dimAnim   = useRef(new Animated.Value(isLoser ? 1 : 0)).current;
  const badgeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.spring(dimAnim, {
      toValue: isLoser ? 1 : 0,
      useNativeDriver: false, tension: 80, friction: 10,
    }).start();
  }, [isLoser]);

  useEffect(() => {
    if (isVoted) {
      Animated.sequence([
        Animated.timing(badgeAnim, { toValue: 1.15, duration: 200, useNativeDriver: true }),
        Animated.spring(badgeAnim, { toValue: 1, useNativeDriver: true, tension: 200, friction: 6 }),
      ]).start();
    } else {
      Animated.timing(badgeAnim, { toValue: 0, duration: 150, useNativeDriver: true }).start();
    }
  }, [isVoted]);

  const overlayOpacity = dimAnim.interpolate({ inputRange: [0, 1], outputRange: [0, 0.72] });

  const displayPhotos = photos.length > 0 ? photos : ['ph'];

  return (
    <View style={{ height: CARD_H, overflow: 'hidden', backgroundColor: '#111' }}>

      {/* Zdjęcia — ScrollView pagingEnabled zamiast FlatList */}
      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        scrollEnabled={photos.length > 1}
        showsHorizontalScrollIndicator={false}
        bounces={false}
        decelerationRate="fast"
        disableIntervalMomentum
        style={{ position: 'absolute', top: 0, left: 0, width, height: CARD_H }}
        onMomentumScrollEnd={e => {
          const i = Math.round(e.nativeEvent.contentOffset.x / width);
          setPhotoIdx(i);
        }}
      >
        {displayPhotos.map((uri, i) => (
          <Image
            key={i}
            source={{ uri: uri === 'ph' ? 'https://via.placeholder.com/600x400/0a0a0a/222?text=+' : uri }}
            style={{ width, height: CARD_H }}
            resizeMode="cover"
          />
        ))}
      </ScrollView>

      {/* Gradient góra */}
      <LinearGradient
        colors={['rgba(0,0,0,0.55)', 'transparent']}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, height: CARD_H * 0.38, pointerEvents: 'none' }}
      />

      {/* Gradient dół */}
      <LinearGradient
        colors={['transparent', 'rgba(0,0,0,0.92)']}
        style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: CARD_H * 0.6, pointerEvents: 'none' }}
      />

      {/* Dim overlay */}
      <Animated.View style={{ position: 'absolute', inset: 0, backgroundColor: '#000', opacity: overlayOpacity, pointerEvents: 'none' }} />

      {/* Dots — tap żeby przejść do zdjęcia */}
      {photos.length > 1 && (
        <View style={{ position: 'absolute', top: 12, left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', gap: 5 }}>
          {photos.map((_, i) => (
            <TouchableOpacity
              key={i}
              hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
              onPress={() => {
                scrollRef.current?.scrollTo({ x: i * width, animated: true });
                setPhotoIdx(i);
              }}
            >
              <View style={{
                width: i === photoIdx ? 22 : 6, height: 4, borderRadius: 2,
                backgroundColor: i === photoIdx ? '#fff' : '#ffffff40',
              }} />
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Top-left: Label + galeria */}
      <View style={{ position: 'absolute', top: photos.length > 1 ? 30 : 12, left: 12, flexDirection: 'row', alignItems: 'center', gap: 7 }}>
        <View style={{ width: 26, height: 26, borderRadius: 6, backgroundColor: '#ffffff15', justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: '#ffffff25' }}>
          <Text style={{ fontFamily: 'Orbitron', color: '#fff', fontSize: 11, fontWeight: '900' }}>{label}</Text>
        </View>
        {photos.length > 0 && (
          <TouchableOpacity
            onPress={onGallery}
            style={{ backgroundColor: '#000000aa', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 4, flexDirection: 'row', alignItems: 'center', gap: 4 }}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <MaterialIcons name="photo-library" size={11} color="#ffffffcc" />
            <Text style={{ fontFamily: 'Orbitron', color: '#ffffffcc', fontSize: 8 }}>{photos.length}</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* TWÓJ GŁOS badge */}
      <Animated.View style={{
        position: 'absolute', top: photos.length > 1 ? 28 : 10, right: 12,
        transform: [{ scale: badgeAnim }], opacity: badgeAnim,
      }}>
        <LinearGradient
          colors={[goldColor, '#c8860a']}
          start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
          style={{ borderRadius: 20, paddingHorizontal: 11, paddingVertical: 5, flexDirection: 'row', alignItems: 'center', gap: 5 }}
        >
          <MaterialIcons name="how-to-vote" size={13} color="#000" />
          <Text style={{ fontFamily: 'Orbitron', color: '#000', fontSize: 8, fontWeight: '900', letterSpacing: 1 }}>TWÓJ GŁOS</Text>
        </LinearGradient>
      </Animated.View>

      {/* Dół: info */}
      <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, paddingHorizontal: 14, paddingBottom: 14, paddingTop: 8 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View style={{ width: 32, height: 32, borderRadius: 16, overflow: 'hidden', borderWidth: 1.5, borderColor: isVoted ? goldColor : '#ffffff30', backgroundColor: '#1a1a1a' }}>
            {entry.user.avatarUrl
              ? <Image source={{ uri: entry.user.avatarUrl }} style={{ width: 32, height: 32 }} />
              : <Text style={{ fontFamily: 'Orbitron', color: '#fff', fontSize: 9, textAlign: 'center', lineHeight: 32 }}>
                  {entry.user.username.slice(0, 2).toUpperCase()}
                </Text>
            }
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontFamily: 'Orbitron', color: '#fff', fontSize: 13, fontWeight: '900', letterSpacing: 0.5 }} numberOfLines={1}>
              {entry.user.username}
            </Text>
            {entry.car && (
              <Text style={{ fontFamily: 'Orbitron', color: '#ffffff55', fontSize: 8, marginTop: 1 }} numberOfLines={1}>
                {entry.car.brand}  ·  {entry.car.specs}
              </Text>
            )}
          </View>
          {entry.wins > 0 && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: '#ffffff10', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 }}>
              <MaterialCommunityIcons name="sword-cross" size={10} color={goldColor} />
              <Text style={{ fontFamily: 'Orbitron', color: goldColor, fontSize: 8, fontWeight: '900' }}>{entry.wins}W</Text>
            </View>
          )}
        </View>
        {entry.description ? (
          <Text style={{ fontFamily: 'Orbitron', color: '#ffffff45', fontSize: 8, marginTop: 5, letterSpacing: 0.5 }} numberOfLines={1}>
            "{entry.description}"
          </Text>
        ) : null}
      </View>
    </View>
  );
}

// ── Główny ekran ─────────────────────────────────────────────────────────────
export default function GridVoteScreen() {
  const { theme }   = useTheme();
  const router      = useRouter();
  const { eventId } = useLocalSearchParams<{ eventId: string }>();

  const [battles,  setBattles]  = useState<Battle[]>([]);
  const [idx,      setIdx]      = useState(0);
  const [loading,  setLoading]  = useState(true);
  const [voting,   setVoting]   = useState(false);
  const [votedMap, setVotedMap] = useState<Record<number, number>>({});
  const [gallery,  setGallery]  = useState<{ photos: string[]; username: string; startIdx: number } | null>(null);

  const slideAnim = useRef(new Animated.Value(0)).current;
  const scaleA    = useRef(new Animated.Value(1)).current;
  const scaleB    = useRef(new Animated.Value(1)).current;
  const barA      = useRef(new Animated.Value(0.5)).current;
  const barB      = useRef(new Animated.Value(0.5)).current;

  const load = useCallback(async () => {
    try {
      const token = await getToken();
      const res   = await fetch(`${API_URL}/api/grid/event/${eventId}/battles`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data: Battle[] = await res.json();
        setBattles(data);
        const vm: Record<number, number> = {};
        data.forEach(b => { if (b.votes?.[0]) vm[b.id] = b.votes[0].entryId; });
        setVotedMap(vm);
      }
    } catch {
      Toast.show({ type: 'error', text1: 'Błąd ładowania bitew' });
    } finally { setLoading(false); }
  }, [eventId]);

  useEffect(() => { load(); }, []);

  useEffect(() => {
    if (!battles[idx]) return;
    const b     = battles[idx];
    const total = b.votesA + b.votesB;
    const pA    = total > 0 ? b.votesA / total : 0.5;
    Animated.parallel([
      Animated.spring(barA, { toValue: pA,     useNativeDriver: false, tension: 50, friction: 10 }),
      Animated.spring(barB, { toValue: 1 - pA, useNativeDriver: false, tension: 50, friction: 10 }),
    ]).start();
  }, [battles, idx]);

  const animateSlide = (dir: 'left' | 'right', cb: () => void) => {
    const to = dir === 'left' ? -width : width;
    Animated.sequence([
      Animated.timing(slideAnim, { toValue: to,  duration: 240, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: -to, duration:   0, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0,   duration: 240, useNativeDriver: true }),
    ]).start(cb);
  };

  const goNext = useCallback(() => {
    if (idx < battles.length - 1) {
      animateSlide('left', () => setIdx(i => i + 1));
    } else {
      Toast.show({ type: 'success', text1: '🏁 Wszystkie głosy oddane!' });
      router.back();
    }
  }, [idx, battles.length]);

  const goPrev = () => {
    if (idx > 0) animateSlide('right', () => setIdx(i => i - 1));
  };

  const pulsBtn = (anim: Animated.Value) => {
    Animated.sequence([
      Animated.timing(anim, { toValue: 0.91, duration: 70,  useNativeDriver: true }),
      Animated.spring(anim, { toValue: 1,    useNativeDriver: true, tension: 260, friction: 5 }),
    ]).start();
  };

  const handleVote = useCallback(async (entryId: number, isA: boolean) => {
    if (voting) return;
    const battle   = battles[idx];
    const prevVote = votedMap[battle.id];
    if (prevVote === entryId) return;

    pulsBtn(isA ? scaleA : scaleB);
    setVoting(true);

    try {
      const token    = await getToken();
      const isChange = !!prevVote;
      const endpoint = isChange ? '/api/grid/vote/change' : '/api/grid/vote';

      const res  = await fetch(`${API_URL}${endpoint}`, {
        method:  'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body:    JSON.stringify({ battleId: battle.id, entryId }),
      });
      const data = await res.json();

      if (res.ok) {
        setVotedMap(m => ({ ...m, [battle.id]: entryId }));
        setBattles(prev => prev.map(b =>
          b.id === battle.id ? { ...b, votesA: data.votesA, votesB: data.votesB } : b
        ));
        if (isChange) {
          Toast.show({ type: 'info', text1: '🔄 Zmieniono głos!', visibilityTime: 800 });
        } else {
          Toast.show({ type: 'success', text1: '✅ Głos oddany!', visibilityTime: 800 });
          setTimeout(goNext, 650);
        }
      } else {
        Toast.show({ type: 'error', text1: data.error ?? 'Błąd' });
      }
    } catch {
      Toast.show({ type: 'error', text1: 'Brak połączenia' });
    } finally { setVoting(false); }
  }, [voting, battles, idx, votedMap, goNext]);

  // ── Loading ─────────────────────────────────────────────────────────���────
  if (loading) return (
    <View style={{ flex: 1, backgroundColor: '#000', justifyContent: 'center', alignItems: 'center' }}>
      <MaterialCommunityIcons name="sword-cross" size={48} color="#222" />
      <ActivityIndicator size="large" color={theme.gold} style={{ marginTop: 20 }} />
      <Text style={{ fontFamily: 'Orbitron', color: '#333', fontSize: 9, marginTop: 14, letterSpacing: 3 }}>
        ŁADOWANIE BITEW
      </Text>
    </View>
  );

  if (battles.length === 0) return (
    <View style={{ flex: 1, backgroundColor: '#000', justifyContent: 'center', alignItems: 'center', padding: 32 }}>
      <MaterialCommunityIcons name="sword-cross" size={72} color="#1a1a1a" />
      <Text style={{ fontFamily: 'Orbitron', color: '#2a2a2a', fontSize: 13, marginTop: 20, letterSpacing: 3 }}>BRAK AKTYWNYCH BITEW</Text>
      <TouchableOpacity
        style={{ marginTop: 32, backgroundColor: theme.gold, borderRadius: 14, paddingHorizontal: 28, paddingVertical: 12 }}
        onPress={() => router.back()}
      >
        <Text style={{ fontFamily: 'Orbitron', color: '#000', fontSize: 10, fontWeight: '900', letterSpacing: 2 }}>WRÓĆ</Text>
      </TouchableOpacity>
    </View>
  );

  const battle  = battles[idx];
  const myVote  = votedMap[battle.id] ?? null;
  const total   = battle.votesA + battle.votesB;
  const pctA    = total > 0 ? Math.round((battle.votesA / total) * 100) : 50;
  const pctB    = 100 - pctA;
  const photosA = battle.entryA.photos ?? [];
  const photosB = battle.entryB.photos ?? [];

  const barWidthA = barA.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] });
  const barWidthB = barB.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] });

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <StatusBar barStyle="light-content" backgroundColor="#000" />

      {gallery && (
        <GalleryModal
          photos={gallery.photos}
          startIdx={gallery.startIdx}
          username={gallery.username}
          onClose={() => setGallery(null)}
        />
      )}

      <Animated.View style={{ flex: 1, transform: [{ translateX: slideAnim }] }}>

        {/* ── ENTRY A ── */}
        <EntryCard
          entry={battle.entryA} photos={photosA}
          isVoted={myVote === battle.entryA.id}
          isLoser={!!myVote && myVote !== battle.entryA.id}
          onGallery={() => setGallery({ photos: photosA, username: battle.entryA.user.username, startIdx: 0 })}
          label="A" goldColor={theme.gold}
        />

        {/* ── DIVIDER ── */}
        <View style={{ height: DIVIDER_H, backgroundColor: '#050505' }}>

          {/* Pasek wyników */}
          <View style={{ flexDirection: 'row', height: 3 }}>
            <Animated.View style={{ width: barWidthA, backgroundColor: myVote === battle.entryA.id ? theme.gold : '#2a2a2a' }} />
            <Animated.View style={{ width: barWidthB, backgroundColor: myVote === battle.entryB.id ? theme.gold : '#1a1a1a' }} />
          </View>

          {/* Nav row */}
          <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18 }}>
            <TouchableOpacity
              onPress={goPrev} disabled={idx === 0}
              style={{ opacity: idx === 0 ? 0.2 : 1, padding: 6 }}
            >
              <MaterialIcons name="chevron-left" size={24} color="#555" />
            </TouchableOpacity>

            {/* Centro */}
            <View style={{ alignItems: 'center', gap: 3 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                {/* Pct A */}
                <Text style={{ fontFamily: 'Orbitron', color: myVote === battle.entryA.id ? theme.gold : '#444', fontSize: 13, fontWeight: '900' }}>
                  {myVote ? `${pctA}%` : '?'}
                </Text>

                {/* VS badge */}
                <LinearGradient
                  colors={[theme.gold, '#c8860a']}
                  start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                  style={{ borderRadius: 24, paddingHorizontal: 16, paddingVertical: 6, flexDirection: 'row', alignItems: 'center', gap: 6 }}
                >
                  <MaterialCommunityIcons name="sword-cross" size={12} color="#000" />
                  <Text style={{ fontFamily: 'Orbitron', color: '#000', fontSize: 14, fontWeight: '900', letterSpacing: 4 }}>VS</Text>
                  <MaterialCommunityIcons name="sword-cross" size={12} color="#000" />
                </LinearGradient>

                {/* Pct B */}
                <Text style={{ fontFamily: 'Orbitron', color: myVote === battle.entryB.id ? theme.gold : '#444', fontSize: 13, fontWeight: '900' }}>
                  {myVote ? `${pctB}%` : '?'}
                </Text>
              </View>

              <Text style={{ fontFamily: 'Orbitron', color: '#333', fontSize: 8, letterSpacing: 1 }}>
                {idx + 1}/{battles.length}  ·  ⏱ {timeLeft(battle.endsAt)}
              </Text>
            </View>

            <TouchableOpacity
              onPress={goNext} disabled={idx === battles.length - 1}
              style={{ opacity: idx === battles.length - 1 ? 0.2 : 1, padding: 6 }}
            >
              <MaterialIcons name="chevron-right" size={24} color="#555" />
            </TouchableOpacity>
          </View>
        </View>

        {/* ── ENTRY B ── */}
        <EntryCard
          entry={battle.entryB} photos={photosB}
          isVoted={myVote === battle.entryB.id}
          isLoser={!!myVote && myVote !== battle.entryB.id}
          onGallery={() => setGallery({ photos: photosB, username: battle.entryB.user.username, startIdx: 0 })}
          label="B" goldColor={theme.gold}
        />

        {/* ── PRZYCISKI ── */}
        <View style={{ height: BUTTONS_H, backgroundColor: '#050505', paddingHorizontal: 14, paddingTop: 10, paddingBottom: 14, gap: 0 }}>

          {/* Głosy info */}
          {myVote && (
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 4, marginBottom: 8 }}>
              <Text style={{ fontFamily: 'Orbitron', color: '#333', fontSize: 8 }}>
                {battle.votesA} głosów
              </Text>
              <Text style={{ fontFamily: 'Orbitron', color: '#222', fontSize: 8, letterSpacing: 2 }}>
                WYNIKI
              </Text>
              <Text style={{ fontFamily: 'Orbitron', color: '#333', fontSize: 8 }}>
                {battle.votesB} głosów
              </Text>
            </View>
          )}

          {/* Przyciski */}
          <View style={{ flexDirection: 'row', gap: 10, flex: 1 }}>

            {/* Btn A */}
            <Animated.View style={{ flex: 1, transform: [{ scale: scaleA }] }}>
              <TouchableOpacity
                onPress={() => handleVote(battle.entryA.id, true)}
                disabled={voting}
                activeOpacity={0.8}
                style={{ flex: 1, borderRadius: 16, overflow: 'hidden', opacity: voting ? 0.5 : 1 }}
              >
                {myVote === battle.entryA.id
                  ? <LinearGradient colors={[theme.gold, '#c8860a']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 12 }}>
                      {voting
                        ? <ActivityIndicator size="small" color="#000" />
                        : <>
                            <MaterialIcons name="how-to-vote" size={18} color="#000" />
                            <View style={{ flexShrink: 1 }}>
                              <Text style={{ fontFamily: 'Orbitron', color: '#000', fontSize: 10, fontWeight: '900' }} numberOfLines={1}>
                                {battle.entryA.user.username}
                              </Text>
                              <Text style={{ fontFamily: 'Orbitron', color: '#00000070', fontSize: 7 }}>TWÓJ GŁOS</Text>
                            </View>
                          </>
                      }
                    </LinearGradient>
                  : <View style={{ flex: 1, backgroundColor: '#111', borderRadius: 16, borderWidth: 1, borderColor: '#1e1e1e', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 12 }}>
                      {voting
                        ? <ActivityIndicator size="small" color={theme.gold} />
                        : <>
                            <MaterialIcons name="thumb-up" size={16} color="#333" />
                            <View style={{ flexShrink: 1 }}>
                              <Text style={{ fontFamily: 'Orbitron', color: '#ccc', fontSize: 10, fontWeight: '900' }} numberOfLines={1}>
                                {battle.entryA.user.username}
                              </Text>
                              <Text style={{ fontFamily: 'Orbitron', color: '#333', fontSize: 7 }}>
                                {myVote ? 'ZMIEŃ GŁOS' : 'ZAGŁOSUJ'}
                              </Text>
                            </View>
                          </>
                      }
                    </View>
                }
              </TouchableOpacity>
            </Animated.View>

            {/* Divider pionowy */}
            <View style={{ width: 1, backgroundColor: '#1a1a1a', borderRadius: 1 }} />

            {/* Btn B */}
            <Animated.View style={{ flex: 1, transform: [{ scale: scaleB }] }}>
              <TouchableOpacity
                onPress={() => handleVote(battle.entryB.id, false)}
                disabled={voting}
                activeOpacity={0.8}
                style={{ flex: 1, borderRadius: 16, overflow: 'hidden', opacity: voting ? 0.5 : 1 }}
              >
                {myVote === battle.entryB.id
                  ? <LinearGradient colors={[theme.gold, '#c8860a']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 12 }}>
                      {voting
                        ? <ActivityIndicator size="small" color="#000" />
                        : <>
                            <MaterialIcons name="how-to-vote" size={18} color="#000" />
                            <View style={{ flexShrink: 1 }}>
                              <Text style={{ fontFamily: 'Orbitron', color: '#000', fontSize: 10, fontWeight: '900' }} numberOfLines={1}>
                                {battle.entryB.user.username}
                              </Text>
                              <Text style={{ fontFamily: 'Orbitron', color: '#00000070', fontSize: 7 }}>TWÓJ GŁOS</Text>
                            </View>
                          </>
                      }
                    </LinearGradient>
                  : <View style={{ flex: 1, backgroundColor: '#111', borderRadius: 16, borderWidth: 1, borderColor: '#1e1e1e', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 12 }}>
                      {voting
                        ? <ActivityIndicator size="small" color={theme.gold} />
                        : <>
                            <MaterialIcons name="thumb-up" size={16} color="#333" />
                            <View style={{ flexShrink: 1 }}>
                              <Text style={{ fontFamily: 'Orbitron', color: '#ccc', fontSize: 10, fontWeight: '900' }} numberOfLines={1}>
                                {battle.entryB.user.username}
                              </Text>
                              <Text style={{ fontFamily: 'Orbitron', color: '#333', fontSize: 7 }}>
                                {myVote ? 'ZMIEŃ GŁOS' : 'ZAGŁOSUJ'}
                              </Text>
                            </View>
                          </>
                      }
                    </View>
                }
              </TouchableOpacity>
            </Animated.View>
          </View>
        </View>

      </Animated.View>

      {/* ── HEADER OVERLAY ── */}
      <View style={{ position: 'absolute', top: 0, left: 0, right: 0, paddingTop: STATUS_H, paddingHorizontal: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', pointerEvents: 'box-none' }}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={{ backgroundColor: '#00000090', borderRadius: 22, padding: 9 }}
        >
          <MaterialIcons name="close" size={18} color="#fff" />
        </TouchableOpacity>

        <View style={{ backgroundColor: '#00000090', borderRadius: 22, paddingHorizontal: 14, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', gap: 7 }}>
          {voting
            ? <ActivityIndicator size="small" color={theme.gold} />
            : <MaterialCommunityIcons name="flag-checkered" size={12} color={theme.gold} />
          }
          <Text style={{ fontFamily: 'Orbitron', color: '#fff', fontSize: 9, fontWeight: '700' }}>
            {Object.keys(votedMap).length}/{battles.length}
          </Text>
        </View>
      </View>

    </View>
  );
}