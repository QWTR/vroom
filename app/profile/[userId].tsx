import React, { useEffect, useState } from 'react';
import {
  View, ScrollView, TouchableOpacity,
  Image, ActivityIndicator, Text,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import AsyncStorage  from '@react-native-async-storage/async-storage';
import Toast         from 'react-native-toast-message';
import { API_URL }   from '../../constants/config';
import { useTheme }  from '../../contexts/ThemeContext';
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
  id: number; brand: string; specs: string; isMain: boolean; photos: string[];
}
interface PublicSpot {
  id: number; name: string; category: string; photos: string[];
  likesCount: number; commentsCount: number;
}

export default function PublicProfileScreen() {
  const router = useRouter();
  const { theme } = useTheme();
  const { userId } = useLocalSearchParams<{ userId: string }>();

  const [profile,      setProfile]      = useState<PublicProfile | null>(null);
  const [cars,         setCars]         = useState<PublicCar[]>([]);
  const [spots,        setSpots]        = useState<PublicSpot[]>([]);
  const [achievements, setAchievements] = useState<Achievement[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [myUserId,     setMyUserId]     = useState<number | null>(null);

  useEffect(() => {
    (async () => {
      const raw = await AsyncStorage.getItem('user');
      if (raw) { const u = JSON.parse(raw); setMyUserId(u.userId ?? u.id); }
      await loadAll();
    })();
  }, [userId]);

  const loadAll = async () => {
    setLoading(true);
    try {
      const token = await getToken();
      const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
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
        setAchievements(data.map((a: any) => ({ ...a, active: true, unlocked: true, progress: 100, currentValue: a.conditionValue ?? 0 })));
      }
    } catch {
      Toast.show({ type: 'error', text1: 'BŁĄD', text2: 'Nie można załadować profilu.' });
    } finally { setLoading(false); }
  };

  useEffect(() => {
    if (myUserId && profile && myUserId === profile.id) router.replace('/(tabs)/account');
  }, [myUserId, profile]);

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color={theme.primary} />
      </View>
    );
  }

  if (!profile) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg, justifyContent: 'center', alignItems: 'center', gap: 12 }}>
        <MaterialIcons name="person-off" size={48} color={theme.border3} />
        <Text style={{ fontFamily: 'Orbitron', color: theme.textDim, fontSize: 13 }}>Nie znaleziono profilu</Text>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={{ fontFamily: 'Orbitron', color: theme.primary, fontSize: 12 }}>← Wróć</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const initials    = profile.username.slice(0, 2).toUpperCase();
  const joinedLabel = new Date(profile.createdAt).toLocaleDateString('pl-PL', { month: 'long', year: 'numeric' });

  return (
    <ScrollView style={{ flex: 1, backgroundColor: theme.bgAlt, paddingHorizontal: '5%' }} contentContainerStyle={{ paddingBottom: 80 }}>

      {/* NAGŁÓWEK */}
      <View style={{ marginTop: 60, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={{ fontFamily: 'Orbitron', color: theme.primary, fontSize: 12 }}>{'← Wróć'}</Text>
        </TouchableOpacity>
        <Text style={{ fontFamily: 'Orbitron', fontSize: 20, color: theme.text, letterSpacing: 2 }}>PROFIL</Text>
        <View style={{ width: 60 }} />
      </View>

      {/* KARTA PROFILU */}
      <View style={{ backgroundColor: theme.surface3, borderRadius: 16, padding: 20, marginBottom: 16, borderWidth: 1, borderColor: theme.border }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', marginBottom: 12 }}>
          <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: theme.surface4, borderWidth: 2, borderColor: theme.primary, justifyContent: 'center', alignItems: 'center', overflow: 'hidden', marginRight: 16 }}>
            {profile.avatarUrl
              ? <Image source={{ uri: profile.avatarUrl }} style={{ width: 72, height: 72 }} />
              : <Text style={{ fontFamily: 'Orbitron', fontSize: 22, color: theme.primary }}>{initials}</Text>
            }
          </View>
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={{ fontFamily: 'Orbitron', fontSize: 18, color: theme.text, marginBottom: 4 }}>{profile.username}</Text>
            {!!profile.location && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <MaterialIcons name="location-on" size={12} color={theme.primary} />
                <Text style={{ fontFamily: 'Orbitron', color: theme.textDim, fontSize: 10 }}>{profile.location}</Text>
              </View>
            )}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <MaterialIcons name="calendar-today" size={12} color={theme.textDim} />
              <Text style={{ fontFamily: 'Orbitron', color: theme.textDim, fontSize: 10 }}>Dołączył: {joinedLabel}</Text>
            </View>
            {!!profile.position && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <MaterialIcons name="emoji-events" size={12} color={theme.primary} />
                <Text style={{ fontFamily: 'Orbitron', color: theme.textDim, fontSize: 10 }}>Ranking #{profile.position}</Text>
              </View>
            )}
          </View>
        </View>
        {!!profile.bio && (
          <Text style={{ fontFamily: 'Orbitron', color: theme.textMuted, fontSize: 11, lineHeight: 18, borderTopWidth: 1, borderTopColor: theme.border, paddingTop: 12, marginTop: 4 }}>
            {profile.bio}
          </Text>
        )}
      </View>

      {/* STATYSTYKI */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8, marginBottom: 24 }}>
        {[
          { icon: 'speed',          value: profile.totalDistance.toLocaleString('pl-PL'), label: 'KM'     },
          { icon: 'calendar-today', value: String(profile.meetCount),                     label: 'ZLOTY'  },
          { icon: 'star',           value: String(profile.points),                        label: 'PUNKTY' },
          { icon: 'location-on',    value: String(profile.cityCount),                     label: 'MIASTA' },
        ].map(s => (
          <View key={s.label} style={{ flex: 1, backgroundColor: theme.surface3, borderRadius: 12, padding: 12, alignItems: 'center', gap: 4, borderWidth: 1, borderColor: theme.border }}>
            <MaterialIcons name={s.icon as any} size={20} color={theme.primary} />
            <Text style={{ fontFamily: 'Orbitron', color: theme.text, fontSize: 15, fontWeight: '700' }}>{s.value}</Text>
            <Text style={{ fontFamily: 'Orbitron', color: theme.textDim, fontSize: 8 }}>{s.label}</Text>
          </View>
        ))}
      </View>

      {/* AUTA */}
      <Text style={{ fontFamily: 'Orbitron', color: theme.text, fontSize: 14, letterSpacing: 1, marginBottom: 12 }}>AUTA</Text>
      {cars.length === 0
        ? <Text style={{ fontFamily: 'Orbitron', color: theme.textFaint, fontSize: 11, textAlign: 'center', marginVertical: 12 }}>Brak dodanych aut</Text>
        : cars.map(car => (
            <TouchableOpacity
              key={car.id}
              style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: theme.surface3, borderRadius: 12, padding: 12, marginBottom: 10, borderWidth: 1, borderColor: theme.border, gap: 12 }}
              onPress={() => router.push({ pathname: '/profile/car-detail', params: { id: String(car.id) } })}
              activeOpacity={0.8}
            >
              {car.photos[0]
                ? <Image source={{ uri: car.photos[0] }} style={{ width: 70, height: 70, borderRadius: 10 }} />
                : <View style={{ width: 70, height: 70, borderRadius: 10, backgroundColor: theme.surface4, justifyContent: 'center', alignItems: 'center' }}>
                    <MaterialIcons name="directions-car" size={24} color={theme.primary} />
                  </View>
              }
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <Text style={{ fontFamily: 'Orbitron', color: theme.text, fontSize: 13 }}>{car.brand}</Text>
                  {car.isMain && (
                    <View style={{ backgroundColor: theme.primaryBg, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, borderWidth: 1, borderColor: theme.primaryBorder }}>
                      <Text style={{ fontFamily: 'Orbitron', color: theme.primary, fontSize: 8 }}>GŁÓWNE</Text>
                    </View>
                  )}
                </View>
                <Text style={{ fontFamily: 'Orbitron', color: theme.primary, fontSize: 11 }}>{car.specs}</Text>
              </View>
              <MaterialIcons name="arrow-forward-ios" size={14} color={theme.textFaint} />
            </TouchableOpacity>
          ))
      }

      {/* OSIĄGNIĘCIA */}
      <Text style={{ fontFamily: 'Orbitron', color: theme.text, fontSize: 14, letterSpacing: 1, marginBottom: 12, marginTop: 24 }}>
        OSIĄGNIĘCIA ({achievements.length})
      </Text>
      {achievements.length === 0
        ? <Text style={{ fontFamily: 'Orbitron', color: theme.textFaint, fontSize: 11, textAlign: 'center', marginVertical: 12 }}>Brak odblokowanych osiągnięć</Text>
        : (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
            {achievements.map(a => (
              <AchievementBox key={a.key} icon={a.icon} label={a.label} active={a.active} rarity={a.rarity} progress={a.progress} points={a.points} description={a.description} category={a.category} currentValue={a.currentValue} conditionValue={a.conditionValue} conditionField={a.conditionField} unlockedAt={a.unlockedAt} />
            ))}
          </View>
        )
      }

      {/* SPOTY */}
      <Text style={{ fontFamily: 'Orbitron', color: theme.text, fontSize: 14, letterSpacing: 1, marginBottom: 12, marginTop: 24 }}>
        SPOTY ({spots.length})
      </Text>
      {spots.length === 0
        ? <Text style={{ fontFamily: 'Orbitron', color: theme.textFaint, fontSize: 11, textAlign: 'center', marginVertical: 12 }}>Brak dodanych spotów</Text>
        : (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
            {spots.map(spot => (
              <View key={spot.id} style={{ width: '48%', backgroundColor: theme.surface3, borderRadius: 12, overflow: 'hidden', borderWidth: 1, borderColor: theme.border }}>
                {spot.photos[0]
                  ? <Image source={{ uri: spot.photos[0] }} style={{ width: '100%', height: 100 }} resizeMode="cover" />
                  : <View style={{ width: '100%', height: 100, backgroundColor: theme.surface4, justifyContent: 'center', alignItems: 'center' }}>
                      <MaterialIcons name="place" size={24} color={theme.primary} />
                    </View>
                }
                <View style={{ padding: 10 }}>
                  <Text style={{ fontFamily: 'Orbitron', color: theme.text, fontSize: 11, marginBottom: 2 }} numberOfLines={1}>{spot.name}</Text>
                  <Text style={{ fontFamily: 'Orbitron', color: theme.primary, fontSize: 9, marginBottom: 6 }}>{spot.category}</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <MaterialIcons name="favorite" size={11} color={theme.primary} />
                    <Text style={{ fontFamily: 'Orbitron', color: theme.textDim, fontSize: 9, marginLeft: 3 }}>{spot.likesCount}</Text>
                    <MaterialIcons name="chat-bubble" size={11} color={theme.textDim} style={{ marginLeft: 6 }} />
                    <Text style={{ fontFamily: 'Orbitron', color: theme.textDim, fontSize: 9, marginLeft: 3 }}>{spot.commentsCount}</Text>
                  </View>
                </View>
              </View>
            ))}
          </View>
        )
      }
    </ScrollView>
  );
}