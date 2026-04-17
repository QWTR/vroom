import React, { useRef, useState, useCallback, useMemo } from 'react';
import {
  View, Text, TouchableOpacity,
  ActivityIndicator, ScrollView,
} from 'react-native';
import Mapbox from '@rnmapbox/maps';
import { MAPBOX_STYLE_DARK, MAPBOX_STYLE_LIGHT, MAPBOX_STYLE_SATELLITE, MAPBOX_TOKEN } from '../../constants/mapConfig';
Mapbox.setAccessToken(MAPBOX_TOKEN);
import { makeMapStyles } from '../../styles/mapstyle';
import { MaterialIcons } from '@expo/vector-icons';
import Toast from 'react-native-toast-message';
import { Spot, CATEGORY_COLORS, CATEGORY_ICONS, CATEGORIES, OFFROAD_CATEGORIES } from '../../constants/spotTypes';
import { useSpots }  from '../../hooks/useSpots';
import { useTheme }  from '../../contexts/ThemeContext';

import { AddSpotModal }    from '../../components/spots/AddSpotModal';
import { SpotListModal }   from '../../components/spots/SpotListModal';
import { SpotDetailModal } from '../../components/spots/SpotDetailModal';
import { DistanceModal }   from '../../components/spots/DistanceModal';
import { SpotPinRenderer } from '../../components/markers/SpotPinRenderer';

type PickingState = 'idle' | 'picking';

// Próg zoomu — poniżej: dot, powyżej: full pin z nazwą
const LABEL_ZOOM_THRESHOLD = 13;

