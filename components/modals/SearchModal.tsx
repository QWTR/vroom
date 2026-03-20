import React, { useState, useCallback, memo } from 'react';
import {
  Modal, SafeAreaView, View, Text, TouchableOpacity,
  TextInput, FlatList, ActivityIndicator,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import debounce from 'lodash.debounce';
import Toast from 'react-native-toast-message';
import { User, LocationState } from '../../constants/types';
import { calculateDistance } from '../../scripts/distance';
import { GOOGLE_MAPS_APIKEY, MAX_NEARBY_USERS_DISTANCE } from '../../constants/mapConfig';
import { styles } from '../../styles/mapstyle';

interface SearchModalProps {
  visible: boolean;
  onClose: () => void;
  onSelectStart: (location: LocationState) => void;
  onSelectEnd: (location: LocationState) => void;
  userLocation: LocationState | null;
  nearbyUsers: User[];
}

export const SearchModal = memo(({
  visible, onClose, onSelectStart, onSelectEnd, userLocation, nearbyUsers,
}: SearchModalProps) => {
  const [activeTab,      setActiveTab]      = useState<'start' | 'end'>('start');
  const [searchQuery,    setSearchQuery]    = useState('');
  const [filteredPlaces, setFilteredPlaces] = useState<any[]>([]);
  const [filteredUsers,  setFilteredUsers]  = useState<User[]>([]);
  const [isSearching,    setIsSearching]    = useState(false);
  const [searchMode,     setSearchMode]     = useState<'initial' | 'users' | 'friends' | 'results'>('initial');

  const resetToInitial = () => {
    setSearchMode('initial');
    setSearchQuery('');
    setFilteredUsers([]);
    setFilteredPlaces([]);
  };

  const handleSelectCategory = useCallback(
    (category: 'users' | 'friends') => {
      setSearchMode(category);
      setSearchQuery('');
      setFilteredPlaces([]);

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
        .map(user => ({
          ...user,
          distance: userLocation
            ? calculateDistance(
                userLocation.latitude, userLocation.longitude,
                user.latitude, user.longitude,
              )
            : 0,
        }))
        .sort((a, b) => (a.distance || 0) - (b.distance || 0));

      setFilteredUsers(mapped);
    },
    [nearbyUsers, userLocation],
  );

  const handleSearch = useCallback(
    debounce(async (query: string) => {
      if (query.length < 2) { setSearchMode('initial'); setFilteredPlaces([]); setFilteredUsers([]); return; }
      setSearchMode('results');
      setIsSearching(true);
      setFilteredUsers([]);
      try {
        const res = await fetch(
          `https://maps.googleapis.com/maps/api/place/autocomplete/json?` +
          `input=${encodeURIComponent(query)}&key=${GOOGLE_MAPS_APIKEY}&language=pl&` +
          `location=${userLocation?.latitude || 52.2297},${userLocation?.longitude || 21.0122}&radius=50000`
        );
        const data = await res.json();
        setFilteredPlaces(data.predictions || []);
      } catch {
        Toast.show({ type: 'error', text1: 'BŁĄD WYSZUKIWANIA' });
      } finally {
        setIsSearching(false);
      }
    }, 600),
    [userLocation],
  );

  const selectLocation = useCallback(
    (location: LocationState, label: string) => {
      if (activeTab === 'start') {
        onSelectStart(location);
        Toast.show({ type: 'success', text1: 'POCZĄTEK USTAWIONY', text2: label });
        setActiveTab('end');
        resetToInitial();
      } else {
        // ← KOLEJNOŚĆ: najpierw ustaw cel, POTEM zamknij
        onSelectEnd(location);
        Toast.show({ type: 'success', text1: 'CEL USTAWIONY', text2: label });
        onClose(); // zamknij po ustawieniu
      }
    },
    [activeTab, onSelectStart, onSelectEnd, onClose],
  );

  const handleSelectPlace = useCallback(
    async (placeId: string, name: string) => {
      setIsSearching(true);
      try {
        const res = await fetch(
          `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&key=${GOOGLE_MAPS_APIKEY}`
        );
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
    },
    [selectLocation],
  );

  const handleSelectUser     = useCallback((user: User) => {
    selectLocation({ latitude: user.latitude, longitude: user.longitude, name: user.name }, user.name);
  }, [selectLocation]);

  const handleSelectCurrent  = useCallback(() => {
    if (userLocation) selectLocation({ ...userLocation, name: 'Moja pozycja' }, 'Moja pozycja');
  }, [userLocation, selectLocation]);

  const friendCount    = nearbyUsers.filter(u => u.isFriend).length;
  const otherUserCount = nearbyUsers.filter(
    u => !u.isFriend && userLocation &&
      calculateDistance(userLocation.latitude, userLocation.longitude, u.latitude, u.longitude) <= MAX_NEARBY_USERS_DISTANCE,
  ).length;

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <SafeAreaView style={styles.searchModalOverlay}>
        <TouchableOpacity style={styles.searchModalBackdrop} activeOpacity={1} onPress={onClose} />

        <View style={styles.searchModalContainer}>

          {/* ── HEADER ── */}
          <View style={styles.searchModalHeader}>
            <TouchableOpacity
              style={styles.searchModalBackBtn}
              onPress={searchMode === 'initial' ? onClose : resetToInitial}
            >
              <MaterialIcons name="arrow-back" size={20} color="#ffffff70" />
            </TouchableOpacity>

            <View style={{ flex: 1 }}>
              <Text style={styles.searchModalTitle}>
                {activeTab === 'start' ? 'Skąd jedziesz?' : 'Dokąd jedziesz?'}
              </Text>
            </View>
          </View>

          {/* ── TABS ── */}
          <View style={styles.searchModalTabs}>
            {(['start', 'end'] as const).map(tab => (
              <TouchableOpacity
                key={tab}
                style={[styles.searchModalTab, activeTab === tab && styles.searchModalTabActive]}
                onPress={() => { setActiveTab(tab); resetToInitial(); }}
              >
                <MaterialIcons
                  name={tab === 'start' ? 'radio-button-on' : 'flag'}
                  size={15}
                  color={activeTab === tab ? '#e33835ce' : '#ffffff35'}
                />
                <Text style={[
                  styles.searchModalTabText,
                  activeTab === tab && styles.searchModalTabTextActive,
                ]}>
                  {tab === 'start' ? 'POCZĄTEK' : 'CEL'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <View style={styles.searchModalDivider} />

          {/* ── INPUT ── */}
          <View style={styles.searchModalInputContainer}>
            <MaterialIcons name="search" size={18} color="#e33835ce" />
            <TextInput
              style={styles.searchModalInput}
              placeholder="Wpisz adres lub miejsce..."
              placeholderTextColor="#ffffff35"
              value={searchQuery}
              onChangeText={text => { setSearchQuery(text); handleSearch(text); }}
              onFocus={() => { setSearchMode('initial'); setFilteredPlaces([]); }}
              autoCorrect={false}
              autoCapitalize="none"
              blurOnSubmit={false}
            />
            {isSearching
              ? <ActivityIndicator size="small" color="#e33835ce" />
              : searchQuery.length > 0 && (
                <TouchableOpacity onPress={() => { setSearchQuery(''); resetToInitial(); }}>
                  <MaterialIcons name="close" size={18} color="#ffffff35" />
                </TouchableOpacity>
              )
            }
          </View>

          {/* ── INITIAL STATE — kategorie ── */}
          {searchMode === 'initial' && searchQuery.length === 0 && (
            <>
              <Text style={styles.searchHelperText}>WYBIERZ KATEGORIĘ LUB WPISZ ADRES</Text>
              <View style={styles.categoriesGrid}>

                {/* Aktualna pozycja */}
                <TouchableOpacity style={styles.categoryCard} onPress={handleSelectCurrent} activeOpacity={0.75}>
                  <View style={[styles.categoryIconContainer, { backgroundColor: '#e3383518', borderColor: '#e3383535' }]}>
                    <MaterialIcons name="my-location" size={26} color="#e33835ce" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.categoryTitle}>Aktualna pozycja</Text>
                    <Text style={styles.categorySubtitle}>Ustaw jako punkt trasy</Text>
                  </View>
                  <MaterialIcons name="arrow-forward-ios" size={13} color="#ffffff35" />
                </TouchableOpacity>

                {/* Użytkownicy */}
                <TouchableOpacity style={styles.categoryCard} onPress={() => handleSelectCategory('users')} activeOpacity={0.75}>
                  <View style={[styles.categoryIconContainer, { backgroundColor: '#00bfff18', borderColor: '#00bfff35' }]}>
                    <MaterialIcons name="people" size={26} color="#00bfff" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.categoryTitle}>Użytkownicy</Text>
                    <Text style={styles.categorySubtitle}>{otherUserCount} w zasięgu 25 km</Text>
                  </View>
                  <MaterialIcons name="arrow-forward-ios" size={13} color="#ffffff35" />
                </TouchableOpacity>

                {/* Znajomi */}
                <TouchableOpacity style={styles.categoryCard} onPress={() => handleSelectCategory('friends')} activeOpacity={0.75}>
                  <View style={[styles.categoryIconContainer, { backgroundColor: '#4de92618', borderColor: '#4de92635' }]}>
                    <MaterialIcons name="favorite" size={26} color="#4de926" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.categoryTitle}>Znajomi</Text>
                    <Text style={styles.categorySubtitle}>{friendCount} dostępnych</Text>
                  </View>
                  <MaterialIcons name="arrow-forward-ios" size={13} color="#ffffff35" />
                </TouchableOpacity>

              </View>
            </>
          )}

          {/* ── LISTA UŻYTKOWNIKÓW / ZNAJOMYCH ── */}
          {(searchMode === 'users' || searchMode === 'friends') && (
            <FlatList
              data={filteredUsers}
              keyExtractor={item => item.id}
              scrollEnabled
              bounces={false}
              style={styles.searchResultsList}
              ListEmptyComponent={
                <View style={styles.emptyList}>
                  <MaterialIcons name="person-off" size={28} color="#ffffff35" />
                  <Text style={styles.emptyListText}>BRAK WYNIKÓW</Text>
                </View>
              }
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.searchResultItem}
                  onPress={() => handleSelectUser(item)}
                  activeOpacity={0.65}
                >
                  <View style={styles.searchResultIconUser}>
                    <Text style={styles.searchResultUserAvatar}>{item.avatar || '👤'}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.searchResultItemText}>{item.name}</Text>
                    <View style={styles.searchResultMeta}>
                      <View style={[
                        styles.userStatusDot,
                        { backgroundColor: item.status === 'Online' ? '#4de926' : '#ffffff35' },
                      ]} />
                      <Text style={styles.searchResultMetaText}>
                        {item.status?.toUpperCase()} · {item.distance?.toFixed(1)} km
                      </Text>
                    </View>
                  </View>
                  <MaterialIcons name="arrow-forward-ios" size={14} color="#ffffff35" />
                </TouchableOpacity>
              )}
            />
          )}

          {/* ── LISTA MIEJSC ── */}
          {searchMode === 'results' && (
            <FlatList
              data={filteredPlaces.map((p, idx) => ({ ...p, uniqueId: `place_${idx}` }))}
              keyExtractor={item => item.uniqueId}
              scrollEnabled
              bounces={false}
              style={styles.searchResultsList}
              ListEmptyComponent={
                <View style={styles.emptyList}>
                  <MaterialIcons name="search-off" size={28} color="#ffffff35" />
                  <Text style={styles.emptyListText}>BRAK WYNIKÓW</Text>
                </View>
              }
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.searchResultItem}
                  onPress={() => handleSelectPlace(item.place_id, item.structured_formatting.main_text)}
                  activeOpacity={0.65}
                >
                  <View style={styles.searchResultIconPlace}>
                    <MaterialIcons name="location-on" size={20} color="#e33835ce" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.searchResultItemText} numberOfLines={1}>
                      {item.structured_formatting.main_text}
                    </Text>
                    {item.structured_formatting.secondary_text && (
                      <Text style={styles.searchResultMetaText} numberOfLines={1}>
                        {item.structured_formatting.secondary_text}
                      </Text>
                    )}
                  </View>
                  <MaterialIcons name="arrow-forward-ios" size={14} color="#ffffff35" />
                </TouchableOpacity>
              )}
            />
          )}

        </View>
      </SafeAreaView>
    </Modal>
  );
});