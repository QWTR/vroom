import React, { useState, useCallback, useRef, useEffect } from 'react';
import { View, TouchableOpacity, FlatList, Image, RefreshControl, ActivityIndicator, StatusBar } from 'react-native';
import { AppText as Text } from '../../../components/ui/AppText';
import { useRouter, useFocusEffect } from 'expo-router';
import MaterialIcons          from '@expo/vector-icons/MaterialIcons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import AsyncStorage           from '@react-native-async-storage/async-storage';
import { useTheme }           from '../../../contexts/ThemeContext';
import { API_URL }            from '../../../constants/config';
import {
  CommunityScreenHeader,
  CommunitySearchBar,
  CommunitySegmentTabs,
} from '../../../components/community';
import { track, trackContentImpression } from '../../../lib/analytics/client';

const PAGE = 20;

interface Meet {
  id:               number;
  listKey?:         string;
  kind?:            'meet' | 'partner';
  partnerPoiId?:    number | null;
  title:            string;
  description:      string | null;
  locationName:     string;
  lat:              number | null;
  lng:              number | null;
  date:             string;
  maxParticipants:  number;
  hasCapacityLimit?: boolean;
  participantsCount: number;
  coverImage:       string | null;
  tags:             string[];
  status:           string | null;
  category:         string;
  ticketPrice:      number | null;
  ticketCurrency:   string;
  ticketUrl:        string | null;
  websiteUrl:       string | null;
  organizerName:    string | null;
  isJoined:         boolean;
  creator: { id: number; username: string; avatarUrl: string | null };
  participants: { id: number; username: string; avatarUrl: string | null }[];
}

function formatTicketLabel(price: number | null | undefined, currency: string) {
  if (price == null) return null;
  if (price === 0) return 'Wstęp wolny';
  return `${price.toFixed(0)} ${currency || 'PLN'}`;
}

function formatDate(iso: string) {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('pl-PL', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  } catch { return iso; }
}

function daysUntil(iso: string) {
  const diff = Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000);
  if (diff < 0) return null;
  if (diff === 0) return 'Dziś';
  if (diff === 1) return 'Jutro';
  if (diff < 7)  return `Za ${diff} dni`;
  return null;
}

async function getToken() {
  return (
    (await AsyncStorage.getItem('userToken'))
    ?? (await AsyncStorage.getItem('token'))
    ?? ''
  );
}

