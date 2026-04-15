import React, { useState, useEffect, useRef, useCallback, memo } from 'react';
import {
  Modal, View, Text, TouchableOpacity, TextInput,
  FlatList, ActivityIndicator, StyleSheet, Platform,
  StatusBar, SafeAreaView, ScrollView, BackHandler,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import debounce from 'lodash.debounce';
import Toast from 'react-native-toast-message';
import { User, LocationState } from '../../constants/types';
import { calculateDistance } from '../../scripts/distance';
import { GOOGLE_MAPS_APIKEY, MAX_NEARBY_USERS_DISTANCE } from '../../constants/mapConfig';
import { useTheme } from '../../contexts/ThemeContext';
import {
  usePlacesNearby,
  PLACE_CATEGORIES,
  PlaceCategory,
  NearbyPlace,
  detectBrand,
} from '../../hooks/usePlacesNearby';

interface SearchModalProps {
  visible:       boolean;
  onClose:       () => void;
  onSelectStart: (location: LocationState) => void;
  onSelectEnd:   (location: LocationState) => void;
  userLocation:  LocationState | null;
  nearbyUsers:   User[];
}

export const SearchModal = memo(({
  visible, onClose, onSelectStart, onSelectEnd, userLocation, nearbyUsers,
}: SearchModalProps) => {
  const { theme: t } = useTheme();
  const {
    places, loading: placesLoading,
    activeCategory, fetchPlaces, clear: clearPlaces,
  } = usePlacesNearby();

  const [activeTab,      setActiveTab]      = useState<'start' | 'end'>('end');
  const [searchQuery,    setSearchQuery]    = useState('');
  const [filteredPlaces, setFilteredPlaces] = useState<any[]>([]);
  const [filteredUsers,  setFilteredUsers]  = useState<User[]>([]);
  const [isSearching,    setIsSearching]    = useState(false);
  const [detectedBrand,  setDetectedBrand]  = useState<string | null>(null);
  const [searchMode,     setSearchMode]     = useState<
    'initial' | 'users' | 'friends' | 'results' | 'nearby'
  >('initial');

  // ── Refs żeby BackHandler zawsze miał świeże wartości ──
  const searchModeRef    = useRef(searchMode);
  const resetToInitialRef = useRef<() => void>(() => {});
  const onCloseRef       = useRef(onClose);

  useEffect(() => { searchModeRef.current = searchMode; },    [searchMode]);
  useEffect(() => { onCloseRef.current    = onClose; },       [onClose]);

  // ─────────────────────────────────────────────────────
  const resetToInitial = useCallback(() => {
    setSearchMode('initial');
    setSearchQuery('');
    setFilteredUsers([]);
    setFilteredPlaces([]);
    setDetectedBrand(null);
    clearPlaces();
  }, [clearPlaces]);

  useEffect(() => { resetToInitialRef.current = resetToInitial; }, [resetToInitial]);

  // ── BackHandler ───────────────────────────────────────
  useEffect(() => {
    if (!visible) return;

    const onBack = () => {
      if (searchModeRef.current !== 'initial') {
        resetToInitialRef.current();
      } else {
        onCloseRef.current();
      }
      return true;
    };

    const sub = BackHandler.addEventListener('hardwareBackPress', onBack);
    return () => sub.remove();
  }, [visible]); // tylko visible — reszta przez ref

  // ─────────────────────────────────────────────────────
  const handleSelectUserCategory = useCallback((category: 'users' | 'friends') => {
    setSearchMode(category);
    setSearchQuery('');
    setFilteredPlaces([]);
    setDetectedBrand(null);
    clearPlaces();
    const mapped = nearbyUsers
      .filter(u => {
        if (category === 'friends') return u.isFriend;
        if (!userLocation) return false;
        return (
          !u.isFriend &&
          calculateDistance(
            userLocation.latitude, userLocation.longitude,
            u.latitude, u.longitude,
          ) <= MAX_NEARBY_USERS_DISTANCE
        );
      })
      .map(u => ({
        ...u,
        distance: userLocation
          ? calculateDistance(userLocation.latitude, userLocation.longitude, u.latitude, u.longitude)
          : 0,
      }))
      .sort((a, b) => (a.distance || 0) - (b.distance || 0));
    setFilteredUsers(mapped);
  }, [nearbyUsers, userLocation, clearPlaces]);

  // ──────────────────────────���──────────────────────────
  const handleSelectPlaceCategory = useCallback((category: PlaceCategory) => {
    if (!userLocation) { Toast.show({ type: 'error', text1: 'Brak lokalizacji GPS' }); return; }
    setSearchMode('nearby');
    setSearchQuery('');
    setDetectedBrand(null);
    fetchPlaces(userLocation.latitude, userLocation.longitude, category);
  }, [userLocation, fetchPlaces]);

  // ─────────────────────────────────────────────────────
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const handleSearch = useCallback(debounce(async (query: string) => {
    if (query.length < 2) {
      setSearchMode('initial');
      setFilteredPlaces([]);
      setFilteredUsers([]);
      setDetectedBrand(null);
      clearPlaces();
      return;
    }

    const brand = detectBrand(query);
    if (brand && userLocation) {
      setDetectedBrand(brand.label);
      setSearchMode('nearby');
      setFilteredPlaces([]);
      setFilteredUsers([]);
      fetchPlaces(userLocation.latitude, userLocation.longitude, brand.type);
      return;
    }

    setDetectedBrand(null);
    setSearchMode('results');
    setIsSearching(true);
    setFilteredUsers([]);
    clearPlaces();
    try {
      const res = await fetch(
        `https://maps.googleapis.com/maps/api/place/autocomplete/json?` +
        `input=${encodeURIComponent(query)}&key=${GOOGLE_MAPS_APIKEY}&language=pl&` +
        `location=${userLocation?.latitude ?? 52.2297},${userLocation?.longitude ?? 21.0122}&radius=50000`,
      );
      const data = await res.json();
      setFilteredPlaces(data.predictions || []);
    } catch {
      Toast.show({ type: 'error', text1: 'BŁĄD WYSZUKIWANIA' });
    } finally {
      setIsSearching(false);
    }
  }, 400), [userLocation, clearPlaces, fetchPlaces]);

  // ─────────────────────────────────────────────────────
  const selectLocation = useCallback((location: LocationState, label: string) => {
    if (activeTab === 'start') {
      onSelectStart(location);
      Toast.show({ type: 'success', text1: '📍 POCZĄTEK USTAWIONY', text2: label });
      setActiveTab('end');
      resetToInitial();
    } else {
      onSelectEnd(location);
      Toast.show({ type: 'success', text1: '🏁 CEL USTAWIONY', text2: label });
      onClose();
    }
  }, [activeTab, onSelectStart, onSelectEnd, onClose, resetToInitial]);

  const handleSelectAutocomplete = useCallback(async (placeId: string, name: string) => {
    setIsSearching(true);
    try {
      const res  = await fetch(`https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&key=${GOOGLE_MAPS_APIKEY}`);
      const data = await res.json();
      if (data.result?.geometry) {
        const c = data.result.geometry.location;
        selectLocation({ latitude: c.lat, longitude: c.lng, name, placeId }, name);
      }
    } catch {
      Toast.show({ type: 'error', text1: 'BŁĄD', text2: 'Nie mogę pobrać szczegółów miejsca' });
    } finally {
      setIsSearching(false);
    }
  }, [selectLocation]);

  const handleSelectNearby = useCallback((place: NearbyPlace) => {
    selectLocation(
      { latitude: place.lat, longitude: place.lng, name: place.name, placeId: place.placeId },
      place.name,
    );
  }, [selectLocation]);

  const handleSelectUser = useCallback((user: User) => {
    selectLocation({ latitude: user.latitude, longitude: user.longitude, name: user.name }, user.name);
  }, [selectLocation]);

  const handleSelectCurrent = useCallback(() => {
    if (userLocation) selectLocation({ ...userLocation, name: 'Moja pozycja' }, 'Moja pozycja');
  }, [userLocation, selectLocation]);

  // ─────────────────────────────────────────────────────
  const friendCount    = nearbyUsers.filter(u => u.isFriend).length;
  const otherUserCount = nearbyUsers.filter(u =>
    !u.isFriend && userLocation &&
    calculateDistance(userLocation.latitude, userLocation.longitude, u.latitude, u.longitude) <= MAX_NEARBY_USERS_DISTANCE,
  ).length;

  const showInitial = searchMode === 'initial' && searchQuery.length === 0;
  const showUsers   = searchMode === 'users' || searchMode === 'friends';
  const showResults = searchMode === 'results';
  const showNearby  = searchMode === 'nearby';

  const activeCatData = PLACE_CATEGORIES.find(c => c.key === activeCategory);

  // ─────────────────────────────────────────────────────
  return (
    <Modal 
      visible={visible} 
      animationType="fade" 
      transparent={false} 
      statusBarTranslucent
      onRequestClose={() => {           // ← DODAJ TO
        if (searchMode !== 'initial') {
          resetToInitial();
        } else {
          onClose();
        }
      }}
      >
      <StatusBar barStyle="light-content" backgroundColor={t.bg} />
      <SafeAreaView style={[ss.root, { backgroundColor: t.bg }]}>

        {/* ── HEADER ────────────────────────────────────── */}
        <View style={[ss.header, { borderBottomColor: t.border2 }]}>
          <TouchableOpacity
            style={[ss.iconBtn, { backgroundColor: t.surface2, borderColor: t.border2 }]}
            onPress={searchMode !== 'initial' ? resetToInitial : onClose}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <MaterialIcons
              name={searchMode !== 'initial' ? 'arrow-back' : 'close'}
              size={18}
              color={t.textMuted}
            />
          </TouchableOpacity>

          <View style={{ flex: 1, marginHorizontal: 12 }}>
            <View style={[ss.tabsRow, { backgroundColor: t.surface2, borderColor: t.border2 }]}>
              {(['start', 'end'] as const).map(tab => (
                <TouchableOpacity
                  key={tab}
                  style={[ss.tab, activeTab === tab && { backgroundColor: t.surface3 }]}
                  onPress={() => { setActiveTab(tab); resetToInitial(); }}
                  activeOpacity={0.8}
                >
                  {activeTab === tab && (
                    <View style={[ss.tabLine, { backgroundColor: t.primary }]} />
                  )}
                  <MaterialIcons
                    name={tab === 'start' ? 'radio-button-on' : 'flag'}
                    size={12}
                    color={activeTab === tab ? t.primary : t.textDim}
                  />
                  <Text style={[ss.tabText, { color: activeTab === tab ? t.primary : t.textDim }]}>
                    {tab === 'start' ? 'POCZĄTEK' : 'CEL'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <View style={{ width: 36 }} />
        </View>

        {/* ── INPUT ─────────────────────────────────────── */}
        <View style={[ss.inputWrap, { backgroundColor: t.surface, borderColor: t.border2 }]}>
          <MaterialIcons name="search" size={20} color={t.primary} />
          <TextInput
            style={[ss.input, { color: t.text }]}
            placeholder={activeTab === 'start' ? 'Skąd jedziesz?' : 'Dokąd jedziesz?'}
            placeholderTextColor={t.textDim}
            value={searchQuery}
            onChangeText={text => { setSearchQuery(text); handleSearch(text); }}
            autoFocus
            autoCorrect={false}
            autoCapitalize="none"
            returnKeyType="search"
            selectionColor={t.primary}
            blurOnSubmit={false}
          />
          {isSearching || placesLoading
            ? <ActivityIndicator size="small" color={t.primary} />
            : searchQuery.length > 0
              ? (
                <TouchableOpacity
                  onPress={() => { setSearchQuery(''); resetToInitial(); }}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <View style={[ss.clearBtn, { backgroundColor: t.surface3 }]}>
                    <MaterialIcons name="close" size={11} color={t.textMuted} />
                  </View>
                </TouchableOpacity>
              ) : null
          }
        </View>

        <View style={[ss.divider, { backgroundColor: t.border }]} />

        {/* ══════════════════════════════════════════════ */}
        {/* INITIAL                                        */}
        {/* ══════════════════════════════════════════════ */}
        {showInitial && (
          <ScrollView
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 32 }}
          >
            <TouchableOpacity onPress={handleSelectCurrent} activeOpacity={0.85} style={{ marginBottom: 20 }}>
              <LinearGradient
                colors={['#e33835', '#b01e1b']}
                start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                style={ss.myLocCard}
              >
                <View style={{ position: 'absolute', right: -20, top: -20, width: 110, height: 110, borderRadius: 55, backgroundColor: '#ffffff12' }} />
                <View style={ss.myLocIcon}>
                  <MaterialIcons name="my-location" size={22} color="#fff" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={ss.myLocTitle}>Moja pozycja</Text>
                  <Text style={ss.myLocSub}>
                    Ustaw jako {activeTab === 'start' ? 'punkt startowy' : 'cel podróży'}
                  </Text>
                </View>
                <View style={ss.myLocArrow}>
                  <MaterialIcons name="arrow-forward" size={15} color="#fff" />
                </View>
              </LinearGradient>
            </TouchableOpacity>

            <Text style={[ss.sectionLabel, { color: t.textDim }]}>W POBLIŻU</Text>
            <View style={ss.nearbyGrid}>
              {PLACE_CATEGORIES.map(cat => (
                <TouchableOpacity
                  key={cat.key}
                  style={[ss.nearbyCard, { backgroundColor: t.surface, borderColor: t.border2 }]}
                  onPress={() => handleSelectPlaceCategory(cat.key)}
                  activeOpacity={0.8}
                >
                  <View style={{
                    position: 'absolute', top: -12, right: -12,
                    width: 56, height: 56, borderRadius: 28,
                    backgroundColor: cat.color + '0c',
                  }} />
                  <Text style={ss.nearbyEmoji}>{cat.emoji}</Text>
                  <Text style={[ss.nearbyLabel, { color: t.text }]}>{cat.label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={[ss.sectionLabel, { color: t.textDim, marginTop: 20 }]}>UŻYTKOWNICY</Text>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              {[
                { key: 'users'   as const, icon: 'people',   label: 'UŻYTKOWNICY', sub: `${otherUserCount} w pobliżu`, count: otherUserCount, color: '#268bff' },
                { key: 'friends' as const, icon: 'favorite', label: 'ZNAJOMI',     sub: `${friendCount} aktywnych`,   count: friendCount,    color: t.online  },
              ].map(item => (
                <TouchableOpacity
                  key={item.key}
                  style={[ss.catCard, { flex: 1, backgroundColor: t.surface, borderColor: t.border2 }]}
                  onPress={() => handleSelectUserCategory(item.key)}
                  activeOpacity={0.8}
                >
                  <View style={{
                    position: 'absolute', top: -14, right: -14,
                    width: 64, height: 64, borderRadius: 32,
                    backgroundColor: item.color + '0e',
                  }} />
                  <View style={[ss.catIcon, { backgroundColor: item.color + '18', borderColor: item.color + '30' }]}>
                    <MaterialIcons name={item.icon as any} size={20} color={item.color} />
                  </View>
                  <Text style={[ss.catLabel, { color: t.text }]}>{item.label}</Text>
                  <Text style={[ss.catSub, { color: t.textDim }]}>{item.sub}</Text>
                  <View style={[ss.catBadge, { backgroundColor: item.color + '18', borderColor: item.color + '30' }]}>
                    <Text style={[ss.catBadgeNum, { color: item.color }]}>{item.count}</Text>
                  </View>
                </TouchableOpacity>
              ))}
            </View>

            <View style={[ss.hintRow, { marginTop: 20 }]}>
              <MaterialIcons name="keyboard" size={12} color={t.textFaint} />
              <Text style={[ss.hintText, { color: t.textFaint }]}>
                wpisz adres, nazwę lub brand (np. Orlen, Lidl)
              </Text>
            </View>
          </ScrollView>
        )}

        {/* ══════════════════════════════════════════════ */}
        {/* NEARBY PLACES                                  */}
        {/* ══════════════════════════════════════════════ */}
        {showNearby && (
          <View style={{ flex: 1 }}>
            {detectedBrand && (
              <View style={[ss.brandBanner, { backgroundColor: t.primaryBg, borderColor: t.primaryBorder }]}>
                <MaterialIcons name="auto-awesome" size={13} color={t.primary} />
                <Text style={[ss.brandBannerText, { color: t.primary }]}>
                  Wykryto: {detectedBrand} · pokazuję wyniki w pobliżu
                </Text>
              </View>
            )}

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: 8, paddingHorizontal: 16, paddingVertical: 10 }}
              style={[ss.chipsScroll, { borderBottomColor: t.border2 }]}
            >
              {PLACE_CATEGORIES.map(cat => (
                <TouchableOpacity
                  key={cat.key}
                  onPress={() => handleSelectPlaceCategory(cat.key)}
                  style={[
                    ss.chip,
                    {
                      backgroundColor: activeCategory === cat.key ? cat.color + '25' : t.surface2,
                      borderColor:     activeCategory === cat.key ? cat.color         : t.border2,
                    },
                  ]}
                  activeOpacity={0.8}
                >
                  <Text style={{ fontSize: 14 }}>{cat.emoji}</Text>
                  <Text style={[ss.chipText, {
                    color: activeCategory === cat.key ? cat.color : t.textDim,
                  }]}>
                    {cat.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            {placesLoading ? (
              <View style={ss.emptyBox}>
                <ActivityIndicator size="large" color={activeCatData?.color ?? t.primary} />
                <Text style={[ss.emptyTitle, { color: t.textDim, marginTop: 12 }]}>
                  SZUKAM {activeCatData?.label}...
                </Text>
              </View>
            ) : (
              <FlatList
                data={places}
                keyExtractor={item => item.placeId}
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24, paddingTop: 8 }}
                ListHeaderComponent={
                  places.length > 0
                    ? (
                      <Text style={[ss.sectionLabel, { color: t.textDim }]}>
                        {places.length} WYNIKÓW · {activeCatData?.label}
                      </Text>
                    ) : null
                }
                ListEmptyComponent={
                  <View style={ss.emptyBox}>
                    <Text style={{ fontSize: 44 }}>{activeCatData?.emoji ?? '📍'}</Text>
                    <Text style={[ss.emptyTitle, { color: t.textDim }]}>BRAK W POBLIŻU</Text>
                    <Text style={[ss.emptySub, { color: t.textFaint }]}>
                      Nie znaleziono w promieniu 5 km
                    </Text>
                  </View>
                }
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={[ss.row, { borderBottomColor: t.border }]}
                    onPress={() => handleSelectNearby(item)}
                    activeOpacity={0.7}
                  >
                    <View style={[ss.placeBox, {
                      backgroundColor: (activeCatData?.color ?? t.primary) + '18',
                      borderColor:     (activeCatData?.color ?? t.primary) + '35',
                    }]}>
                      <Text style={{ fontSize: 18 }}>{activeCatData?.emoji ?? '📍'}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[ss.rowTitle, { color: t.text }]} numberOfLines={1}>
                        {item.name}
                      </Text>
                      <Text style={[ss.rowSub, { color: t.textDim }]} numberOfLines={1}>
                        {item.address}
                      </Text>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4 }}>
                        {item.distance !== undefined && (
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                            <MaterialIcons name="near-me" size={9} color={t.textFaint} />
                            <Text style={[ss.rowMeta, { color: t.textFaint }]}>
                              {item.distance < 1
                                ? `${Math.round(item.distance * 1000)} m`
                                : `${item.distance.toFixed(1)} km`}
                            </Text>
                          </View>
                        )}
                        {item.rating !== undefined && (
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                            <MaterialIcons name="star" size={9} color={t.gold} />
                            <Text style={[ss.rowMeta, { color: t.gold }]}>
                              {item.rating.toFixed(1)}
                            </Text>
                          </View>
                        )}
                        {item.isOpen !== undefined && (
                          <View style={[ss.openBadge, {
                            backgroundColor: item.isOpen ? t.success + '20' : t.danger + '20',
                            borderColor:     item.isOpen ? t.success + '40' : t.danger + '40',
                          }]}>
                            <Text style={[ss.openText, {
                              color: item.isOpen ? t.success : t.danger,
                            }]}>
                              {item.isOpen ? 'OTWARTE' : 'ZAMKNIĘTE'}
                            </Text>
                          </View>
                        )}
                      </View>
                    </View>
                    <View style={[ss.arrowBox, { backgroundColor: t.surface3 }]}>
                      <MaterialIcons name="arrow-forward-ios" size={11} color={t.textMuted} />
                    </View>
                  </TouchableOpacity>
                )}
              />
            )}
          </View>
        )}

        {/* ══════════════════════════════════════════════ */}
        {/* USERS / FRIENDS                                */}
        {/* ══════════════════════════════════════════════ */}
        {showUsers && (
          <FlatList
            data={filteredUsers}
            keyExtractor={item => item.id}
            keyboardShouldPersistTaps="handled"
            style={{ flex: 1 }}
            contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24, paddingTop: 8 }}
            ListHeaderComponent={
              <Text style={[ss.sectionLabel, { color: t.textDim }]}>
                {searchMode === 'friends' ? 'TWOI ZNAJOMI' : 'UŻYTKOWNICY W POBLIŻU'}
              </Text>
            }
            ListEmptyComponent={
              <View style={ss.emptyBox}>
                <MaterialIcons name="person-off" size={44} color={t.textFaint} />
                <Text style={[ss.emptyTitle, { color: t.textDim }]}>BRAK WYNIKÓW</Text>
                <Text style={[ss.emptySub, { color: t.textFaint }]}>
                  {searchMode === 'friends'
                    ? 'Brak aktywnych znajomych'
                    : 'Brak użytkowników w zasięgu 25 km'}
                </Text>
              </View>
            }
            renderItem={({ item }) => (
              <TouchableOpacity
                style={[ss.row, { borderBottomColor: t.border }]}
                onPress={() => handleSelectUser(item)}
                activeOpacity={0.7}
              >
                <View style={[ss.avatarBox, { backgroundColor: t.surface2, borderColor: t.border2 }]}>
                  <Text style={{ fontSize: 18 }}>{item.avatar || '👤'}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[ss.rowTitle, { color: t.text }]}>{item.name}</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 }}>
                    <View style={[ss.dot, {
                      backgroundColor: item.status === 'Online' ? t.online : t.textFaint,
                    }]} />
                    <Text style={[ss.rowSub, { color: t.textDim }]}>
                      {item.status?.toUpperCase()} · {item.distance?.toFixed(1)} km
                    </Text>
                  </View>
                </View>
                <View style={[ss.arrowBox, { backgroundColor: t.surface3 }]}>
                  <MaterialIcons name="arrow-forward-ios" size={11} color={t.textMuted} />
                </View>
              </TouchableOpacity>
            )}
          />
        )}

        {/* ══════════════════════════════════════════════ */}
        {/* AUTOCOMPLETE RESULTS                           */}
        {/* ══════════════════════════════════════════════ */}
        {showResults && (
          isSearching && filteredPlaces.length === 0
            ? (
              <View style={ss.emptyBox}>
                <ActivityIndicator size="large" color={t.primary} />
                <Text style={[ss.emptyTitle, { color: t.textDim, marginTop: 10 }]}>SZUKAM...</Text>
              </View>
            )
            : (
              <FlatList
                data={filteredPlaces.map((p, i) => ({ ...p, _k: `${i}` }))}
                keyExtractor={item => item._k}
                keyboardShouldPersistTaps="handled"
                style={{ flex: 1 }}
                contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24, paddingTop: 8 }}
                ListHeaderComponent={
                  filteredPlaces.length > 0
                    ? <Text style={[ss.sectionLabel, { color: t.textDim }]}>
                        {filteredPlaces.length} WYNIKÓW
                      </Text>
                    : null
                }
                ListEmptyComponent={
                  <View style={ss.emptyBox}>
                    <MaterialIcons name="search-off" size={44} color={t.textFaint} />
                    <Text style={[ss.emptyTitle, { color: t.textDim }]}>BRAK WYNIKÓW</Text>
                    <Text style={[ss.emptySub, { color: t.textFaint }]}>
                      Sprawdź pisownię lub wpisz inną nazwę
                    </Text>
                  </View>
                }
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={[ss.row, { borderBottomColor: t.border }]}
                    onPress={() => handleSelectAutocomplete(
                      item.place_id,
                      item.structured_formatting.main_text,
                    )}
                    activeOpacity={0.7}
                  >
                    <View style={[ss.placeBox, { backgroundColor: t.primaryBg, borderColor: t.primaryBorder }]}>
                      <MaterialIcons name="location-on" size={18} color={t.primary} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[ss.rowTitle, { color: t.text }]} numberOfLines={1}>
                        {item.structured_formatting.main_text}
                      </Text>
                      {item.structured_formatting.secondary_text ? (
                        <Text style={[ss.rowSub, { color: t.textDim }]} numberOfLines={1}>
                          {item.structured_formatting.secondary_text}
                        </Text>
                      ) : null}
                    </View>
                    <View style={[ss.arrowBox, { backgroundColor: t.surface3 }]}>
                      <MaterialIcons name="arrow-forward-ios" size={11} color={t.textMuted} />
                    </View>
                  </TouchableOpacity>
                )}
              />
            )
        )}

      </SafeAreaView>
    </Modal>
  );
});

