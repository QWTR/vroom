import React, { useEffect, useState } from 'react';
import {
  View, ScrollView, StyleSheet, TouchableOpacity,
  Image, ActivityIndicator, Text,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import AsyncStorage  from '@react-native-async-storage/async-storage';
import Toast         from 'react-native-toast-message';
import { API_URL }   from '../../constants/config';
import AchievementBox from '../../components/profile/AchievementBox';
import type { Achievement } from '../../hooks/useAchievements';

const getToken = async () =>
  (await AsyncStorage.getItem('userToken')) ?? (await AsyncStorage.getItem('token'));

interface PublicProfile {
  id:            number;
  username:      string;
  location:      string | null;
  bio:           string | null;
  avatarUrl:     string | null;
  createdAt:     string;
  totalDistance: number;
  points:        number;
  meetCount:     number;
  cityCount:     number;
  position:      number | null;
}

interface PublicCar {
  id:     number;
  brand:  string;
  specs:  string;
  isMain: boolean;
  photos: string[];
}

interface PublicSpot {
  id:            number;
  name:          string;
  category:      string;
  photos:        string[];
  likesCount:    number;
  commentsCount: number;
}

export default function PublicProfileScreen() {
  const router = useRouter();
  const { userId } = useLocalSearchParams<{ userId: string }>();

  const [profile,      setProfile]      = useState<PublicProfile | null>(null);
  const [cars,         setCars]         = useState<PublicCar[]>([]);
  const [spots,        setSpots]        = useState<PublicSpot[]>([]);
  const [achievements, setAchievements] = useState<Achievement[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [myUserId,     setMyUserId]     = useState<number | null>(null);
  const [showAllAchs, setShowAllAchs] = useState(false);

  useEffect(() => {
    const init = async () => {
      const raw = await AsyncStorage.getItem('user');
      if (raw) {
        const u = JSON.parse(raw);
        setMyUserId(u.userId ?? u.id);
      }
      await loadAll();
    };
    init();
  }, [userId]);

  const loadAll = async () => {
    setLoading(true);
    try {
      const token   = await getToken();
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const [profileRes, carsRes, spotsRes, achRes] = await Promise.all([
        fetch(`${API_URL}/api/profile/${userId}`,              { headers }),
        fetch(`${API_URL}/api/profile/${userId}/cars`,         { headers }),
        fetch(`${API_URL}/api/profile/${userId}/spots`,        { headers }),
        fetch(`${API_URL}/api/profile/${userId}/achievements`, { headers }),
      ]);

      if (profileRes.ok) setProfile(await profileRes.json());
      if (carsRes.ok)    setCars(await carsRes.json());
      if (spotsRes.ok)   setSpots(await spotsRes.json());

      if (achRes.ok) {
        const data = await achRes.json();
        setAchievements(
          data.map((a: any) => ({
            ...a,
            active:       true,
            unlocked:     true,
            progress:     100,
            currentValue: a.conditionValue ?? 0,
          }))
        );
      }
    } catch {
      Toast.show({ type: 'error', text1: 'BŁĄD', text2: 'Nie można załadować profilu.' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (myUserId && profile && myUserId === profile.id) {
      router.replace('/(tabs)/account');
    }
  }, [myUserId, profile]);

  if (loading) {
    return (
      <View style={s.center}>
        <ActivityIndicator size="large" color="#e33835" />
      </View>
    );
  }

  if (!profile) {
    return (
      <View style={s.center}>
        <MaterialIcons name="person-off" size={48} color="#ffffff20" />
        <Text style={s.errorText}>Nie znaleziono profilu</Text>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtnCenter}>
          <Text style={s.backBtnCenterText}>← Wróć</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const initials    = profile.username.slice(0, 2).toUpperCase();
  const joinedLabel = new Date(profile.createdAt).toLocaleDateString('pl-PL', {
    month: 'long', year: 'numeric',
  });

  return (
    <ScrollView style={s.container} contentContainerStyle={{ paddingBottom: 80 }}>

      {/* NAGŁÓWEK */}
      <View style={s.headerRow}>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={s.backBtn}>{'← Wróć'}</Text>
        </TouchableOpacity>
        <Text style={s.headerTitle}>PROFIL</Text>
        <View style={{ width: 60 }} />
      </View>

      {/* KARTA PROFILU */}
      <View style={s.profileCard}>
        <View style={s.profileTop}>
          <View style={s.avatarCircle}>
            {profile.avatarUrl ? (
              <Image source={{ uri: profile.avatarUrl }} style={s.avatarImage} />
            ) : (
              <Text style={s.avatarText}>{initials}</Text>
            )}
          </View>
          <View style={s.profileInfo}>
            <Text style={s.username}>{profile.username}</Text>
            {!!profile.location && (
              <View style={s.infoRow}>
                <MaterialIcons name="location-on" size={12} color="#e33835" />
                <Text style={s.infoText}>{profile.location}</Text>
              </View>
            )}
            <View style={s.infoRow}>
              <MaterialIcons name="calendar-today" size={12} color="#ffffff40" />
              <Text style={s.infoText}>{`Dołączył: ${joinedLabel}`}</Text>
            </View>
            {!!profile.position && (
              <View style={s.infoRow}>
                <MaterialIcons name="emoji-events" size={12} color="#e33835" />
                <Text style={s.infoText}>{`Ranking #${profile.position}`}</Text>
              </View>
            )}
          </View>
        </View>
        {!!profile.bio && <Text style={s.bio}>{profile.bio}</Text>}
      </View>

      {/* STATYSTYKI */}
      <View style={s.statsGrid}>
        <View style={s.statBox}>
          <MaterialIcons name="speed" size={20} color="#e33835" />
          <Text style={s.statValue}>{profile.totalDistance.toLocaleString('pl-PL')}</Text>
          <Text style={s.statLabel}>KM</Text>
        </View>
        <View style={s.statBox}>
          <MaterialIcons name="calendar-today" size={20} color="#e33835" />
          <Text style={s.statValue}>{profile.meetCount}</Text>
          <Text style={s.statLabel}>ZLOTY</Text>
        </View>
        <View style={s.statBox}>
          <MaterialIcons name="star" size={20} color="#e33835" />
          <Text style={s.statValue}>{profile.points}</Text>
          <Text style={s.statLabel}>PUNKTY</Text>
        </View>
        <View style={s.statBox}>
          <MaterialIcons name="location-on" size={20} color="#e33835" />
          <Text style={s.statValue}>{profile.cityCount}</Text>
          <Text style={s.statLabel}>MIASTA</Text>
        </View>
      </View>

      {/* AUTA */}
      <Text style={s.sectionTitle}>AUTA</Text>
      {cars.length === 0 ? (
        <Text style={s.emptyText}>Brak dodanych aut</Text>
      ) : (
        cars.map(car => (
          <TouchableOpacity
            key={car.id}
            style={s.carCard}
            onPress={() => router.push({ pathname: '/profile/car-detail', params: { id: String(car.id) } })}
            activeOpacity={0.8}
          >
            {car.photos[0] ? (
              <Image source={{ uri: car.photos[0] }} style={s.carPhoto} />
            ) : (
              <View style={[s.carPhoto, s.carPhotoPlaceholder]}>
                <MaterialIcons name="directions-car" size={24} color="#e33835" />
              </View>
            )}
            <View style={s.carInfo}>
              <View style={s.carTopRow}>
                <Text style={s.carBrand}>{car.brand}</Text>
                {car.isMain && (
                  <View style={s.mainBadge}>
                    <Text style={s.mainBadgeText}>GŁÓWNE</Text>
                  </View>
                )}
              </View>
              <Text style={s.carSpecs}>{car.specs}</Text>
            </View>
            <MaterialIcons name="arrow-forward-ios" size={14} color="#ffffff20" />
          </TouchableOpacity>
        ))
      )}

      {/* OSIĄGNIĘCIA */}
      <Text style={[s.sectionTitle, { marginTop: 24 }]}>
        {`OSIĄGNIĘCIA (${achievements.length})`}
      </Text>
      {achievements.length === 0 ? (
        <Text style={s.emptyText}>Brak odblokowanych osiągnięć</Text>
      ) : (
        <View style={s.achievementsGrid}>
          {achievements.map(a => (
            <AchievementBox
              key={a.key}
              icon={a.icon}
              label={a.label}
              active={a.active}
              rarity={a.rarity}
              progress={a.progress}
              points={a.points}
              description={a.description}
              category={a.category}
              currentValue={a.currentValue}
              conditionValue={a.conditionValue}
              conditionField={a.conditionField}
              unlockedAt={a.unlockedAt}
            />
          ))}
        </View>
      )}

      {/* SPOTY */}
      <Text style={[s.sectionTitle, { marginTop: 24 }]}>{`SPOTY (${spots.length})`}</Text>
      {spots.length === 0 ? (
        <Text style={s.emptyText}>Brak dodanych spotów</Text>
      ) : (
        <View style={s.spotsGrid}>
          {spots.map(spot => (
            <View key={spot.id} style={s.spotCard}>
              {spot.photos[0] ? (
                <Image source={{ uri: spot.photos[0] }} style={s.spotPhoto} resizeMode="cover" />
              ) : (
                <View style={[s.spotPhoto, s.spotPhotoPlaceholder]}>
                  <MaterialIcons name="place" size={24} color="#e33835" />
                </View>
              )}
              <View style={s.spotInfo}>
                <Text style={s.spotName} numberOfLines={1}>{spot.name}</Text>
                <Text style={s.spotCategory}>{spot.category}</Text>
                <View style={s.spotStats}>
                  <MaterialIcons name="favorite" size={11} color="#e33835" />
                  <Text style={s.spotStatText}>{spot.likesCount}</Text>
                  <MaterialIcons name="chat-bubble" size={11} color="#ffffff40" style={{ marginLeft: 6 }} />
                  <Text style={s.spotStatText}>{spot.commentsCount}</Text>
                </View>
              </View>
            </View>
          ))}
        </View>
      )}

    </ScrollView>
  );
}

const s = StyleSheet.create({
  container:            { flex: 1, backgroundColor: '#0f0f0f', paddingHorizontal: '5%' },
  center:               { flex: 1, backgroundColor: '#0f0f0f', justifyContent: 'center', alignItems: 'center', gap: 12 },
  errorText:            { fontFamily: 'Orbitron', color: '#ffffff40', fontSize: 13 },
  backBtnCenter:        { marginTop: 8 },
  backBtnCenterText:    { fontFamily: 'Orbitron', color: '#e33835', fontSize: 12 },
  headerRow:            { marginTop: 60, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  headerTitle:          { fontFamily: 'Orbitron', fontSize: 20, color: '#fff', letterSpacing: 2 },
  backBtn:              { fontFamily: 'Orbitron', color: '#e33835', fontSize: 12 },
  profileCard:          { backgroundColor: '#1a1a1a', borderRadius: 16, padding: 20, marginBottom: 16, borderWidth: 1, borderColor: '#ffffff10' },
  profileTop:           { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 12 },
  avatarCircle:         { width: 72, height: 72, borderRadius: 36, backgroundColor: '#252525', borderWidth: 2, borderColor: '#e33835', justifyContent: 'center', alignItems: 'center', overflow: 'hidden', marginRight: 16 },
  avatarImage:          { width: 72, height: 72 },
  avatarText:           { fontFamily: 'Orbitron', fontSize: 22, color: '#e33835' },
  profileInfo:          { flex: 1, gap: 4 },
  username:             { fontFamily: 'Orbitron', fontSize: 18, color: '#fff', marginBottom: 4 },
  infoRow:              { flexDirection: 'row', alignItems: 'center', gap: 4 },
  infoText:             { fontFamily: 'Orbitron', color: '#ffffff60', fontSize: 10 },
  bio:                  { fontFamily: 'Orbitron', color: '#ffffff80', fontSize: 11, lineHeight: 18, borderTopWidth: 1, borderTopColor: '#ffffff10', paddingTop: 12, marginTop: 4 },
  statsGrid:            { flexDirection: 'row', justifyContent: 'space-between', gap: 8, marginBottom: 24 },
  statBox:              { flex: 1, backgroundColor: '#1a1a1a', borderRadius: 12, padding: 12, alignItems: 'center', gap: 4, borderWidth: 1, borderColor: '#ffffff08' },
  statValue:            { fontFamily: 'Orbitron', color: '#fff', fontSize: 15, fontWeight: '700' },
  statLabel:            { fontFamily: 'Orbitron', color: '#ffffff40', fontSize: 8 },
  sectionTitle:         { fontFamily: 'Orbitron', color: '#fff', fontSize: 14, letterSpacing: 1, marginBottom: 12 },
  emptyText:            { fontFamily: 'Orbitron', color: '#ffffff30', fontSize: 11, textAlign: 'center', marginVertical: 12 },
  carCard:              { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1a1a1a', borderRadius: 12, padding: 12, marginBottom: 10, borderWidth: 1, borderColor: '#ffffff08', gap: 12 },
  carPhoto:             { width: 70, height: 70, borderRadius: 10 },
  carPhotoPlaceholder:  { backgroundColor: '#252525', justifyContent: 'center', alignItems: 'center' },
  carInfo:              { flex: 1 },
  carTopRow:            { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  carBrand:             { fontFamily: 'Orbitron', color: '#fff', fontSize: 13 },
  carSpecs:             { fontFamily: 'Orbitron', color: '#e33835', fontSize: 11 },
  mainBadge:            { backgroundColor: '#e3383520', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, borderWidth: 1, borderColor: '#e33835' },
  mainBadgeText:        { fontFamily: 'Orbitron', color: '#e33835', fontSize: 8 },
  achievementsGrid:     { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  spotsGrid:            { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  spotCard:             { width: '48%', backgroundColor: '#1a1a1a', borderRadius: 12, overflow: 'hidden', borderWidth: 1, borderColor: '#ffffff05' },
  spotPhoto:            { width: '100%', height: 100 },
  spotPhotoPlaceholder: { backgroundColor: '#252525', justifyContent: 'center', alignItems: 'center' },
  spotInfo:             { padding: 10 },
  spotName:             { fontFamily: 'Orbitron', color: '#fff', fontSize: 11, marginBottom: 2 },
  spotCategory:         { fontFamily: 'Orbitron', color: '#e33835', fontSize: 9, marginBottom: 6 },
  spotStats:            { flexDirection: 'row', alignItems: 'center' },
  spotStatText:         { fontFamily: 'Orbitron', color: '#ffffff40', fontSize: 9, marginLeft: 3 },
});