export default function EventsScreen() {
  const router = useRouter();
  const { theme, isDark } = useTheme();

  const [category,    setCategory]    = useState<'unofficial' | 'official'>('official');
  const [meets,       setMeets]       = useState<Meet[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing,  setRefreshing]  = useState(false);
  const [hasMore,     setHasMore]     = useState(true);
  const [cursor,      setCursor]      = useState<number | null>(null);
  const [search,      setSearch]      = useState('');
  const [loadError,   setLoadError]   = useState('');
  const searchRef = useRef('');

  const fetchingRef  = useRef(false);
  const searchTimer  = useRef<any>(null);
  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 60, minimumViewTime: 800 }).current;
  const onViewableItemsChanged = useRef(({ viewableItems }: any) => {
    for (const entry of viewableItems || []) {
      const meet = entry.item as Meet;
      trackContentImpression({ screenName: 'community_meets', surface: 'meet_list', entityType: 'meet', entityId: meet.id, position: entry.index ?? undefined });
    }
  }).current;

  const fetchMeets = useCallback(async (
    reset: boolean,
    q: string,
    cat: 'unofficial' | 'official',
  ) => {
    if (fetchingRef.current) return;
    fetchingRef.current = true;
    if (reset) setLoading(true);
    setLoadError('');

    try {
      const token = await getToken();
      const params = new URLSearchParams({
        category: cat,
        limit:    String(PAGE),
        ...(q ? { search: q } : {}),
      });
      const response = await fetch(`${API_URL}/api/meets?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `Events HTTP ${response.status}`);
      const meetList: Meet[] = (data.meets ?? []).map((m: Meet) => ({ ...m, kind: 'meet' as const, listKey: `meet-${m.id}` }));
      const merged = meetList.sort(
        (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
      );
      setMeets(reset ? merged : (prev) => {
        const ids = new Set(prev.map((m) => m.listKey || String(m.id)));
        return [...prev, ...merged.filter((m) => !ids.has(m.listKey || String(m.id)))];
      });
      setCursor(data.nextCursor ?? null);
      setHasMore(!!data.nextCursor);
    } catch (e: any) {
      console.error('fetchMeets:', e);
      setLoadError(e?.message || 'Nie udało się pobrać wydarzeń');
      if (reset) setMeets([]);
    }
    finally {
      setLoading(false);
      setRefreshing(false);
      fetchingRef.current = false;
    }
  }, []);

  useEffect(() => {
    fetchMeets(true, searchRef.current, category);
  }, [category, fetchMeets]);
  useFocusEffect(useCallback(() => {
    fetchMeets(true, searchRef.current, category);
  }, [category, fetchMeets]));

  const handleSearch = (q: string) => {
    setSearch(q);
    searchRef.current = q;
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      if (q.trim()) track({ eventName: 'search_submitted', screenName: 'community_meets', surface: 'meet_search', priority: 'medium', properties: { query_length: q.trim().length, category } });
      fetchMeets(true, q, category);
    }, 400);
  };

  const loadMore = useCallback(async () => {
    if (!hasMore || loadingMore || fetchingRef.current || !cursor) return;
    fetchingRef.current = true;
    setLoadingMore(true);
    try {
      const token = await getToken();
      const params = new URLSearchParams({ category, limit: String(PAGE), cursor: String(cursor), ...(search ? { search } : {}) });
      const r    = await fetch(`${API_URL}/api/meets?${params}`, { headers: { Authorization: `Bearer ${token}` } });
      const data = await r.json();
      const list: Meet[] = (data.meets ?? []).map((m: Meet) => ({
        ...m,
        kind: 'meet' as const,
        listKey: `meet-${m.id}`,
      }));
      setMeets(prev => {
        const ids = new Set(prev.map((m: Meet) => m.listKey || `meet-${m.id}`));
        return [...prev, ...list.filter((m: Meet) => !ids.has(m.listKey || `meet-${m.id}`))];
      });
      setCursor(data.nextCursor ?? null);
      setHasMore(!!data.nextCursor);
    } catch (e) { console.error('loadMore:', e); }
    finally { setLoadingMore(false); fetchingRef.current = false; }
  }, [hasMore, loadingMore, cursor, category, search]);

  const handleJoin = useCallback(async (meet: Meet) => {
    try {
      const token = await getToken();
      const r = await fetch(`${API_URL}/api/meets/${meet.id}/join`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}` },
      });
      const data = await r.json();
      setMeets((prev) => prev.map((m) =>
        m.id === meet.id && m.kind !== 'partner'
          ? { ...m, isJoined: data.joined, participantsCount: data.participantsCount }
          : m));
    } catch (e) { console.error('handleJoin:', e); }
  }, []);

  const openItem = useCallback((item: Meet) => {
    track({ eventName: 'content_opened', screenName: 'community_meets', surface: 'meet_list', entityType: 'meet', entityId: item.id, priority: 'medium' });
    router.push({ pathname: '/Community/meets/meet', params: { id: String(item.id) } });
  }, [router]);

  const renderMeet = useCallback(({ item }: { item: Meet }) => {
    const pct      = item.participantsCount / Math.max(item.maxParticipants, 1);
    const spots    = item.maxParticipants - item.participantsCount;
    const badge    = daysUntil(item.date);
    const isFull   = item.hasCapacityLimit !== false && spots <= 0;
    const isHot    = item.status === 'HOT' || pct >= 0.8;
    const isPartner = item.kind === 'partner';

    const ticketLabel = formatTicketLabel(item.ticketPrice, item.ticketCurrency);
    const isOfficial  = item.category === 'official';

    return (
      <TouchableOpacity
        onPress={() => openItem(item)}
        activeOpacity={0.88}
        style={{
          backgroundColor: theme.surface,
          borderRadius: 18,
          marginBottom: 14,
          borderWidth: 1,
          borderColor: theme.border,
          overflow: 'hidden',
        }}
      >
        {/* Cover / placeholder */}
        {item.coverImage ? (
          <Image source={{ uri: item.coverImage }} style={{ width: '100%', height: 140 }} resizeMode="cover" />
        ) : (
          <View style={{ width: '100%', height: 100, backgroundColor: theme.surface2, alignItems: 'center', justifyContent: 'center' }}>
            <MaterialCommunityIcons name={isPartner ? 'storefront' : 'car-multiple'} size={40} color={theme.border3} />
          </View>
        )}

        {/* Badges na obrazku */}
        <View style={{ position: 'absolute', top: 10, left: 10, flexDirection: 'row', gap: 6, flexWrap: 'wrap', maxWidth: '85%' }}>
          {isPartner ? (
            <View style={{ backgroundColor: '#e33835dd', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 }}>
              <Text style={{ color: '#fff', fontFamily: 'Manrope_600SemiBold', fontSize: 12, fontWeight: '700' }}>PARTNER</Text>
            </View>
          ) : isOfficial ? (
            <View style={{ backgroundColor: '#FFD700dd', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 }}>
              <Text style={{ color: '#000', fontFamily: 'Manrope_600SemiBold', fontSize: 12, fontWeight: '700' }}>⭐ OFICJALNE</Text>
            </View>
          ) : null}
          {isHot && !isPartner && (
            <View style={{ backgroundColor: theme.primary, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 }}>
              <Text style={{ color: '#fff', fontFamily: 'Manrope_600SemiBold', fontSize: 12, fontWeight: '700' }}>🔥 HOT</Text>
            </View>
          )}
          {badge && (
            <View style={{ backgroundColor: '#000000aa', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 }}>
              <Text style={{ color: '#fff', fontFamily: 'Manrope_600SemiBold', fontSize: 12, fontWeight: '700' }}>{badge}</Text>
            </View>
          )}
        </View>

        {/* Content */}
        <View style={{ padding: 14, gap: 10 }}>
          {/* Tytuł + join */}
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
            <Text style={{ flex: 1, color: theme.text, fontFamily: 'Manrope_600SemiBold', fontSize: 14, fontWeight: '700', lineHeight: 20 }}>
              {item.title}
            </Text>
            <TouchableOpacity
              onPress={() => handleJoin(item)}
              disabled={isFull && !item.isJoined}
              style={[{
                paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10,
                borderWidth: 1,
              }, item.isJoined
                ? { backgroundColor: '#4de92615', borderColor: '#4de92640' }
                : isFull
                  ? { backgroundColor: theme.surface2, borderColor: theme.border }
                  : { backgroundColor: theme.primaryBg, borderColor: theme.primaryBorder }
              ]}
            >
              <Text style={{
                fontFamily: 'Manrope_600SemiBold', fontSize: 12, fontWeight: '700',
                color: item.isJoined ? '#4de926' : isFull ? theme.textDim : theme.primary,
              }}>
                {item.isJoined ? (isPartner ? '✓ ZAPISANO' : '✓ DOŁĄCZONO') : isFull ? 'PEŁNE' : (isPartner ? 'ZAPISZ SIĘ' : 'DOŁĄCZ')}
              </Text>
            </TouchableOpacity>
          </View>

          {/* Meta */}
          <View style={{ gap: 6 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
              <MaterialIcons name="access-time" size={13} color={theme.primary} />
              <Text style={{ color: theme.textDim, fontFamily: 'Manrope_600SemiBold', fontSize: 12 }}>{formatDate(item.date)}</Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
              <MaterialIcons name="location-on" size={13} color={theme.primary} />
              <Text style={{ color: theme.textDim, fontFamily: 'Manrope_600SemiBold', fontSize: 12 }} numberOfLines={1}>{item.locationName}</Text>
            </View>
            {ticketLabel && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                <MaterialIcons name="confirmation-number" size={13} color={theme.primary} />
                <Text style={{ color: theme.textDim, fontFamily: 'Manrope_600SemiBold', fontSize: 12 }}>{ticketLabel}</Text>
              </View>
            )}
            {item.organizerName && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                <MaterialIcons name="business" size={13} color={theme.primary} />
                <Text style={{ color: theme.textDim, fontFamily: 'Manrope_600SemiBold', fontSize: 12 }} numberOfLines={1}>{item.organizerName}</Text>
              </View>
            )}
          </View>

          {/* Tagi */}
          {item.tags.length > 0 && (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {item.tags.slice(0, 4).map((tag, i) => (
                <View key={i} style={{ backgroundColor: theme.surface2, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, borderWidth: 1, borderColor: theme.primaryBorder }}>
                  <Text style={{ color: theme.primary, fontFamily: 'Manrope_600SemiBold', fontSize: 12, fontWeight: '700' }}>{tag}</Text>
                </View>
              ))}
            </View>
          )}

          {/* Pasek + uczestnicy */}
          <View style={{ gap: 6 }}>
            <View style={{ height: 4, backgroundColor: theme.border, borderRadius: 2, overflow: 'hidden' }}>
              <View style={{ height: '100%', width: `${Math.min(pct * 100, 100)}%`, backgroundColor: isFull ? '#e33835' : theme.primary, borderRadius: 2 }} />
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                {item.participants.slice(0, 4).map((p, i) => (
                  <View key={p.id} style={{ marginLeft: i === 0 ? 0 : -8, width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: theme.surface, overflow: 'hidden', backgroundColor: theme.surface2 }}>
                    {p.avatarUrl
                      ? <Image source={{ uri: p.avatarUrl }} style={{ width: '100%', height: '100%' }} />
                      : <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                          <Text style={{ color: theme.primary, fontFamily: 'Manrope_600SemiBold', fontSize: 12, fontWeight: '700' }}>{(p.username || '?').charAt(0).toUpperCase()}</Text>
                        </View>
                    }
                  </View>
                ))}
                <Text style={{ color: theme.textDim, fontFamily: 'Manrope_600SemiBold', fontSize: 12, marginLeft: item.participants.length > 0 ? 8 : 0 }}>
                  {item.hasCapacityLimit === false
                    ? item.participantsCount
                    : `${item.participantsCount}/${item.maxParticipants}`}
                </Text>
              </View>
              <Text style={{ color: isFull ? theme.primary : theme.textDim, fontFamily: 'Manrope_600SemiBold', fontSize: 12 }}>
                {isFull
                  ? 'BRAK MIEJSC'
                  : isPartner
                    ? `${item.participantsCount} zapisanych`
                    : `${spots} miejsc`}
              </Text>
            </View>
          </View>

          {/* Organizer */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, paddingTop: 6, borderTopWidth: 1, borderTopColor: theme.border }}>
            <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: theme.primaryBg, borderWidth: 1, borderColor: theme.primaryBorder, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
              {item.creator.avatarUrl
                ? <Image source={{ uri: item.creator.avatarUrl }} style={{ width: '100%', height: '100%' }} />
                : <Text style={{ color: theme.primary, fontFamily: 'Manrope_600SemiBold', fontSize: 12, fontWeight: '700' }}>{(item.creator.username || '?').charAt(0).toUpperCase()}</Text>
              }
            </View>
            <Text style={{ color: theme.textDim, fontFamily: 'Manrope_600SemiBold', fontSize: 12 }}>
              <Text style={{ color: theme.text }}>{isPartner ? item.creator.username : `@${item.creator.username}`}</Text>
            </Text>
          </View>
        </View>
      </TouchableOpacity>
    );
  }, [theme, handleJoin, openItem]);

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={theme.bg} />

      <CommunityScreenHeader
        title="WYDARZENIA"
        subtitle="Oficjalne zloty i meety społeczności"
        right={
          category === 'unofficial' ? (
            <TouchableOpacity
              style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: theme.primaryBg, borderWidth: 1, borderColor: theme.primaryBorder, alignItems: 'center', justifyContent: 'center' }}
              onPress={() => router.push('/Community/meets/createmeet' as any)}
            >
              <MaterialIcons name="add" size={24} color={theme.primary} />
            </TouchableOpacity>
          ) : undefined
        }
      />

      <CommunitySegmentTabs
        tabs={[
          { key: 'official', label: 'OFICJALNE' },
          { key: 'unofficial', label: 'NIEOFICJALNE' },
        ]}
        activeKey={category}
        onChange={(k) => setCategory(k as 'unofficial' | 'official')}
      />

      <View style={{ paddingHorizontal: 16, paddingBottom: 12 }}>
        <CommunitySearchBar
          value={search}
          onChangeText={handleSearch}
          placeholder={category === 'official' ? 'Szukaj wydarzeń...' : 'Szukaj meetów...'}
          onClear={() => handleSearch('')}
        />
        {loadError ? (
          <View style={{ marginTop: 10, padding: 10, borderRadius: 10, backgroundColor: '#e3383520', borderWidth: 1, borderColor: '#e3383550' }}>
            <Text style={{ color: '#ff6b72', fontSize: 12 }}>{loadError}</Text>
          </View>
        ) : null}
      </View>

      <FlatList
        data={meets}
        keyExtractor={(m) => m.listKey || String(m.id)}
        renderItem={renderMeet}
        viewabilityConfig={viewabilityConfig}
        onViewableItemsChanged={onViewableItemsChanged}
        onEndReached={loadMore}
        onEndReachedThreshold={0.3}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              fetchMeets(true, search, category);
            }}
            tintColor={theme.primary} colors={[theme.primary]}
          />
        }
        ListFooterComponent={loadingMore ? <ActivityIndicator color={theme.primary} style={{ marginVertical: 16 }} /> : null}
        ListEmptyComponent={
          loading ? (
            <ActivityIndicator color={theme.primary} style={{ marginTop: 80 }} />
          ) : (
            <View style={{ alignItems: 'center', paddingTop: 80, gap: 12 }}>
              <MaterialCommunityIcons name="car-off" size={52} color={theme.border3} />
              <Text style={{ color: theme.textDim, fontFamily: 'Manrope_600SemiBold', fontSize: 14, fontWeight: '700' }}>
                {category === 'official' ? 'Brak oficjalnych meetów' : 'Brak meetów'}
              </Text>
              <Text style={{ color: theme.textDim, fontFamily: 'Manrope_600SemiBold', fontSize: 12, textAlign: 'center' }}>
                {category === 'unofficial' ? 'Bądź pierwszy i zorganizuj meet!' : 'Wkrótce pojawią się oficjalne wydarzenia'}
              </Text>
              {category === 'unofficial' && (
                <TouchableOpacity
                  onPress={() => router.push('/Community/meets/createmeet' as any)}
                  style={{ marginTop: 8, backgroundColor: theme.primary, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 20 }}
                >
                  <Text style={{ color: '#fff', fontFamily: 'Manrope_600SemiBold', fontSize: 12, fontWeight: '700' }}>+ UTWÓRZ MEET</Text>
                </TouchableOpacity>
              )}
            </View>
          )
        }
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 16, paddingBottom: 100, flexGrow: 1 }}
      />
    </View>
  );
}
