import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, Image, ActivityIndicator,
  FlatList, useWindowDimensions, NativeSyntheticEvent, NativeScrollEvent,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Toast from 'react-native-toast-message';
import { useTheme } from '../../../contexts/ThemeContext';
import { API_URL } from '../../../constants/config';
import { CommunityScreenHeader } from '../../../components/community';

const PAGE_SIZE = 10;

interface CarInfo {
  id: number;
  brand: string;
  specs: string;
  photos: string[];
  year?: number | null;
  power?: number | null;
  color?: string | null;
  isMain?: boolean;
}

interface Application {
  userId: number;
  user: { id: number; username: string; avatarUrl: string | null };
  car: CarInfo | null;
  participantStatus: string;
  participantAppliedAt: string;
  joinedAt: string;
}

interface ApplicationsResponse {
  items: Application[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

const FILTERS = [
  { key: '', label: 'Wszystkie' },
  { key: 'pending', label: 'Oczekujące' },
  { key: 'approved', label: 'Zaakceptowane' },
  { key: 'rejected', label: 'Odrzucone' },
];

function formatDt(iso: string) {
  return new Date(iso).toLocaleString('pl-PL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

const STATUS_STYLE: Record<string, { label: string; color: string }> = {
  pending:  { label: 'OCZEKUJE', color: '#ff9800' },
  approved: { label: 'ZAAKCEPTOWANE', color: '#4de926' },
  rejected: { label: 'ODRZUCONE', color: '#e33835' },
};

function CarPhotoCarousel({ photos, cardWidth, theme }: { photos: string[]; cardWidth: number; theme: any }) {
  const [active, setActive] = useState(0);
  const height = Math.round(cardWidth * 0.56);

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const x = e.nativeEvent.contentOffset.x;
    const idx = Math.round(x / cardWidth);
    if (idx !== active) setActive(idx);
  };

  if (!photos.length) {
    return (
      <View style={{ width: cardWidth, height, backgroundColor: theme.surface2, alignItems: 'center', justifyContent: 'center' }}>
        <MaterialCommunityIcons name="car-sports" size={48} color={theme.textDim} />
      </View>
    );
  }

  return (
    <View>
      <FlatList
        data={photos}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onScroll}
        keyExtractor={(uri, i) => `${uri}-${i}`}
        renderItem={({ item }) => (
          <Image
            source={{ uri: item }}
            style={{ width: cardWidth, height }}
            resizeMode="cover"
          />
        )}
        getItemLayout={(_, index) => ({ length: cardWidth, offset: cardWidth * index, index })}
      />
      {photos.length > 1 && (
        <View style={{ position: 'absolute', bottom: 10, left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', gap: 6 }}>
          {photos.map((_, i) => (
            <View
              key={i}
              style={{
                width: i === active ? 18 : 6,
                height: 6,
                borderRadius: 3,
                backgroundColor: i === active ? theme.primary : '#ffffff80',
              }}
            />
          ))}
        </View>
      )}
      {photos.length > 1 && (
        <View style={{ position: 'absolute', top: 10, right: 10, backgroundColor: '#000000aa', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 }}>
          <Text style={{ color: '#fff', fontFamily: 'Orbitron', fontSize: 9, fontWeight: '700' }}>
            {active + 1}/{photos.length}
          </Text>
        </View>
      )}
    </View>
  );
}

export default function MeetApplicationsScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { theme } = useTheme();
  const { width: screenWidth } = useWindowDimensions();
  const cardWidth = screenWidth - 32;

  const [apps, setApps] = useState<Application[]>([]);
  const [filter, setFilter] = useState('pending');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<number | null>(null);
  const [freeRemaining, setFreeRemaining] = useState(0);
  const [freeQuota, setFreeQuota] = useState(0);

  const getToken = async () =>
    (await AsyncStorage.getItem('userToken')) ?? (await AsyncStorage.getItem('token')) ?? '';

  const loadMeetStats = useCallback(async () => {
    try {
      const token = await getToken();
      const r = await fetch(`${API_URL}/api/meets/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await r.json();
      if (!r.ok) return;
      setFreeRemaining(data.freeParticipantEntryRemaining ?? 0);
      setFreeQuota(data.freeParticipantEntryQuota ?? 0);
    } catch { /* ignore */ }
  }, [id]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const token = await getToken();
      const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) });
      if (filter) params.set('status', filter);
      const r = await fetch(`${API_URL}/api/meets/${id}/participant-applications?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data: ApplicationsResponse = await r.json();
      if (!r.ok) throw new Error((data as any).error || 'Brak dostępu');
      setApps(data.items ?? []);
      setTotalPages(data.totalPages ?? 1);
      setTotal(data.total ?? 0);
    } catch (e: any) {
      Toast.show({ type: 'error', text1: 'BŁĄD', text2: e.message });
      router.back();
    } finally {
      setLoading(false);
    }
  }, [id, filter, page, router]);

  useEffect(() => { loadMeetStats(); }, [loadMeetStats]);
  useEffect(() => { load(); }, [load]);

  const review = async (userId: number, status: 'approved' | 'rejected') => {
    setActing(userId);
    try {
      const token = await getToken();
      const r = await fetch(`${API_URL}/api/meets/${id}/participant-applications/${userId}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Nie udało się');
      Toast.show({
        type: 'success',
        text1: status === 'approved' ? 'ZATWIERDZONO' : 'ODRZUCONO',
        text2: status === 'approved'
          ? 'Uczestnik dostanie QR — free przydzielane przy skanie na miejscu'
          : 'Użytkownik dostanie powiadomienie',
      });
      load();
      loadMeetStats();
    } catch (e: any) {
      Toast.show({ type: 'error', text1: 'BŁĄD', text2: e.message });
    } finally {
      setActing(null);
    }
  };

  const renderCard = ({ item: app }: { item: Application }) => {
    const st = STATUS_STYLE[app.participantStatus] ?? { label: app.participantStatus, color: theme.textDim };
    const photos = Array.isArray(app.car?.photos) ? app.car.photos.filter(Boolean) : [];
    const car = app.car;

    return (
      <View style={{ backgroundColor: theme.surface, borderRadius: 16, borderWidth: 1, borderColor: theme.border, overflow: 'hidden', marginBottom: 16 }}>
        <CarPhotoCarousel photos={photos} cardWidth={cardWidth} theme={theme} />

        <View style={{ padding: 14, gap: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <View style={{ width: 44, height: 44, borderRadius: 22, overflow: 'hidden', backgroundColor: theme.primaryBg, alignItems: 'center', justifyContent: 'center' }}>
              {app.user.avatarUrl
                ? <Image source={{ uri: app.user.avatarUrl }} style={{ width: '100%', height: '100%' }} />
                : <Text style={{ color: theme.primary, fontFamily: 'Orbitron', fontSize: 16, fontWeight: '700' }}>{app.user.username.charAt(0).toUpperCase()}</Text>
              }
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: theme.text, fontFamily: 'Orbitron', fontSize: 13, fontWeight: '700' }}>@{app.user.username}</Text>
              <Text style={{ color: theme.textDim, fontSize: 10, marginTop: 2 }}>Zgłoszono: {formatDt(app.participantAppliedAt)}</Text>
            </View>
            <View style={{ backgroundColor: st.color + '20', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, borderWidth: 1, borderColor: st.color + '50' }}>
              <Text style={{ color: st.color, fontFamily: 'Orbitron', fontSize: 8, fontWeight: '700' }}>{st.label}</Text>
            </View>
          </View>

          {car && (
            <View style={{ gap: 8 }}>
              <Text style={{ color: theme.textDim, fontFamily: 'Orbitron', fontSize: 8, letterSpacing: 1 }}>AUTO</Text>
              <Text style={{ color: theme.text, fontFamily: 'Orbitron', fontSize: 15, fontWeight: '700' }}>{car.brand}</Text>
              <Text style={{ color: theme.textDim, fontSize: 13, lineHeight: 20 }}>{car.specs}</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {!!car.year && (
                  <Tag theme={theme} icon="calendar-today" label={`${car.year} r.`} />
                )}
                {!!car.power && (
                  <Tag theme={theme} icon="speed" label={`${car.power} KM`} accent="#e33835" />
                )}
                {!!car.color && (
                  <Tag theme={theme} icon="palette" label={car.color} />
                )}
                {car.isMain && (
                  <Tag theme={theme} icon="star" label="Główne auto" accent={theme.primary} />
                )}
              </View>
            </View>
          )}

          {app.participantStatus === 'approved' && car && (
            <TouchableOpacity
              onPress={() => router.push({
                pathname: '/Community/meets/story',
                params: { id: String(id), userId: String(app.userId) },
              })}
              style={{
                marginTop: 4,
                backgroundColor: '#e33835',
                borderRadius: 12,
                paddingVertical: 16,
                alignItems: 'center',
                flexDirection: 'row',
                justifyContent: 'center',
                gap: 10,
              }}
            >
              <MaterialCommunityIcons name="instagram" size={20} color="#fff" />
              <Text style={{ color: '#fff', fontFamily: 'Orbitron', fontSize: 11, fontWeight: '800', letterSpacing: 0.5 }}>
                DODAJ NA STORY!
              </Text>
            </TouchableOpacity>
          )}

          {app.participantStatus === 'pending' && (
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 4 }}>
              <TouchableOpacity
                onPress={() => review(app.userId, 'rejected')}
                disabled={acting === app.userId}
                style={{ flex: 1, backgroundColor: '#e3383515', borderRadius: 12, paddingVertical: 14, alignItems: 'center', borderWidth: 1, borderColor: '#e3383540' }}
              >
                <Text style={{ color: '#e33835', fontFamily: 'Orbitron', fontSize: 10, fontWeight: '700' }}>ODRZUĆ</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => review(app.userId, 'approved')}
                disabled={acting === app.userId}
                style={{ flex: 1, backgroundColor: theme.primary, borderRadius: 12, paddingVertical: 14, alignItems: 'center' }}
              >
                {acting === app.userId
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Text style={{ color: '#fff', fontFamily: 'Orbitron', fontSize: 10, fontWeight: '700' }}>ZATWIERDŹ</Text>
                }
              </TouchableOpacity>
            </View>
          )}
        </View>
      </View>
    );
  };

  const listHeader = (
    <>
      {freeQuota > 0 && (
        <View style={{ marginBottom: 12, backgroundColor: theme.surface, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: theme.border }}>
          <Text style={{ color: theme.textDim, fontFamily: 'Orbitron', fontSize: 9, letterSpacing: 1 }}>FREE VROOM — UCZESTNICY Z AUTEM</Text>
          <Text style={{ color: freeRemaining > 0 ? '#4de926' : theme.textDim, fontFamily: 'Orbitron', fontSize: 20, fontWeight: '700', marginTop: 4 }}>
            {freeRemaining} / {freeQuota}
          </Text>
          <Text style={{ color: theme.textDim, fontSize: 10, marginTop: 4 }}>Free przydzielane przy skanie QR na miejscu</Text>
        </View>
      )}

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, marginBottom: 16 }}>
        {FILTERS.map(f => (
          <TouchableOpacity
            key={f.key || 'all'}
            onPress={() => { setFilter(f.key); setPage(1); }}
            style={{
              paddingHorizontal: 14, paddingVertical: 10, borderRadius: 20,
              borderWidth: 1,
              borderColor: filter === f.key ? theme.primary : theme.border,
              backgroundColor: filter === f.key ? theme.primaryBg : theme.surface,
            }}
          >
            <Text style={{ color: filter === f.key ? theme.primary : theme.textDim, fontFamily: 'Orbitron', fontSize: 9, fontWeight: '700' }}>
              {f.label}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {total > 0 && (
        <Text style={{ color: theme.textDim, fontFamily: 'Orbitron', fontSize: 9, letterSpacing: 1, marginBottom: 12 }}>
          ŁĄCZNIE {total} ZGŁOSZEŃ · STRONA {page}/{totalPages}
        </Text>
      )}
    </>
  );

  const listFooter = totalPages > 1 ? (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12, paddingVertical: 8, marginBottom: 24 }}>
      <TouchableOpacity
        onPress={() => setPage(p => Math.max(1, p - 1))}
        disabled={page <= 1 || loading}
        style={{
          width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center',
          borderWidth: 1, borderColor: theme.border, backgroundColor: theme.surface,
          opacity: page <= 1 ? 0.4 : 1,
        }}
      >
        <MaterialIcons name="chevron-left" size={24} color={theme.text} />
      </TouchableOpacity>
      <Text style={{ color: theme.text, fontFamily: 'Orbitron', fontSize: 12, fontWeight: '700', minWidth: 80, textAlign: 'center' }}>
        {page} / {totalPages}
      </Text>
      <TouchableOpacity
        onPress={() => setPage(p => Math.min(totalPages, p + 1))}
        disabled={page >= totalPages || loading}
        style={{
          width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center',
          borderWidth: 1, borderColor: theme.border, backgroundColor: theme.surface,
          opacity: page >= totalPages ? 0.4 : 1,
        }}
      >
        <MaterialIcons name="chevron-right" size={24} color={theme.text} />
      </TouchableOpacity>
    </View>
  ) : null;

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <CommunityScreenHeader title="ZGŁOSZENIA Z AUTEM" subtitle="Zatwierdzaj lub odrzucaj" />

      {loading && apps.length === 0 ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <ActivityIndicator size="large" color={theme.primary} />
        </View>
      ) : (
        <FlatList
          data={apps}
          keyExtractor={item => String(item.userId)}
          renderItem={renderCard}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24, paddingTop: 8 }}
          ListHeaderComponent={listHeader}
          ListFooterComponent={listFooter}
          ListEmptyComponent={
            <Text style={{ color: theme.textDim, textAlign: 'center', marginTop: 40 }}>Brak zgłoszeń w tej kategorii</Text>
          }
          refreshing={loading}
          onRefresh={load}
        />
      )}
    </View>
  );
}

function Tag({ icon, label, theme, accent }: { icon: string; label: string; theme: any; accent?: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: theme.bg, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, borderWidth: 1, borderColor: theme.border }}>
      <MaterialIcons name={icon as any} size={12} color={accent || theme.textDim} />
      <Text style={{ fontFamily: 'Orbitron', color: accent || theme.textDim, fontSize: 9, fontWeight: '700' }}>{label}</Text>
    </View>
  );
}
