import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, Image,
  FlatList, Modal, ActivityIndicator, StatusBar, Platform,
} from 'react-native';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import MaterialIcons          from '@expo/vector-icons/MaterialIcons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import AsyncStorage           from '@react-native-async-storage/async-storage';
import Toast                  from 'react-native-toast-message';
import { useTheme }           from '../../../contexts/ThemeContext';
import { API_URL }            from '../../../constants/config';

interface MeetUser {
  id:        number;
  username:  string;
  avatarUrl: string | null;
}

interface MeetDetail {
  id:                number;
  title:             string;
  description:       string | null;
  locationName:      string;
  lat:               number | null;
  lng:               number | null;
  date:              string;
  maxParticipants:   number;
  participantsCount: number;
  coverImage:        string | null;
  tags:              string[];
  rules:             string[];
  status:            string | null;
  category:          string;
  isJoined:          boolean;
  creator:           MeetUser;
  participants:      MeetUser[];
}

function daysUntil(iso: string) {
  const diff = Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000);
  if (diff < 0)   return { label: 'Minęło',        color: '#888' };
  if (diff === 0) return { label: 'DZIŚ',           color: '#e33835' };
  if (diff === 1) return { label: 'JUTRO',          color: '#ff9800' };
  if (diff <= 7)  return { label: `Za ${diff} dni`, color: '#4de926' };
  return null;
}

