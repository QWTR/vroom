import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, TextInput,
  RefreshControl, ActivityIndicator, StatusBar, Modal,
  ScrollView, Pressable, Platform, KeyboardAvoidingView,
} from 'react-native';
import { Image } from 'expo-image';
import { useRouter, useFocusEffect } from 'expo-router';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Toast from 'react-native-toast-message';
import { useTheme } from '../../../contexts/ThemeContext';
import { useModalSheetPadding } from '../../../components/layout/ModalKeyboardSheet';
import { useEffectivePremium } from '../../../hooks/useEffectivePremium';
import type { AppTheme } from '../../../constants/theme';
import { API_URL } from '../../../constants/config';
import { CommunityScreenHeader, CommunitySearchBar } from '../../../components/community';
import { EntranceIntroGate } from '../../../components/motion';

const PAGE               = 20;
const SEARCH_DEBOUNCE_MS = 400;

interface Seller {
  id: number;
  username: string;
  avatarUrl: string | null;
}

interface Listing {
  id: number;
  title: string;
  category: string;
  brand: string | null;
  model: string | null;
  year: number | null;
  mileage: number | null;
  power: number | null;
  drive: string | null;
  transmission: string | null;
  color: string | null;
  fuel: string | null;
  price: number;
  description: string | null;
  photos: string[];
  createdAt: string;
  seller: Seller;
  viewsCount?: number;
  views?: number;
  isPromoted?: boolean;
  promotedUntil?: string | null;
  location?: string | null;
}

interface MarketMeta {
  isPremium: boolean;
  limits: {
    freeActiveLimit: number;
    premiumActiveLimit: number;
    maxActiveListings: number;
  };
  usage: {
    activeListings: number;
  };
  pricing: {
    listingPaidPrice: number;
    promoteWeekPrice: number;
    promoteMonthPrice: number;
  };
  canCreateListing: boolean;
}

interface Filters {
  category: string;
  priceMin: string;
  priceMax: string;
  powerMin: string;
  powerMax: string;
  mileageMax: string;
  yearMin: string;
  yearMax: string;
  drive: string;
  transmission: string;
  fuel: string;
}

const CATEGORY_OPTIONS = ['wszystkie', 'auto', 'moto', 'części', 'inne'];
const DRIVE_OPTIONS    = ['wszystkie', 'FWD', 'RWD', 'AWD', '4x4'];
const TRANS_OPTIONS    = ['wszystkie', 'manualna', 'automatyczna'];
const FUEL_OPTIONS     = ['wszystkie', 'benzyna', 'diesel', 'LPG', 'hybryda', 'elektryczny', 'inne'];

function formatPrice(price: number) {
  return price.toLocaleString('pl-PL') + ' PLN';
}

function formatDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export default function MarketScreen() {
  const router = useRouter();
  const { theme, isDark } = useTheme();
  const [marketMeta, setMarketMeta] = useState<MarketMeta | null>(null);
  const { refresh: refreshPremiumAccess } = useEffectivePremium();
  /** Limity giełdy = wyłącznie odpowiedź serwera (/api/market/meta). */
  const effectivePremium = !!marketMeta?.isPremium;

  const [listings,       setListings]       = useState<Listing[]>([]);
  const [loading,        setLoading]        = useState(true);
  const [loadingMore,    setLoadingMore]    = useState(false);
  const [refreshing,     setRefreshing]     = useState(false);
  const [hasMore,        setHasMore]        = useState(true);
  const [page,           setPage]           = useState(1);
  const [search,         setSearch]         = useState('');
  const [filterVisible,  setFilterVisible]  = useState(false);
  const [myListingsCount, setMyListingsCount] = useState<number | null>(null);
  const [filters, setFilters] = useState<Filters>({
    category: 'wszystkie',
    priceMin: '', priceMax: '',
    powerMin: '', powerMax: '',
    mileageMax: '',
    yearMin: '', yearMax: '',
    drive: 'wszystkie',
    transmission: 'wszystkie',
    fuel: 'wszystkie',
  });
  const [pendingFilters, setPendingFilters] = useState<Filters>(filters);
  const [introDone, setIntroDone] = useState(false);
  const filterSheetPadding = useModalSheetPadding(filterVisible);

  const fetchingRef = useRef(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const getToken = async () =>
    (await AsyncStorage.getItem('userToken')) ?? (await AsyncStorage.getItem('token')) ?? '';

  const fetchMarketMeta = useCallback(async () => {
    try {
      const token = await getToken();
      const res = await fetch(`${API_URL}/api/market/meta`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const data = await res.json();
      setMarketMeta(data);
      setMyListingsCount(data?.usage?.activeListings ?? 0);
    } catch {}
  }, []);

  const fetchListings = useCallback(async (reset = true, q = search, f = filters) => {
    if (fetchingRef.current) return;
    fetchingRef.current = true;
    if (reset) setLoading(true);

    try {
      const token = await getToken();
      const params = new URLSearchParams({ limit: String(PAGE) });
      if (q) params.append('search', q);
      if (f.category !== 'wszystkie') params.append('category', f.category);
      if (f.priceMin)  params.append('priceMin',  f.priceMin);
      if (f.priceMax)  params.append('priceMax',  f.priceMax);
      if (f.powerMin)  params.append('powerMin',  f.powerMin);
      if (f.powerMax)  params.append('powerMax',  f.powerMax);
      if (f.mileageMax) params.append('mileageMax', f.mileageMax);
      if (f.yearMin)   params.append('yearMin',   f.yearMin);
      if (f.yearMax)   params.append('yearMax',   f.yearMax);
      if (f.drive !== 'wszystkie')        params.append('drive', f.drive);
      if (f.transmission !== 'wszystkie') params.append('transmission', f.transmission);
      if (f.fuel !== 'wszystkie')         params.append('fuel', f.fuel);

      const r    = await fetch(`${API_URL}/api/market?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await r.json();
      const list = data.listings ?? [];
      setListings(reset ? list : prev => {
        const ids = new Set(prev.map((l: Listing) => l.id));
        return [...prev, ...list.filter((l: Listing) => !ids.has(l.id))];
      });
      const currentPage = Number(data.page ?? 1);
      const pages = Number(data.pages ?? 1);
      setPage(currentPage);
      setHasMore(currentPage < pages);
    } catch (e) { console.error('fetchListings:', e); }
    finally {
      setLoading(false);
      setRefreshing(false);
      fetchingRef.current = false;
    }
  }, [search, filters]);

  const loadMore = useCallback(async () => {
    if (fetchingRef.current || !hasMore) return;
    fetchingRef.current = true;
    setLoadingMore(true);
    try {
      const token = await getToken();
      const params = new URLSearchParams({ limit: String(PAGE), page: String(page + 1) });
      if (search) params.append('search', search);
      if (filters.category !== 'wszystkie') params.append('category', filters.category);
      if (filters.fuel !== 'wszystkie') params.append('fuel', filters.fuel);
      const r    = await fetch(`${API_URL}/api/market?${params}`, { headers: { Authorization: `Bearer ${token}` } });
      const data = await r.json();
      const list = data.listings ?? [];
      setListings(prev => {
        const ids = new Set(prev.map((l: Listing) => l.id));
        return [...prev, ...list.filter((l: Listing) => !ids.has(l.id))];
      });
      const currentPage = Number(data.page ?? 1);
      const pages = Number(data.pages ?? 1);
      setPage(currentPage);
      setHasMore(currentPage < pages);
    } catch (e) { console.error('loadMore:', e); }
    finally { setLoadingMore(false); fetchingRef.current = false; }
  }, [hasMore, page, filters, search]);

  useFocusEffect(useCallback(() => {
    void refreshPremiumAccess();
    fetchListings(true);
    fetchMarketMeta();
  }, [refreshPremiumAccess, fetchListings, fetchMarketMeta]));

  const handleSearch = (q: string) => {
    setSearch(q);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => fetchListings(true, q, filters), SEARCH_DEBOUNCE_MS);
  };

  const applyFilters = () => {
    setFilters(pendingFilters);
    setFilterVisible(false);
    fetchListings(true, search, pendingFilters);
  };

  const resetFilters = () => {
    const empty: Filters = {
      category: 'wszystkie', priceMin: '', priceMax: '',
      powerMin: '', powerMax: '', mileageMax: '',
      yearMin: '', yearMax: '', drive: 'wszystkie', transmission: 'wszystkie',
      fuel: 'wszystkie',
    };
    setPendingFilters(empty);
    setFilters(empty);
    setFilterVisible(false);
    fetchListings(true, search, empty);
  };

  const activeFilterCount = [
    filters.category !== 'wszystkie',
    !!filters.priceMin || !!filters.priceMax,
    !!filters.powerMin || !!filters.powerMax,
    !!filters.mileageMax,
    !!filters.yearMin || !!filters.yearMax,
    filters.drive !== 'wszystkie',
    filters.transmission !== 'wszystkie',
    filters.fuel !== 'wszystkie',
  ].filter(Boolean).length;

  const renderItem = useCallback(({ item }: { item: Listing }) => (
    <TouchableOpacity
      activeOpacity={0.88}
      onPress={() => router.push({ pathname: '/Community/market/[id]', params: { id: String(item.id) } } as any)}
      style={{
        backgroundColor: theme.surface,
        borderRadius: 16, marginBottom: 14,
        borderWidth: 1, borderColor: theme.border,
        overflow: 'hidden',
      }}
    >
      {/* Thumbnail */}
      {item.photos?.[0] ? (
        <Image
          source={{ uri: item.photos[0] }}
          style={{ width: '100%', height: 180 }}
          contentFit="cover"
        />
      ) : (
        <View style={{ width: '100%', height: 120, backgroundColor: theme.surface2, alignItems: 'center', justifyContent: 'center' }}>
          <MaterialCommunityIcons name="car-outline" size={48} color={theme.border3} />
        </View>
      )}

      {/* Category badge */}
      <View style={{ position: 'absolute', top: 10, left: 10 }}>
        <View style={{ backgroundColor: '#000000cc', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 }}>
          <Text style={{ color: '#fff', fontFamily: 'Orbitron', fontSize: 8, fontWeight: '700' }}>
            {item.category.toUpperCase()}
          </Text>
        </View>
      </View>

      <View style={{ padding: 14, gap: 8 }}>
        {/* Title + price */}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
          <Text style={{ flex: 1, color: theme.text, fontFamily: 'Orbitron', fontSize: 13, fontWeight: '700', lineHeight: 18 }} numberOfLines={2}>
            {item.title}
          </Text>
          <Text style={{ color: theme.primary, fontFamily: 'Orbitron', fontSize: 14, fontWeight: '900', flexShrink: 0 }}>
            {formatPrice(item.price)}
          </Text>
        </View>

        {!!item.location && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <MaterialCommunityIcons name="map-marker-outline" size={12} color={theme.textDim} />
            <Text style={{ color: theme.textDim, fontFamily: 'Orbitron', fontSize: 9 }} numberOfLines={1}>
              {item.location}
            </Text>
          </View>
        )}

        {/* Specs row */}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {item.mileage != null && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <MaterialCommunityIcons name="speedometer" size={12} color={theme.textDim} />
              <Text style={{ color: theme.textDim, fontFamily: 'Orbitron', fontSize: 9 }}>
                {item.mileage.toLocaleString('pl-PL')} km
              </Text>
            </View>
          )}
          {item.power != null && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <MaterialCommunityIcons name="engine-outline" size={12} color={theme.textDim} />
              <Text style={{ color: theme.textDim, fontFamily: 'Orbitron', fontSize: 9 }}>{item.power} KM</Text>
            </View>
          )}
          {item.year != null && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <MaterialCommunityIcons name="calendar-outline" size={12} color={theme.textDim} />
              <Text style={{ color: theme.textDim, fontFamily: 'Orbitron', fontSize: 9 }}>{item.year}</Text>
            </View>
          )}
        </View>

        {/* Seller + date */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 8, borderTopWidth: 1, borderTopColor: theme.border }}>
          <TouchableOpacity
            activeOpacity={0.75}
            onPress={() => router.push({ pathname: '/profile/[userId]', params: { userId: String(item.seller.id) } } as any)}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}
          >
            <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: theme.primaryBg, borderWidth: 1, borderColor: theme.primaryBorder, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }}>
              {item.seller.avatarUrl
                ? <Image source={{ uri: item.seller.avatarUrl }} style={{ width: '100%', height: '100%' }} contentFit="cover" />
                : <Text style={{ color: theme.primary, fontFamily: 'Orbitron', fontSize: 7, fontWeight: '700' }}>{item.seller.username.charAt(0).toUpperCase()}</Text>
              }
            </View>
            <Text style={{ color: theme.textDim, fontFamily: 'Orbitron', fontSize: 9 }}>@{item.seller.username}</Text>
          </TouchableOpacity>
          <Text style={{ color: theme.textDim, fontFamily: 'Orbitron', fontSize: 8 }}>
            {item.isPromoted ? 'PROMOWANE · ' : ''}{formatDate(item.createdAt)}
          </Text>
        </View>
      </View>
    </TouchableOpacity>
  ), [theme, router]);

  const subText = isDark ? '#555555' : '#999999';

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={theme.bg} />

      <CommunityScreenHeader
        title="GIEŁDA"
        right={myListingsCount !== null ? (
          <TouchableOpacity
            onPress={() => !effectivePremium && marketMeta && !marketMeta.canCreateListing ? router.push('/premium' as any) : undefined}
            activeOpacity={effectivePremium ? 1 : 0.7}
          >
            <View style={{ backgroundColor: theme.surface2, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6, borderWidth: 1, borderColor: theme.border, alignItems: 'center' }}>
              <Text style={{ color: theme.textDim, fontFamily: 'Orbitron', fontSize: 7, letterSpacing: 1 }}>OGŁOSZENIA</Text>
              <Text style={{ color: marketMeta && !marketMeta.canCreateListing ? theme.primary : theme.text, fontFamily: 'Orbitron', fontSize: 13, fontWeight: '900' }}>
                {myListingsCount}/{marketMeta?.limits?.maxActiveListings ?? 1}
              </Text>
              {!effectivePremium && marketMeta && !marketMeta.canCreateListing && (
                <Text style={{ color: theme.gold, fontFamily: 'Orbitron', fontSize: 6, fontWeight: '700' }}>UPGRADE</Text>
              )}
            </View>
          </TouchableOpacity>
        ) : undefined}
      />

      <View style={{ paddingHorizontal: 16, paddingBottom: 14, backgroundColor: theme.surface, borderBottomWidth: 1, borderBottomColor: theme.border }}>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <View style={{ flex: 1 }}>
            <CommunitySearchBar
              value={search}
              onChangeText={handleSearch}
              placeholder="Szukaj ogłoszeń..."
            />
          </View>

          <TouchableOpacity
            style={{
              width: 46, height: 46, borderRadius: 12,
              backgroundColor: activeFilterCount > 0 ? theme.primary : theme.surface2,
              borderWidth: 1, borderColor: activeFilterCount > 0 ? theme.primary : theme.border,
              alignItems: 'center', justifyContent: 'center',
            }}
            onPress={() => { setPendingFilters(filters); setFilterVisible(true); }}
          >
            <MaterialCommunityIcons name="tune" size={20} color={activeFilterCount > 0 ? theme.onPrimary : theme.textDim} />
            {activeFilterCount > 0 && (
              <View style={{ position: 'absolute', top: -4, right: -4, width: 16, height: 16, borderRadius: 8, backgroundColor: theme.surface, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ color: theme.primary, fontFamily: 'Orbitron', fontSize: 8, fontWeight: '900' }}>{activeFilterCount}</Text>
              </View>
            )}
          </TouchableOpacity>
        </View>
      </View>

      <FlatList
        data={listings}
        keyExtractor={l => String(l.id)}
        renderItem={renderItem}
        onEndReached={loadMore}
        onEndReachedThreshold={0.3}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); fetchListings(true); }}
            tintColor={theme.primary} colors={[theme.primary]}
          />
        }
        ListFooterComponent={loadingMore ? <ActivityIndicator color={theme.primary} style={{ marginVertical: 16 }} /> : null}
        ListEmptyComponent={
          loading ? (
            <ActivityIndicator color={theme.primary} style={{ marginTop: 80 }} />
          ) : (
            <View style={{ alignItems: 'center', paddingTop: 80, gap: 12 }}>
              <MaterialCommunityIcons name="tag-multiple-outline" size={52} color={theme.border3} />
              <Text style={{ color: theme.textDim, fontFamily: 'Orbitron', fontSize: 14, fontWeight: '700' }}>Brak ogłoszeń</Text>
              <Text style={{ color: theme.textDim, fontFamily: 'Orbitron', fontSize: 10, textAlign: 'center' }}>
                Bądź pierwszy i dodaj ogłoszenie!
              </Text>
            </View>
          )
        }
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 16, paddingBottom: 120, flexGrow: 1 }}
      />

      {/* FAB */}
      <TouchableOpacity
        style={{
          position: 'absolute', bottom: 110, right: 20,
          width: 56, height: 56, borderRadius: 28,
          backgroundColor: theme.primary,
          alignItems: 'center', justifyContent: 'center',
          shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 8,
        }}
        onPress={() => router.push('/Community/market/add' as any)}
        activeOpacity={0.85}
      >
        <MaterialIcons name="add" size={28} color="#fff" />
      </TouchableOpacity>

      {/* Filter Modal */}
      <Modal visible={filterVisible} transparent animationType="slide" onRequestClose={() => setFilterVisible(false)}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          enabled={Platform.OS === 'ios'}
        >
        <View style={{ flex: 1, backgroundColor: '#000000bb', justifyContent: 'flex-end' }}>
          <Pressable style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} onPress={() => setFilterVisible(false)} />
          <View style={{
            backgroundColor: theme.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24,
            borderTopWidth: 1, borderColor: theme.border2,
            paddingBottom: filterSheetPadding,
            maxHeight: '85%',
          }}>
            <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: theme.border3, alignSelf: 'center', marginTop: 12, marginBottom: 16 }} />
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 20, gap: 20 }}>
              <Text style={{ color: theme.text, fontFamily: 'Orbitron', fontSize: 16, fontWeight: '700', letterSpacing: 1 }}>FILTRY</Text>

              {/* Category */}
              <FilterSection label="KATEGORIA">
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {CATEGORY_OPTIONS.map(opt => (
                    <TouchableOpacity
                      key={opt}
                      style={{
                        paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20,
                        backgroundColor: pendingFilters.category === opt ? theme.primary : theme.surface2,
                        borderWidth: 1, borderColor: pendingFilters.category === opt ? theme.primary : theme.border,
                      }}
                      onPress={() => setPendingFilters(f => ({ ...f, category: opt }))}
                    >
                      <Text style={{ color: pendingFilters.category === opt ? '#fff' : theme.textDim, fontFamily: 'Orbitron', fontSize: 9, fontWeight: '700' }}>
                        {opt.toUpperCase()}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </FilterSection>

              {/* Price */}
              <FilterSection label="CENA (PLN)">
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <FilterInput placeholder="Od" value={pendingFilters.priceMin} onChangeText={v => setPendingFilters(f => ({ ...f, priceMin: v }))} theme={theme} />
                  <FilterInput placeholder="Do" value={pendingFilters.priceMax} onChangeText={v => setPendingFilters(f => ({ ...f, priceMax: v }))} theme={theme} />
                </View>
              </FilterSection>

              {/* Power */}
              <FilterSection label="MOC (KM)">
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <FilterInput placeholder="Od" value={pendingFilters.powerMin} onChangeText={v => setPendingFilters(f => ({ ...f, powerMin: v }))} theme={theme} />
                  <FilterInput placeholder="Do" value={pendingFilters.powerMax} onChangeText={v => setPendingFilters(f => ({ ...f, powerMax: v }))} theme={theme} />
                </View>
              </FilterSection>

              {/* Mileage */}
              <FilterSection label="PRZEBIEG MAX (km)">
                <FilterInput placeholder="Maks. przebieg" value={pendingFilters.mileageMax} onChangeText={v => setPendingFilters(f => ({ ...f, mileageMax: v }))} theme={theme} />
              </FilterSection>

              {/* Year */}
              <FilterSection label="ROK PRODUKCJI">
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <FilterInput placeholder="Od" value={pendingFilters.yearMin} onChangeText={v => setPendingFilters(f => ({ ...f, yearMin: v }))} theme={theme} />
                  <FilterInput placeholder="Do" value={pendingFilters.yearMax} onChangeText={v => setPendingFilters(f => ({ ...f, yearMax: v }))} theme={theme} />
                </View>
              </FilterSection>

              {/* Drive */}
              <FilterSection label="NAPĘD">
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {DRIVE_OPTIONS.map(opt => (
                    <TouchableOpacity
                      key={opt}
                      style={{
                        paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20,
                        backgroundColor: pendingFilters.drive === opt ? theme.primary : theme.surface2,
                        borderWidth: 1, borderColor: pendingFilters.drive === opt ? theme.primary : theme.border,
                      }}
                      onPress={() => setPendingFilters(f => ({ ...f, drive: opt }))}
                    >
                      <Text style={{ color: pendingFilters.drive === opt ? '#fff' : theme.textDim, fontFamily: 'Orbitron', fontSize: 9, fontWeight: '700' }}>
                        {opt.toUpperCase()}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </FilterSection>

              {/* Transmission */}
              <FilterSection label="SKRZYNIA">
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  {TRANS_OPTIONS.map(opt => (
                    <TouchableOpacity
                      key={opt}
                      style={{
                        flex: 1, paddingVertical: 9, borderRadius: 20, alignItems: 'center',
                        backgroundColor: pendingFilters.transmission === opt ? theme.primary : theme.surface2,
                        borderWidth: 1, borderColor: pendingFilters.transmission === opt ? theme.primary : theme.border,
                      }}
                      onPress={() => setPendingFilters(f => ({ ...f, transmission: opt }))}
                    >
                      <Text style={{ color: pendingFilters.transmission === opt ? '#fff' : theme.textDim, fontFamily: 'Orbitron', fontSize: 8, fontWeight: '700' }}>
                        {opt.toUpperCase()}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </FilterSection>

              {/* Fuel */}
              <FilterSection label="PALIWO">
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {FUEL_OPTIONS.map(opt => (
                    <TouchableOpacity key={opt} style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: pendingFilters.fuel === opt ? theme.primary : theme.surface2, borderWidth: 1, borderColor: pendingFilters.fuel === opt ? theme.primary : theme.border, }} onPress={() => setPendingFilters(f => ({ ...f, fuel: opt }))}>
                      <Text style={{ color: pendingFilters.fuel === opt ? '#fff' : theme.textDim, fontFamily: 'Orbitron', fontSize: 9, fontWeight: '700' }}>{opt.toUpperCase()}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </FilterSection>
            </ScrollView>

            {/* Buttons */}
            <View style={{ flexDirection: 'row', paddingHorizontal: 20, paddingTop: 16, gap: 12 }}>
              <TouchableOpacity
                style={{ flex: 1, paddingVertical: 14, borderRadius: 14, borderWidth: 1, borderColor: theme.border, alignItems: 'center' }}
                onPress={resetFilters}
              >
                <Text style={{ color: theme.textDim, fontFamily: 'Orbitron', fontSize: 11, fontWeight: '700' }}>WYCZYŚĆ</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={{ flex: 2, paddingVertical: 14, borderRadius: 14, backgroundColor: theme.primary, alignItems: 'center' }}
                onPress={applyFilters}
              >
                <Text style={{ color: '#fff', fontFamily: 'Orbitron', fontSize: 11, fontWeight: '700' }}>ZASTOSUJ</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
        </KeyboardAvoidingView>
      </Modal>
      {!introDone && (
        <EntranceIntroGate
          presetId="market"
          screenKey="market_hub"
          onIntroDone={() => setIntroDone(true)}
        />
      )}
    </View>
  );
}

function FilterSection({ label, children }: { label: string; children: React.ReactNode }) {
  const { theme } = useTheme();
  return (
    <View style={{ gap: 10 }}>
      <Text style={{ color: theme.textDim, fontFamily: 'Orbitron', fontSize: 9, letterSpacing: 2 }}>{label}</Text>
      {children}
    </View>
  );
}

function FilterInput({ placeholder, value, onChangeText, theme }: { placeholder: string; value: string; onChangeText: (v: string) => void; theme: AppTheme }) {
  return (
    <TextInput
      style={{
        flex: 1, color: theme.text, fontFamily: 'Orbitron', fontSize: 12,
        backgroundColor: theme.surface2, borderRadius: 10, borderWidth: 1,
        borderColor: theme.border, paddingHorizontal: 12, paddingVertical: 10,
      }}
      placeholder={placeholder}
      placeholderTextColor={theme.textDim}
      value={value}
      onChangeText={onChangeText}
      keyboardType="numeric"
    />
  );
}