export default function SpotMap() {
  const mapRef = useRef<Mapbox.MapView>(null);
  const { theme, isDark } = useTheme();
  const styles         = makeMapStyles(theme, isDark);
  const mapStyle       = isDark ? MAPBOX_STYLE_DARK : MAPBOX_STYLE_LIGHT;

  const {
    region, visibleSpots, maxDistance, setMaxDistance,
    addSpot, getDistance, loading, refetch,
    activeCategories, toggleCategory, clearCategories,
    sortMode, setSortMode,
    userLocation,
  } = useSpots();

  const [addVisible,      setAddVisible]      = useState(false);
  const [listVisible,     setListVisible]     = useState(false);
  const [detailVisible,   setDetailVisible]   = useState(false);
  const [distanceVisible, setDistanceVisible] = useState(false);
  const [selectedSpot,    setSelectedSpot]    = useState<Spot | null>(null);
  const [picking,         setPicking]         = useState<PickingState>('idle');
  const [pickedCoord,     setPickedCoord]     = useState<{ latitude: number; longitude: number } | null>(null);
  const [isSatellite,     setIsSatellite]     = useState(false);
  const [currentZoom,     setCurrentZoom]     = useState(12);

  // Słownik: spotId → uri obrazka pinu
  const [pinImages, setPinImages] = useState<Record<string, string>>({});
  // Słownik: spotId → typ pinu jaki już wyrenderowano
  const [renderedZoom, setRenderedZoom] = useState<Record<string, 'dot' | 'full'>>({});

  const showLabels  = currentZoom >= LABEL_ZOOM_THRESHOLD;
  const panelBg     = theme.surface + 'f0';
  const panelBorder = theme.border2;

  // ── Wyczyść obrazki spotów których już nie widać ─────────
  const visibleIds = useMemo(() => new Set(visibleSpots.map(s => s.id)), [visibleSpots]);
  // (można dodać useEffect czyszczący pinImages gdy zmienia się visibleIds)

  const handleRegionChange = useCallback((e: any) => {
    const zoom = e.properties?.zoomLevel ?? 12;
    setCurrentZoom(zoom);
  }, []);

  const toggleMapType = useCallback(() => {
    setIsSatellite(prev => !prev);
  }, []);

  const handleLocateMe = useCallback(() => {
    if (!userLocation) return;
    (mapRef.current as any)?.setCamera({
      centerCoordinate: [userLocation.longitude, userLocation.latitude],
      zoomLevel: 14,
      animationDuration: 600,
    });
  }, [userLocation]);

  const handleStartPicking = useCallback(() => setPicking('picking'), []);
  const handleAddCancel    = useCallback(() => { setAddVisible(false); setPickedCoord(null); }, []);
  const handleSelectSpot   = useCallback((spot: Spot) => { setSelectedSpot(spot); setDetailVisible(true); }, []);

  const handleRefresh = useCallback(() => {
    refetch();
    Toast.show({ type: 'success', text1: '🔄 Odświeżanie...', text2: 'Pobieranie spotów z serwera' });
  }, [refetch]);

  const handleLikeToggle = useCallback((spotId: string, liked: boolean, count: number) => {
    if (selectedSpot?.id === spotId)
      setSelectedSpot(prev => prev ? { ...prev, isLiked: liked, likesCount: count } : prev);
  }, [selectedSpot]);

  const handleMapPress = useCallback((e: any) => {
    if (picking !== 'picking') return;
    const [longitude, latitude] = e.geometry.coordinates;
    setPickedCoord({ latitude, longitude });
    setPicking('idle');
    setAddVisible(true);
  }, [picking]);

  // Aktualny typ pinu dla wszystkich widocznych spotów
  const neededZoom: 'dot' | 'full' = showLabels ? 'full' : 'dot';

  if (!region) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg, justifyContent: 'center', alignItems: 'center' }}>
        <View style={{ alignItems: 'center', gap: 12, backgroundColor: theme.surface, borderRadius: 20, padding: 32, borderWidth: 1, borderColor: theme.border }}>
          <ActivityIndicator size="large" color="#e33835" />
          <Text style={{ color: theme.text, fontSize: 15, fontWeight: '700', marginTop: 4, fontFamily: 'Orbitron' }}>Ładowanie mapy</Text>
          <Text style={{ color: theme.textDim, fontSize: 12, fontFamily: 'Orbitron' }}>Pobieranie spotów z serwera...</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>

      {/* ── Off-screen renderery pinów (poza MapView, tak jak w map.tsx) ── */}
      {visibleSpots.map(spot => {
        const alreadyRendered = renderedZoom[spot.id] === neededZoom && pinImages[spot.id];
        if (alreadyRendered) return null;
        return (
          <SpotPinRenderer
            key={`spotrender_${spot.id}_${neededZoom}`}
            spot={spot}
            zoom={neededZoom}
            onCapture={uri => {
              setPinImages(prev => ({ ...prev, [spot.id]: uri }));
              setRenderedZoom(prev => ({ ...prev, [spot.id]: neededZoom }));
            }}
          />
        );
      })}

      {/* MAPA */}
      <Mapbox.MapView
        ref={mapRef}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
        styleURL={isSatellite ? MAPBOX_STYLE_SATELLITE : mapStyle}
        logoEnabled={false}
        attributionEnabled={false}
        compassEnabled={false}
        onPress={handleMapPress}
        onRegionDidChange={handleRegionChange}
      >
        <Mapbox.Camera
          defaultSettings={{
            centerCoordinate: [region?.longitude ?? 19.0, region?.latitude ?? 52.0],
            zoomLevel: 12,
          }}
        />
        <Mapbox.UserLocation visible={true} />

        {/* Piny spotów */}
        {visibleSpots.map(spot => {
          const imgUri = pinImages[spot.id];
          const color  = CATEGORY_COLORS[spot.category] ?? '#e33835';

          if (imgUri) {
            return (
              <Mapbox.MarkerView
                key={spot.id}
                coordinate={[spot.longitude, spot.latitude]}
                anchor={showLabels ? { x: 0.5, y: 1 } : { x: 0.5, y: 0.5 }}
              >
                <TouchableOpacity onPress={() => handleSelectSpot(spot)} activeOpacity={0.8}>
                  <View style={{ width: 48, height: 48 }}>
                    <View style={{ width: 48, height: 48, borderRadius: 8, backgroundColor: theme.surface3, justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: color }}>
                      <MaterialIcons name={CATEGORY_ICONS[spot.category] as any} size={20} color={color} />
                    </View>
                  </View>
                </TouchableOpacity>
              </Mapbox.MarkerView>
            );
          }

          return (
            <Mapbox.MarkerView
              key={spot.id}
              coordinate={[spot.longitude, spot.latitude]}
              anchor={{ x: 0.5, y: 0.5 }}
            >
              <TouchableOpacity onPress={() => handleSelectSpot(spot)} activeOpacity={0.8}>
                <View style={{ width: 16, height: 16, borderRadius: 8, backgroundColor: color, borderWidth: 2, borderColor: '#fff' }} />
              </TouchableOpacity>
            </Mapbox.MarkerView>
          );
        })}

        {/* Pin wybranej lokalizacji (picking) */}
        {pickedCoord && (
          <Mapbox.MarkerView coordinate={[pickedCoord.longitude, pickedCoord.latitude]} anchor={{ x: 0.5, y: 1 }}>
            <View style={{ alignItems: 'center' }}>
              <View style={{
                width: 40, height: 40, borderRadius: 20,
                backgroundColor: '#e3383520',
                borderWidth: 2.5, borderColor: '#e33835',
                alignItems: 'center', justifyContent: 'center',
              }}>
                <MaterialIcons name="add-location-alt" size={20} color="#e33835" />
              </View>
              <View style={{
                width: 0, height: 0,
                borderLeftWidth: 5, borderRightWidth: 5, borderTopWidth: 7,
                borderLeftColor: 'transparent', borderRightColor: 'transparent',
                borderTopColor: '#e33835', marginTop: -1,
              }} />
            </View>
          </Mapbox.MarkerView>
        )}
      </Mapbox.MapView>

      {/* GÓRNY PASEK */}
      {picking === 'idle' && (
        <>
          <View style={{ position: 'absolute', top: 52, left: 16, right: 16, flexDirection: 'row', gap: 8 }}>

            {/* Dystans */}
            <TouchableOpacity
              style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: panelBg, borderRadius: 14, paddingHorizontal: 10, paddingVertical: 10, borderWidth: 1, borderColor: panelBorder }}
              onPress={() => setDistanceVisible(true)} activeOpacity={0.8}
            >
              <View style={{ width: 22, height: 22, borderRadius: 6, backgroundColor: '#e3383520', justifyContent: 'center', alignItems: 'center' }}>
                <MaterialIcons name="radar" size={14} color="#e33835" />
              </View>
              <Text style={{ color: theme.text, fontFamily: 'Orbitron', fontSize: 11, fontWeight: '700' }}>{maxDistance} km</Text>
              <MaterialIcons name="keyboard-arrow-down" size={16} color={theme.textDim} />
            </TouchableOpacity>

            {/* Lista */}
            <TouchableOpacity
              style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, backgroundColor: panelBg, borderRadius: 14, paddingVertical: 10, borderWidth: 1, borderColor: panelBorder }}
              onPress={() => setListVisible(true)} activeOpacity={0.8}
            >
              <MaterialIcons name="format-list-bulleted" size={16} color="#e33835" />
              <Text style={{ color: theme.text, fontFamily: 'Orbitron', fontSize: 11, fontWeight: '600' }}>Spoty</Text>
              {visibleSpots.length > 0 && (
                <View style={{ backgroundColor: '#e33835', borderRadius: 8, paddingHorizontal: 6, paddingVertical: 1 }}>
                  <Text style={{ color: '#fff', fontFamily: 'Orbitron', fontSize: 9, fontWeight: '700' }}>{visibleSpots.length}</Text>
                </View>
              )}
            </TouchableOpacity>

            {/* Satellite */}
            <TouchableOpacity
              style={{
                width: 44, height: 44,
                backgroundColor: isSatellite ? '#e33835' : panelBg,
                borderRadius: 14, justifyContent: 'center', alignItems: 'center',
                borderWidth: 1, borderColor: isSatellite ? '#e33835' : panelBorder,
              }}
              onPress={toggleMapType} activeOpacity={0.8}
            >
              <MaterialIcons name="satellite-alt" size={20} color={isSatellite ? '#fff' : theme.textMuted} />
            </TouchableOpacity>

            {/* Refresh */}
            <TouchableOpacity
              style={{ width: 44, height: 44, backgroundColor: panelBg, borderRadius: 14, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: panelBorder }}
              onPress={handleRefresh} activeOpacity={0.8} disabled={loading}
            >
              {loading
                ? <ActivityIndicator size={16} color="#e33835" />
                : <MaterialIcons name="refresh" size={20} color={theme.textMuted} />
              }
            </TouchableOpacity>
          </View>

          {/* PASEK FILTRÓW */}
          <View style={{ position: 'absolute', top: 108, left: 0, right: 0 }}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: 16, gap: 8, alignItems: 'center' }}
            >
              {/* Wszystkie */}
              <TouchableOpacity
                style={[{
                  flexDirection: 'row', alignItems: 'center', gap: 5,
                  paddingHorizontal: 11, paddingVertical: 7, borderRadius: 10,
                  backgroundColor: panelBg, borderWidth: 1, borderColor: panelBorder,
                }, activeCategories.length === 0 && { borderColor: '#e33835', backgroundColor: '#e3383520' }]}
                onPress={clearCategories} activeOpacity={0.8}
              >
                <MaterialIcons name="layers" size={13} color={activeCategories.length === 0 ? '#e33835' : theme.textDim} />
                <Text style={{ color: activeCategories.length === 0 ? '#e33835' : theme.textDim, fontFamily: 'Orbitron', fontSize: 9, fontWeight: '700' }}>
                  WSZYSTKIE
                </Text>
              </TouchableOpacity>

              {/* Divider OFFROAD */}
              <View style={{ justifyContent: 'center', paddingHorizontal: 4 }}>
                <Text style={{ color: theme.textDim, fontFamily: 'Orbitron', fontSize: 7, fontWeight: '700', letterSpacing: 2 }}>OFFROAD</Text>
              </View>

              {OFFROAD_CATEGORIES.map(cat => {
                const active = activeCategories.includes(cat);
                const color  = CATEGORY_COLORS[cat];
                return (
                  <TouchableOpacity
                    key={cat}
                    style={[{
                      flexDirection: 'row', alignItems: 'center', gap: 5,
                      paddingHorizontal: 11, paddingVertical: 7, borderRadius: 10,
                      backgroundColor: panelBg, borderWidth: 1, borderColor: panelBorder,
                    }, active && { borderColor: color, backgroundColor: color + '22' }]}
                    onPress={() => toggleCategory(cat)} activeOpacity={0.8}
                  >
                    <MaterialIcons name={CATEGORY_ICONS[cat] as any} size={13} color={active ? color : theme.textDim} />
                    <Text style={{ color: active ? color : theme.textDim, fontFamily: 'Orbitron', fontSize: 9, fontWeight: '700' }}>{cat}</Text>
                  </TouchableOpacity>
                );
              })}

              {/* Divider INNE */}
              <View style={{ justifyContent: 'center', paddingHorizontal: 4 }}>
                <Text style={{ color: theme.textDim, fontFamily: 'Orbitron', fontSize: 7, fontWeight: '700', letterSpacing: 2 }}>INNE</Text>
              </View>

              {CATEGORIES.filter(c => !OFFROAD_CATEGORIES.includes(c)).map(cat => {
                const active = activeCategories.includes(cat);
                const color  = CATEGORY_COLORS[cat];
                return (
                  <TouchableOpacity
                    key={cat}
                    style={[{
                      flexDirection: 'row', alignItems: 'center', gap: 5,
                      paddingHorizontal: 11, paddingVertical: 7, borderRadius: 10,
                      backgroundColor: panelBg, borderWidth: 1, borderColor: panelBorder,
                    }, active && { borderColor: color, backgroundColor: color + '22' }]}
                    onPress={() => toggleCategory(cat)} activeOpacity={0.8}
                  >
                    <MaterialIcons name={CATEGORY_ICONS[cat] as any} size={13} color={active ? color : theme.textDim} />
                    <Text style={{ color: active ? color : theme.textDim, fontFamily: 'Orbitron', fontSize: 9, fontWeight: '700' }}>{cat}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        </>
      )}

      {/* BANNER — picking */}
      {picking === 'picking' && (
        <View style={{
          position: 'absolute', top: 52, left: 16, right: 16,
          flexDirection: 'row', alignItems: 'center', gap: 10,
          backgroundColor: panelBg, borderRadius: 14,
          paddingHorizontal: 14, paddingVertical: 12,
          borderWidth: 1, borderColor: '#e3383550',
        }}>
          <View style={{ width: 30, height: 30, borderRadius: 8, backgroundColor: '#e3383520', justifyContent: 'center', alignItems: 'center' }}>
            <MaterialIcons name="touch-app" size={18} color="#e33835" />
          </View>
          <Text style={{ flex: 1, color: theme.text, fontFamily: 'Orbitron', fontSize: 10, letterSpacing: 0.5 }}>
            Dotknij mapę aby ustawić lokalizację
          </Text>
          <TouchableOpacity
            onPress={() => setPicking('idle')}
            style={{ width: 30, height: 30, borderRadius: 8, backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border, justifyContent: 'center', alignItems: 'center' }}
            activeOpacity={0.7}
          >
            <MaterialIcons name="close" size={18} color={theme.textDim} />
          </TouchableOpacity>
        </View>
      )}

      {/* MOJA LOKALIZACJA */}
      {picking === 'idle' && (
        <TouchableOpacity
          style={{
            position: 'absolute', bottom: 120, right: 16,
            width: 48, height: 48, borderRadius: 14,
            backgroundColor: panelBg,
            borderWidth: 1, borderColor: panelBorder,
            justifyContent: 'center', alignItems: 'center',
            elevation: 8,
            shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
            shadowOpacity: 0.15, shadowRadius: 6,
          }}
          onPress={handleLocateMe} activeOpacity={0.8}
        >
          <MaterialIcons name="my-location" size={22} color="#e33835" />
        </TouchableOpacity>
      )}

      {/* PRZYCISK DODAJ */}
      {picking === 'idle' && (
        <TouchableOpacity
          style={{
            position: 'absolute', bottom: 40, alignSelf: 'center',
            flexDirection: 'row', alignItems: 'center', gap: 10,
            backgroundColor: '#e33835', borderRadius: 18,
            paddingHorizontal: 24, paddingVertical: 14,
            elevation: 12,
            shadowColor: '#e33835', shadowOffset: { width: 0, height: 4 },
            shadowOpacity: 0.45, shadowRadius: 12,
          }}
          onPress={handleStartPicking} activeOpacity={0.85}
        >
          <View style={{ width: 28, height: 28, borderRadius: 8, backgroundColor: '#ffffff20', justifyContent: 'center', alignItems: 'center' }}>
            <MaterialIcons name="add-location-alt" size={20} color="#fff" />
          </View>
          <Text style={{ color: '#fff', fontFamily: 'Orbitron', fontSize: 12, fontWeight: '700', letterSpacing: 1 }}>
            DODAJ SPOT
          </Text>
        </TouchableOpacity>
      )}

      {/* MODALE */}
      <AddSpotModal
        visible={addVisible} onClose={handleAddCancel}
        onAdd={(name, desc, cat, photos) => addSpot(name, desc, cat, photos, pickedCoord)}
      />
      <SpotListModal
        visible={listVisible} onClose={() => setListVisible(false)}
        spots={visibleSpots} maxDistance={maxDistance}
        onSelectSpot={handleSelectSpot} getDistance={getDistance}
        sortMode={sortMode} onSortChange={setSortMode}
      />
      <SpotDetailModal
        visible={detailVisible} spot={selectedSpot}
        onClose={() => setDetailVisible(false)}
        getDistance={getDistance} onLikeToggle={handleLikeToggle}
      />
      <DistanceModal
        visible={distanceVisible} maxDistance={maxDistance}
        onSelect={setMaxDistance} onClose={() => setDistanceVisible(false)}
      />
    </View>
  );
}