export default function MeetDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { theme, isDark } = useTheme();

  const [meet,         setMeet]         = useState<MeetDetail | null>(null);
  const [loading,      setLoading]      = useState(true);
  const [joinLoading,  setJoinLoading]  = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [myId,         setMyId]         = useState<number | null>(null);

  const getToken = async () =>
    (await AsyncStorage.getItem('userToken')) ?? (await AsyncStorage.getItem('token')) ?? '';

  const fetchMeet = useCallback(async () => {
    setLoading(true);
    try {
      const token = await getToken();
      const r     = await fetch(`${API_URL}/api/meets/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) throw new Error('Błąd pobierania');
      setMeet(await r.json());
    } catch (e: any) {
      Toast.show({ type: 'error', text1: 'BŁĄD', text2: e.message });
    } finally {
      setLoading(false);
    }
  }, [id]);

  // Pobierz myId raz przy mount
  useEffect(() => {
    AsyncStorage.getItem('user').then(raw => {
      if (raw) setMyId(JSON.parse(raw).userId ?? JSON.parse(raw).id);
    });
  }, []);

  // Odśwież po powrocie z edycji
  useFocusEffect(
    useCallback(() => { fetchMeet(); }, [fetchMeet])
  );

  const handleJoin = useCallback(async () => {
    if (!meet || joinLoading) return;
    setJoinLoading(true);
    try {
      const token = await getToken();
      const r     = await fetch(`${API_URL}/api/meets/${meet.id}/join`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}` },
      });
      const data = await r.json();
      if (!r.ok) return Toast.show({ type: 'error', text1: 'BŁĄD', text2: data.error });
      setMeet(prev => prev ? { ...prev, isJoined: data.joined, participantsCount: data.participantsCount } : prev);
      Toast.show({ type: 'success', text1: data.joined ? '🏁 DOŁĄCZONO!' : 'Opuszczono meet', text2: meet.title });
    } catch {
      Toast.show({ type: 'error', text1: 'Błąd połączenia' });
    } finally { setJoinLoading(false); }
  }, [meet, joinLoading]);

  const openMaps = useCallback(async () => {
    if (!meet?.lat || !meet?.lng) {
      Toast.show({ type: 'error', text1: 'Brak współrzędnych meetu' }); return;
    }
    await AsyncStorage.setItem('nav_destination', JSON.stringify({
      latitude: meet.lat, longitude: meet.lng, name: meet.locationName,
    }));
    router.push('/(tabs)/map' as any);
  }, [meet, router]);

  if (loading) return (
    <View style={{ flex: 1, backgroundColor: theme.bg, justifyContent: 'center', alignItems: 'center' }}>
      <ActivityIndicator size="large" color={theme.primary} />
    </View>
  );

  if (!meet) return (
    <View style={{ flex: 1, backgroundColor: theme.bg, justifyContent: 'center', alignItems: 'center' }}>
      <Text style={{ color: theme.text, fontFamily: 'Orbitron' }}>Nie znaleziono meetu</Text>
    </View>
  );

  const spots   = meet.maxParticipants - meet.participantsCount;
  const pct     = Math.min(meet.participantsCount / meet.maxParticipants, 1);
  const isFull  = spots <= 0;
  const isOwner = myId === meet.creator.id;
  const badge   = daysUntil(meet.date);
  const isHot   = meet.status === 'HOT' || pct >= 0.8;

  const renderParticipant = ({ item }: { item: MeetUser }) => (
    <TouchableOpacity
      style={{ flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: theme.surface, borderRadius: 12, padding: 12, marginBottom: 10, borderWidth: 1, borderColor: theme.border }}
      onPress={() => router.push(`/profile/${item.id}` as any)}
      activeOpacity={0.8}
    >
      <View style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: theme.primaryBg, borderWidth: 1, borderColor: theme.primaryBorder, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }}>
        {item.avatarUrl
          ? <Image source={{ uri: item.avatarUrl }} style={{ width: '100%', height: '100%' }} />
          : <Text style={{ color: theme.primary, fontFamily: 'Orbitron', fontSize: 13, fontWeight: '700' }}>{item.username.charAt(0).toUpperCase()}</Text>
        }
      </View>
      <Text style={{ flex: 1, color: theme.text, fontFamily: 'Orbitron', fontSize: 12, fontWeight: '700' }}>{item.username}</Text>
      {item.id === meet.creator.id && (
        <View style={{ backgroundColor: theme.primaryBg, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4, borderWidth: 1, borderColor: theme.primaryBorder }}>
          <Text style={{ color: theme.primary, fontFamily: 'Orbitron', fontSize: 8, fontWeight: '700' }}>ORGANIZATOR</Text>
        </View>
      )}
      <MaterialIcons name="arrow-forward-ios" size={12} color={theme.textDim} />
    </TouchableOpacity>
  );

  return (
    <>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />
      <ScrollView style={{ flex: 1, backgroundColor: theme.bg }} contentContainerStyle={{ paddingBottom: 120 }} showsVerticalScrollIndicator={false}>

        {/* COVER */}
        <View style={{ position: 'relative', height: meet.coverImage ? 240 : 160 }}>
          {meet.coverImage ? (
            <Image source={{ uri: meet.coverImage }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
          ) : (
            <View style={{ flex: 1, backgroundColor: theme.surface, alignItems: 'center', justifyContent: 'center' }}>
              <MaterialCommunityIcons name="car-multiple" size={64} color={theme.border3} />
            </View>
          )}
          <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 80, backgroundColor: '#00000060' }} />

          {/* Nawigacja góra */}
          <View style={{ position: 'absolute', top: 48, left: 16, right: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <TouchableOpacity
              style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: '#00000060', alignItems: 'center', justifyContent: 'center' }}
              onPress={() => router.back()}
            >
              <MaterialIcons name="arrow-back" size={20} color="#fff" />
            </TouchableOpacity>
            {isOwner && (
              <TouchableOpacity
                style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: '#00000060', alignItems: 'center', justifyContent: 'center' }}
                onPress={() => router.push({ pathname: '/Community/meets/editmeet', params: { id: String(meet.id) } } as any)}
              >
                <MaterialIcons name="edit" size={18} color="#fff" />
              </TouchableOpacity>
            )}
          </View>

          {/* Badges */}
          <View style={{ position: 'absolute', bottom: 14, left: 16, flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            {isHot && (
              <View style={{ backgroundColor: theme.primary, borderRadius: 6, paddingHorizontal: 10, paddingVertical: 5 }}>
                <Text style={{ color: '#fff', fontFamily: 'Orbitron', fontSize: 9, fontWeight: '700' }}>🔥 HOT</Text>
              </View>
            )}
            {badge && (
              <View style={{ backgroundColor: badge.color + 'dd', borderRadius: 6, paddingHorizontal: 10, paddingVertical: 5 }}>
                <Text style={{ color: '#fff', fontFamily: 'Orbitron', fontSize: 9, fontWeight: '700' }}>{badge.label}</Text>
              </View>
            )}
            <View style={{ backgroundColor: meet.category === 'official' ? '#FFD700dd' : '#00000060', borderRadius: 6, paddingHorizontal: 10, paddingVertical: 5 }}>
              <Text style={{ color: '#fff', fontFamily: 'Orbitron', fontSize: 9, fontWeight: '700' }}>
                {meet.category === 'official' ? '⭐ OFICJALNY' : '🏁 NIEOFICJALNY'}
              </Text>
            </View>
          </View>
        </View>

        <View style={{ paddingHorizontal: 16, paddingTop: 20, gap: 20 }}>

          {/* TYTUŁ + ORGANIZATOR */}
          <View style={{ gap: 14 }}>
            <Text style={{ color: theme.text, fontFamily: 'Orbitron', fontSize: 22, fontWeight: '700', lineHeight: 30 }}>{meet.title}</Text>
            <TouchableOpacity
              style={{ flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: theme.surface, padding: 12, borderRadius: 14, borderWidth: 1, borderColor: theme.border }}
              onPress={() => router.push(`/profile/${meet.creator.id}` as any)} activeOpacity={0.8}
            >
              <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: theme.primaryBg, borderWidth: 1.5, borderColor: theme.primaryBorder, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }}>
                {meet.creator.avatarUrl
                  ? <Image source={{ uri: meet.creator.avatarUrl }} style={{ width: '100%', height: '100%' }} />
                  : <Text style={{ color: theme.primary, fontFamily: 'Orbitron', fontSize: 15, fontWeight: '700' }}>{meet.creator.username.charAt(0).toUpperCase()}</Text>
                }
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: theme.textDim, fontFamily: 'Orbitron', fontSize: 9, letterSpacing: 1 }}>ORGANIZATOR</Text>
                <Text style={{ color: theme.text, fontFamily: 'Orbitron', fontSize: 13, fontWeight: '700' }}>@{meet.creator.username}</Text>
              </View>
              <MaterialIcons name="arrow-forward-ios" size={14} color={theme.textDim} />
            </TouchableOpacity>
          </View>

          {/* QUICK INFO */}
          <View style={{ flexDirection: 'row', gap: 10 }}>
            {[
              { icon: 'access-time', label: 'DATA',       value: new Date(meet.date).toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit' }) },
              { icon: 'schedule',    label: 'GODZINA',    value: new Date(meet.date).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' }) },
              { icon: 'people',      label: 'UCZESTNICY', value: `${meet.participantsCount}/${meet.maxParticipants}` },
            ].map(info => (
              <View key={info.label} style={{ flex: 1, backgroundColor: theme.surface, borderRadius: 14, padding: 12, borderWidth: 1, borderColor: theme.border, alignItems: 'center', gap: 6 }}>
                <MaterialIcons name={info.icon as any} size={18} color={theme.primary} />
                <Text style={{ color: theme.textDim, fontFamily: 'Orbitron', fontSize: 8, letterSpacing: 1 }}>{info.label}</Text>
                <Text style={{ color: theme.text, fontFamily: 'Orbitron', fontSize: 11, fontWeight: '700', textAlign: 'center' }}>{info.value}</Text>
              </View>
            ))}
          </View>

          {/* PASEK ZAPEŁNIENIA */}
          <View style={{ backgroundColor: theme.surface, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: theme.border, gap: 10 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ color: theme.textDim, fontFamily: 'Orbitron', fontSize: 10 }}>Miejsca</Text>
              <Text style={{ color: isFull ? '#e33835' : theme.text, fontFamily: 'Orbitron', fontSize: 11, fontWeight: '700' }}>
                {isFull ? 'BRAK MIEJSC' : `${spots} wolnych`}
              </Text>
            </View>
            <View style={{ height: 6, backgroundColor: theme.border, borderRadius: 3, overflow: 'hidden' }}>
              <View style={{ height: '100%', width: `${pct * 100}%`, backgroundColor: isFull ? '#e33835' : theme.primary, borderRadius: 3 }} />
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ color: theme.textDim, fontFamily: 'Orbitron', fontSize: 9 }}>{meet.participantsCount} zapisanych</Text>
              <Text style={{ color: theme.textDim, fontFamily: 'Orbitron', fontSize: 9 }}>{meet.maxParticipants} miejsc łącznie</Text>
            </View>
          </View>

          {/* TAGI */}
          {meet.tags.length > 0 && (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {meet.tags.map((tag, i) => (
                <View key={i} style={{ backgroundColor: theme.primaryBg, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8, borderWidth: 1, borderColor: theme.primaryBorder }}>
                  <Text style={{ color: theme.primary, fontFamily: 'Orbitron', fontSize: 9, fontWeight: '700' }}>{tag}</Text>
                </View>
              ))}
            </View>
          )}

          {/* OPIS */}
          {!!meet.description && (
            <View style={{ gap: 10 }}>
              <Text style={{ color: theme.textDim, fontFamily: 'Orbitron', fontSize: 9, letterSpacing: 2 }}>O MEECIE</Text>
              <Text style={{ color: theme.text, fontSize: 13, lineHeight: 22 }}>{meet.description}</Text>
            </View>
          )}

          {/* LOKALIZACJA */}
          <View style={{ gap: 10 }}>
            <Text style={{ color: theme.textDim, fontFamily: 'Orbitron', fontSize: 9, letterSpacing: 2 }}>LOKALIZACJA</Text>
            <TouchableOpacity
              style={{ backgroundColor: theme.surface, borderRadius: 14, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderColor: theme.border }}
              onPress={openMaps} activeOpacity={0.8}
            >
              <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: theme.primaryBg, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: theme.primaryBorder }}>
                <MaterialIcons name="location-on" size={20} color={theme.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: theme.text, fontFamily: 'Orbitron', fontSize: 12, fontWeight: '700' }} numberOfLines={2}>{meet.locationName}</Text>
                {meet.lat && meet.lng && (
                  <Text style={{ color: theme.textDim, fontSize: 10, marginTop: 3 }}>
                    📍 {meet.lat.toFixed(4)}, {meet.lng.toFixed(4)}
                  </Text>
                )}
              </View>
              <View style={{ alignItems: 'center', gap: 3 }}>
                <MaterialIcons name="navigation" size={18} color={theme.primary} />
                <Text style={{ color: theme.primary, fontFamily: 'Orbitron', fontSize: 8 }}>NAWIGUJ</Text>
              </View>
            </TouchableOpacity>
          </View>

          {/* ZASADY */}
          {meet.rules.length > 0 && (
            <View style={{ gap: 12 }}>
              <Text style={{ color: theme.textDim, fontFamily: 'Orbitron', fontSize: 9, letterSpacing: 2 }}>ZASADY</Text>
              {meet.rules.map((rule, i) => (
                <View key={i} style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start' }}>
                  <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: theme.primaryBg, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: theme.primaryBorder, flexShrink: 0 }}>
                    <Text style={{ color: theme.primary, fontFamily: 'Orbitron', fontSize: 11, fontWeight: '700' }}>{i + 1}</Text>
                  </View>
                  <Text style={{ flex: 1, color: theme.text, fontSize: 13, lineHeight: 20, marginTop: 4 }}>{rule}</Text>
                </View>
              ))}
            </View>
          )}

          {/* UCZESTNICY */}
          <View style={{ gap: 12 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={{ color: theme.textDim, fontFamily: 'Orbitron', fontSize: 9, letterSpacing: 2 }}>UCZESTNICY</Text>
              <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }} onPress={() => setModalVisible(true)}>
                <Text style={{ color: theme.primary, fontFamily: 'Orbitron', fontSize: 10, fontWeight: '700' }}>WSZYSCY ({meet.participantsCount})</Text>
                <MaterialIcons name="arrow-forward-ios" size={11} color={theme.primary} />
              </TouchableOpacity>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              {meet.participants.slice(0, 6).map((p, i) => (
                <TouchableOpacity
                  key={p.id}
                  style={{ marginLeft: i === 0 ? 0 : -10, width: 38, height: 38, borderRadius: 19, borderWidth: 2, borderColor: theme.bg, backgroundColor: theme.primaryBg, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }}
                  onPress={() => router.push(`/profile/${p.id}` as any)}
                >
                  {p.avatarUrl
                    ? <Image source={{ uri: p.avatarUrl }} style={{ width: '100%', height: '100%' }} />
                    : <Text style={{ color: theme.primary, fontFamily: 'Orbitron', fontSize: 11, fontWeight: '700' }}>{p.username.charAt(0).toUpperCase()}</Text>
                  }
                </TouchableOpacity>
              ))}
              {meet.participantsCount > 6 && (
                <View style={{ marginLeft: -10, width: 38, height: 38, borderRadius: 19, backgroundColor: theme.surface, borderWidth: 2, borderColor: theme.bg, alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ color: theme.textDim, fontFamily: 'Orbitron', fontSize: 9, fontWeight: '700' }}>+{meet.participantsCount - 6}</Text>
                </View>
              )}
            </View>
          </View>

        </View>
      </ScrollView>

      {/* FLOATING CTA */}
      <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: theme.bg, borderTopWidth: 1, borderTopColor: theme.border, padding: 16, paddingBottom: Platform.OS === 'ios' ? 32 : 16, flexDirection: 'row', gap: 10 }}>
        <View style={{ backgroundColor: theme.surface, borderRadius: 12, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: theme.border }}>
          <Text style={{ color: theme.primary, fontFamily: 'Orbitron', fontSize: 16, fontWeight: '700' }}>
            {new Date(meet.date).toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit' })}
          </Text>
          <Text style={{ color: theme.textDim, fontFamily: 'Orbitron', fontSize: 8 }}>
            {new Date(meet.date).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })}
          </Text>
        </View>

        <TouchableOpacity
          style={[{
            flex: 1, borderRadius: 14, paddingVertical: 16,
            flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
          },
            meet.isJoined
              ? { backgroundColor: '#4de92615', borderWidth: 1, borderColor: '#4de92640' }
              : isFull
                ? { backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border }
                : { backgroundColor: theme.primary },
            joinLoading && { opacity: 0.7 },
          ]}
          onPress={handleJoin}
          disabled={joinLoading || (isFull && !meet.isJoined)}
          activeOpacity={0.85}
        >
          {joinLoading ? (
            <ActivityIndicator size="small" color={meet.isJoined ? '#4de926' : '#fff'} />
          ) : (
            <>
              <MaterialIcons
                name={meet.isJoined ? 'check-circle' : isFull ? 'block' : 'add-circle-outline'}
                size={20}
                color={meet.isJoined ? '#4de926' : isFull ? theme.textDim : '#fff'}
              />
              <Text style={{ fontFamily: 'Orbitron', fontSize: 13, fontWeight: '700', color: meet.isJoined ? '#4de926' : isFull ? theme.textDim : '#fff' }}>
                {meet.isJoined ? 'DOŁĄCZONO ✓' : isFull ? 'BRAK MIEJSC' : 'DOŁĄCZ DO MEETU'}
              </Text>
            </>
          )}
        </TouchableOpacity>
      </View>

      {/* MODAL uczestnicy */}
      <Modal visible={modalVisible} animationType="slide" transparent onRequestClose={() => setModalVisible(false)}>
        <View style={{ flex: 1, backgroundColor: theme.overlay, justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: theme.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 16, paddingTop: 20, maxHeight: '85%' }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: theme.border }}>
              <Text style={{ color: theme.text, fontFamily: 'Orbitron', fontSize: 16, fontWeight: '700' }}>UCZESTNICY ({meet.participantsCount})</Text>
              <TouchableOpacity style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: theme.surface, alignItems: 'center', justifyContent: 'center' }} onPress={() => setModalVisible(false)}>
                <MaterialIcons name="close" size={18} color={theme.text} />
              </TouchableOpacity>
            </View>
            <FlatList
              data={meet.participants} renderItem={renderParticipant}
              keyExtractor={p => String(p.id)} contentContainerStyle={{ paddingBottom: 40 }}
              showsVerticalScrollIndicator={false}
            />
          </View>
        </View>
      </Modal>
    </>
  );
}