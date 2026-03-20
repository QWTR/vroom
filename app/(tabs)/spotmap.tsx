import React, { useRef, useState, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  ActivityIndicator, ScrollView,
} from 'react-native';
import MapView, { PROVIDER_GOOGLE, Marker } from 'react-native-maps';
import { MaterialIcons } from '@expo/vector-icons';
import Toast from 'react-native-toast-message';

import { customMapStyle } from '../../constants/mapConfig';
import { Spot, CATEGORY_COLORS, CATEGORY_ICONS, CATEGORIES, OFFROAD_CATEGORIES } from '../../constants/spotTypes';
import { useSpots } from '../../hooks/useSpots';

import { AddSpotModal }    from '../../components/spots/AddSpotModal';
import { SpotListModal }   from '../../components/spots/SpotListModal';
import { SpotDetailModal } from '../../components/spots/SpotDetailModal';
import { DistanceModal }   from '../../components/spots/DistanceModal';

type PickingState = 'idle' | 'picking';

export default function SpotMap() {
  const mapRef = useRef<MapView>(null);

  const {
    region, visibleSpots, maxDistance, setMaxDistance,
    addSpot, getDistance, loading, refetch,
    activeCategories, toggleCategory, clearCategories,
    sortMode, setSortMode,
  } = useSpots();

  const [addVisible,      setAddVisible]      = useState(false);
  const [listVisible,     setListVisible]      = useState(false);
  const [detailVisible,   setDetailVisible]    = useState(false);
  const [distanceVisible, setDistanceVisible]  = useState(false);
  const [selectedSpot,    setSelectedSpot]     = useState<Spot | null>(null);
  const [picking,         setPicking]          = useState<PickingState>('idle');
  const [pickedCoord,     setPickedCoord]      = useState<{ latitude: number; longitude: number } | null>(null);

  const handleStartPicking = useCallback(() => setPicking('picking'), []);

  const handleMapPress = useCallback((e: any) => {
    if (picking !== 'picking') return;
    setPickedCoord(e.nativeEvent.coordinate);
    setPicking('idle');
    setAddVisible(true);
  }, [picking]);

  const handleAddSuccess = useCallback(() => {
    setAddVisible(false);
    setPickedCoord(null);
  }, []);

  const handleAddCancel = useCallback(() => {
    setAddVisible(false);
    setPickedCoord(null);
  }, []);

  const handleSelectSpot = useCallback((spot: Spot) => {
    setSelectedSpot(spot);
    setDetailVisible(true);
  }, []);

  const handleRefresh = useCallback(() => {
    refetch();
    Toast.show({ type: 'success', text1: '🔄 Odświeżanie...', text2: 'Pobieranie spotów z serwera' });
  }, [refetch]);

  const handleLikeToggle = useCallback((spotId: string, liked: boolean, count: number) => {
    if (selectedSpot?.id === spotId) {
      setSelectedSpot(prev => prev ? { ...prev, isLiked: liked, likesCount: count } : prev);
    }
  }, [selectedSpot]);

  if (!region) {
    return (
      <View style={s.loader}>
        <View style={s.loaderCard}>
          <ActivityIndicator size="large" color="#e33835" />
          <Text style={s.loaderTitle}>Ładowanie mapy</Text>
          <Text style={s.loaderSub}>Pobieranie spotów z serwera...</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>

      {/* MAPA */}
      <MapView
        ref={mapRef}
        provider={PROVIDER_GOOGLE}
        style={StyleSheet.absoluteFillObject}
        customMapStyle={customMapStyle}
        initialRegion={region}
        showsUserLocation
        showsMyLocationButton={false}
        showsCompass={false}
        toolbarEnabled={false}
        onPress={handleMapPress}
      >
        {visibleSpots.map(spot => (
          <Marker
            key={spot.id}
            coordinate={{ latitude: spot.latitude, longitude: spot.longitude }}
            pinColor={CATEGORY_COLORS[spot.category]}
            tracksViewChanges={false}
            onPress={() => handleSelectSpot(spot)}
          />
        ))}
        {pickedCoord && (
          <Marker
            coordinate={pickedCoord}
            pinColor="#e33835"
            tracksViewChanges={false}
          />
        )}
      </MapView>

      {/* GÓRNY PASEK */}
      {picking === 'idle' && (
        <>
          <View style={s.topBar}>

            {/* Dystans */}
            <TouchableOpacity
              style={s.distanceBtn}
              onPress={() => setDistanceVisible(true)}
              activeOpacity={0.8}
            >
              <View style={s.distanceIconWrap}>
                <MaterialIcons name="radar" size={14} color="#e33835" />
              </View>
              <Text style={s.distanceBtnText}>{maxDistance} km</Text>
              <MaterialIcons name="keyboard-arrow-down" size={16} color="#ffffff40" />
            </TouchableOpacity>

            {/* Lista */}
            <TouchableOpacity
              style={s.listBtn}
              onPress={() => setListVisible(true)}
              activeOpacity={0.8}
            >
              <MaterialIcons name="format-list-bulleted" size={16} color="#e33835" />
              <Text style={s.listBtnText}>Spoty</Text>
              {visibleSpots.length > 0 && (
                <View style={s.badge}>
                  <Text style={s.badgeText}>{visibleSpots.length}</Text>
                </View>
              )}
            </TouchableOpacity>

            {/* Refresh */}
            <TouchableOpacity
              style={s.refreshBtn}
              onPress={handleRefresh}
              activeOpacity={0.8}
              disabled={loading}
            >
              {loading
                ? <ActivityIndicator size={16} color="#e33835" />
                : <MaterialIcons name="refresh" size={20} color="#ffffff80" />
              }
            </TouchableOpacity>

          </View>

          {/* PASEK FILTRÓW KATEGORII */}
          <View style={s.filterBarWrap}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={s.filterBar}
            >
              {/* Przycisk "Wszystkie" */}
              <TouchableOpacity
                style={[s.filterChip, activeCategories.length === 0 && s.filterChipAll]}
                onPress={clearCategories}
                activeOpacity={0.8}
              >
                <MaterialIcons
                  name="layers"
                  size={13}
                  color={activeCategories.length === 0 ? '#fff' : '#ffffff50'}
                />
                <Text style={[s.filterChipText, activeCategories.length === 0 && s.filterChipTextAll]}>
                  Wszystkie
                </Text>
              </TouchableOpacity>

              {/* Separator — OFFROAD */}
              <View style={s.filterSep}>
                <Text style={s.filterSepText}>OFFROAD</Text>
              </View>

              {/* Kategorie offroad */}
              {OFFROAD_CATEGORIES.map(cat => {
                const active = activeCategories.includes(cat);
                return (
                  <TouchableOpacity
                    key={cat}
                    style={[
                      s.filterChip,
                      active && { borderColor: CATEGORY_COLORS[cat], backgroundColor: CATEGORY_COLORS[cat] + '22' },
                    ]}
                    onPress={() => toggleCategory(cat)}
                    activeOpacity={0.8}
                  >
                    <MaterialIcons
                      name={CATEGORY_ICONS[cat] as any}
                      size={13}
                      color={active ? CATEGORY_COLORS[cat] : '#ffffff50'}
                    />
                    <Text style={[s.filterChipText, active && { color: CATEGORY_COLORS[cat] }]}>
                      {cat}
                    </Text>
                  </TouchableOpacity>
                );
              })}

              {/* Separator — POZOSTAŁE */}
              <View style={s.filterSep}>
                <Text style={s.filterSepText}>INNE</Text>
              </View>

              {/* Pozostałe kategorie */}
              {CATEGORIES.filter(c => !OFFROAD_CATEGORIES.includes(c)).map(cat => {
                const active = activeCategories.includes(cat);
                return (
                  <TouchableOpacity
                    key={cat}
                    style={[
                      s.filterChip,
                      active && { borderColor: CATEGORY_COLORS[cat], backgroundColor: CATEGORY_COLORS[cat] + '22' },
                    ]}
                    onPress={() => toggleCategory(cat)}
                    activeOpacity={0.8}
                  >
                    <MaterialIcons
                      name={CATEGORY_ICONS[cat] as any}
                      size={13}
                      color={active ? CATEGORY_COLORS[cat] : '#ffffff50'}
                    />
                    <Text style={[s.filterChipText, active && { color: CATEGORY_COLORS[cat] }]}>
      {cat}
                    </Text>
                  </TouchableOpacity>
                );
              })}

            </ScrollView>
          </View>
        </>
      )}

      {/* BANNER — picking */}
      {picking === 'picking' && (
        <View style={s.pickingBanner}>
          <View style={s.pickingIconWrap}>
            <MaterialIcons name="touch-app" size={18} color="#e33835" />
          </View>
          <Text style={s.pickingText}>Dotknij mapę aby ustawić lokalizację</Text>
          <TouchableOpacity onPress={() => setPicking('idle')} style={s.pickingCancel} activeOpacity={0.7}>
            <MaterialIcons name="close" size={18} color="#ffffff60" />
          </TouchableOpacity>
        </View>
      )}

      {/* PRZYCISK DODAJ */}
      {picking === 'idle' && (
        <TouchableOpacity
          style={s.addBtn}
          onPress={handleStartPicking}
          activeOpacity={0.85}
        >
          <View style={s.addBtnIcon}>
            <MaterialIcons name="add-location-alt" size={20} color="#fff" />
          </View>
          <Text style={s.addBtnText}>Dodaj spot</Text>
        </TouchableOpacity>
      )}

      {/* MODALE */}
      <AddSpotModal
        visible={addVisible}
        onClose={handleAddCancel}
        onAdd={(name, desc, cat, photos) => addSpot(name, desc, cat, photos, pickedCoord)}
      />
      <SpotListModal
        visible={listVisible}
        onClose={() => setListVisible(false)}
        spots={visibleSpots}
        maxDistance={maxDistance}
        onSelectSpot={handleSelectSpot}
        getDistance={getDistance}
        sortMode={sortMode}
        onSortChange={setSortMode}
      />
      <SpotDetailModal
        visible={detailVisible}
        spot={selectedSpot}
        onClose={() => setDetailVisible(false)}
        getDistance={getDistance}
        onLikeToggle={handleLikeToggle}
      />
      <DistanceModal
        visible={distanceVisible}
        maxDistance={maxDistance}
        onSelect={setMaxDistance}
        onClose={() => setDistanceVisible(false)}
      />

    </View>
  );
}

const s = StyleSheet.create({
  // Loader
  loader:            { flex: 1, backgroundColor: '#0f0f0f', justifyContent: 'center', alignItems: 'center' },
  loaderCard:        { alignItems: 'center', gap: 12, backgroundColor: '#1a1a1a', borderRadius: 20, padding: 32, borderWidth: 1, borderColor: '#ffffff08' },
  loaderTitle:       { color: '#fff', fontSize: 15, fontWeight: '700', marginTop: 4 },
  loaderSub:         { color: '#ffffff40', fontSize: 12 },

  // Top bar
  topBar:            { position: 'absolute', top: 52, left: 16, right: 16, flexDirection: 'row', gap: 8 },

  distanceBtn:       { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#161616f0', borderRadius: 14, paddingHorizontal: 10, paddingVertical: 10, borderWidth: 1, borderColor: '#ffffff12' },
  distanceIconWrap:  { width: 22, height: 22, borderRadius: 6, backgroundColor: '#e3383518', justifyContent: 'center', alignItems: 'center' },
  distanceBtnText:   { color: '#fff', fontSize: 13, fontWeight: '700' },

  listBtn:           { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, backgroundColor: '#161616f0', borderRadius: 14, paddingVertical: 10, borderWidth: 1, borderColor: '#ffffff12' },
  listBtnText:       { color: '#fff', fontSize: 13, fontWeight: '600' },
  badge:             { backgroundColor: '#e33835', borderRadius: 8, paddingHorizontal: 6, paddingVertical: 1 },
  badgeText:         { color: '#fff', fontSize: 10, fontWeight: '700' },

  refreshBtn:        { width: 44, height: 44, backgroundColor: '#161616f0', borderRadius: 14, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: '#ffffff12' },

  // Filter bar
  filterBarWrap:     { position: 'absolute', top: 108, left: 0, right: 0 },
  filterBar:         { paddingHorizontal: 16, gap: 8, alignItems: 'center' },
  filterChip:        { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 11, paddingVertical: 7, borderRadius: 10, backgroundColor: '#161616f0', borderWidth: 1, borderColor: '#ffffff12' },
  filterChipAll:     { borderColor: '#e33835', backgroundColor: '#e3383525' },
  filterChipText:    { color: '#ffffff50', fontSize: 11, fontWeight: '600' },
  filterChipTextAll: { color: '#fff' },

  filterSep:         { justifyContent: 'center', paddingHorizontal: 4 },
  filterSepText:     { color: '#ffffff20', fontSize: 9, fontWeight: '700', letterSpacing: 1 },

  // Picking banner
  pickingBanner:     { position: 'absolute', top: 52, left: 16, right: 16, flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#161616f0', borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, borderWidth: 1, borderColor: '#e3383530' },
  pickingIconWrap:   { width: 30, height: 30, borderRadius: 8, backgroundColor: '#e3383520', justifyContent: 'center', alignItems: 'center' },
  pickingText:       { flex: 1, color: '#fff', fontSize: 13, fontWeight: '600' },
  pickingCancel:     { width: 30, height: 30, borderRadius: 8, backgroundColor: '#ffffff08', justifyContent: 'center', alignItems: 'center' },

  // Add button
  addBtn:            { position: 'absolute', bottom: 40, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#e33835', borderRadius: 18, paddingHorizontal: 24, paddingVertical: 14, elevation: 12, shadowColor: '#e33835', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 12 },
  addBtnIcon:        { width: 28, height: 28, borderRadius: 8, backgroundColor: '#ffffff20', justifyContent: 'center', alignItems: 'center' },
  addBtnText:        { color: '#fff', fontSize: 15, fontWeight: '700', letterSpacing: 0.3 },
});