// ── Statyczne style ───────────────────────────────────────
const ss = StyleSheet.create({
  root:   { flex: 1 },
  header: {
    flexDirection:     'row',
    alignItems:        'center',
    paddingHorizontal: 16,
    paddingTop:        Platform.OS === 'android' ? (StatusBar.currentHeight ?? 0) + 8 : 8,
    paddingBottom:     10,
    borderBottomWidth: 1,
  },
  iconBtn: {
    width: 36, height: 36, borderRadius: 11,
    borderWidth: 1, alignItems: 'center', justifyContent: 'center',
  },
  tabsRow: {
    flexDirection: 'row', borderRadius: 12, borderWidth: 1,
    overflow: 'hidden', padding: 3, gap: 3,
  },
  tab: {
    flex: 1, flexDirection: 'row', alignItems: 'center',
    justifyContent: 'center', gap: 5, paddingVertical: 7,
    borderRadius: 9, overflow: 'hidden',
  },
  tabLine: { position: 'absolute', bottom: 0, left: '15%', right: '15%', height: 2, borderRadius: 1 },
  tabText: { fontFamily: 'Orbitron', fontSize: 8, fontWeight: '700', letterSpacing: 1 },
  inputWrap: {
    flexDirection: 'row', alignItems: 'center',
    marginHorizontal: 16, marginVertical: 12,
    paddingHorizontal: 14,
    paddingVertical: Platform.OS === 'ios' ? 13 : 10,
    borderRadius: 14, borderWidth: 1, gap: 10,
  },
  input:    { flex: 1, fontFamily: 'Orbitron', fontSize: 12, letterSpacing: 0.3 },
  clearBtn: { width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  divider:  { height: 1 },
  sectionLabel: { fontFamily: 'Orbitron', fontSize: 8, letterSpacing: 3, marginBottom: 12 },
  myLocCard:  { borderRadius: 16, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 12, overflow: 'hidden' },
  myLocIcon:  { width: 44, height: 44, borderRadius: 13, backgroundColor: '#ffffff20', alignItems: 'center', justifyContent: 'center' },
  myLocTitle: { fontFamily: 'Orbitron', fontSize: 14, color: '#fff', fontWeight: '900' },
  myLocSub:   { fontFamily: 'Orbitron', fontSize: 8, color: '#ffffff70', marginTop: 3 },
  myLocArrow: { width: 30, height: 30, borderRadius: 9, backgroundColor: '#ffffff20', alignItems: 'center', justifyContent: 'center' },
  nearbyGrid:  { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 6 },
  nearbyCard:  { width: '22.5%', aspectRatio: 1, borderRadius: 14, borderWidth: 1, alignItems: 'center', justifyContent: 'center', gap: 5, overflow: 'hidden' },
  nearbyEmoji: { fontSize: 24 },
  nearbyLabel: { fontFamily: 'Orbitron', fontSize: 6, fontWeight: '700', letterSpacing: 0.5, textAlign: 'center' },
  brandBanner:     { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 16, marginTop: 8, marginBottom: 2, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderWidth: 1 },
  brandBannerText: { fontFamily: 'Orbitron', fontSize: 9, fontWeight: '700', letterSpacing: 0.5, flex: 1 },
  chipsScroll: { borderBottomWidth: 1, flexGrow: 0 },
  chip:        { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, borderWidth: 1 },
  chipText:    { fontFamily: 'Orbitron', fontSize: 8, fontWeight: '700', letterSpacing: 1 },
  catCard:     { borderRadius: 14, borderWidth: 1, padding: 14, alignItems: 'center', gap: 6, overflow: 'hidden' },
  catIcon:     { width: 42, height: 42, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  catLabel:    { fontFamily: 'Orbitron', fontSize: 9, fontWeight: '700', letterSpacing: 1 },
  catSub:      { fontFamily: 'Orbitron', fontSize: 7 },
  catBadge:    { borderRadius: 9, paddingHorizontal: 10, paddingVertical: 3, borderWidth: 1, marginTop: 2 },
  catBadgeNum: { fontFamily: 'Orbitron', fontSize: 13, fontWeight: '900' },
  hintRow:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  hintText: { fontFamily: 'Orbitron', fontSize: 8, letterSpacing: 1 },
  row:       { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: 1 },
  avatarBox: { width: 42, height: 42, borderRadius: 21, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  placeBox:  { width: 42, height: 42, borderRadius: 13, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  rowTitle:  { fontFamily: 'Orbitron', fontSize: 11, fontWeight: '700' },
  rowSub:    { fontFamily: 'Orbitron', fontSize: 8, letterSpacing: 0.3 },
  rowMeta:   { fontFamily: 'Orbitron', fontSize: 8 },
  arrowBox:  { width: 26, height: 26, borderRadius: 7, alignItems: 'center', justifyContent: 'center' },
  dot:       { width: 5, height: 5, borderRadius: 2.5 },
  openBadge: { borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, borderWidth: 1 },
  openText:  { fontFamily: 'Orbitron', fontSize: 7, fontWeight: '700', letterSpacing: 0.5 },
  emptyBox:   { alignItems: 'center', paddingVertical: 48, gap: 8 },
  emptyTitle: { fontFamily: 'Orbitron', fontSize: 10, letterSpacing: 3 },
  emptySub:   { fontFamily: 'Orbitron', fontSize: 8, letterSpacing: 0.5, textAlign: 'center', paddingHorizontal: 30, lineHeight: 14 },
});