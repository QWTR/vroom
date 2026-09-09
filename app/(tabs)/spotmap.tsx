import React, { useRef, useState, useCallback, useEffect } from 'react';
import { useIsFocused } from '@react-navigation/native';
import { useLocalSearchParams } from 'expo-router';
import { View, TouchableOpacity, ActivityIndicator } from 'react-native';
import { AppText as Text } from '../../components/ui/AppText';
import * as Location from 'expo-location';
import Mapbox from '@rnmapbox/maps';
import { resolveStandardMapStyle, MAPBOX_STYLE_SATELLITE } from '../../constants/mapConfig';
import { ensureMapboxToken, initMapbox } from '../../lib/mapboxInit';

ensureMapboxToken();
import { MaterialIcons } from '@expo/vector-icons';
import Toast from 'react-native-toast-message';
import { Spot } from '../../constants/spotTypes';
import { useSpots }  from '../../hooks/useSpots';
import { useMapHudTheme as useTheme } from '../../components/map/useMapHudTheme';
import { SpotMapHud } from '../../components/spots/SpotMapHud';

import { AddSpotModal }    from '../../components/spots/AddSpotModal';
import { SpotListModal }   from '../../components/spots/SpotListModal';
import { SpotDetailModal } from '../../components/spots/SpotDetailModal';
import { DistanceModal }   from '../../components/spots/DistanceModal';
import { SpotMapLayers } from '../../components/spots/SpotMapLayers';
import { SpotCategorySpriteGenerator } from '../../components/spots/SpotCategorySpriteGenerator';
import { useScreenHeaderTop } from '../../lib/screenHeaderInsets';
import { track } from '../../lib/analytics/client';

type PickingState = 'idle' | 'picking';

export default function SpotMap() {
  const { spotId } = useLocalSearchParams<{ spotId?: string; commentId?: string }>();
  const isFocused = useIsFocused();
  const mapRef = useRef<Mapbox.MapView>(null);
  useEffect(() => {
    void initMapbox().catch(() => {});
  }, []);
  const headerTop = useScreenHeaderTop(8);
  // Osobny ref dla Mapbox.Camera — setCamera/flyTo działa tylko na Camera, nie na MapView
  const cameraRef = useRef<Mapbox.Camera>(null);
  const { theme, isDark, presetId } = useTheme();
  const mapStyle       = resolveStandardMapStyle(isDark, presetId);

  const {
    region, spots, visibleSpots, maxDistance, setMaxDistance,
    addSpot, getDistance, loading, error, hasLoaded, refetch,
    activeCategories, toggleCategory, clearCategories,
    sortMode, setSortMode,
    userLocation,
  } = useSpots(isFocused);

  const [addVisible,      setAddVisible]      = useState(false);
  const [listVisible,     setListVisible]     = useState(false);
  const [detailVisible,   setDetailVisible]   = useState(false);
  const [distanceVisible, setDistanceVisible] = useState(false);
  const [selectedSpot,    setSelectedSpot]    = useState<Spot | null>(null);
  const [picking,         setPicking]         = useState<PickingState>('idle');
  const [pickedCoord,     setPickedCoord]     = useState<{ latitude: number; longitude: number } | null>(null);
  const [isSatellite,       setIsSatellite]       = useState(false);
  const [categorySprites,   setCategorySprites]   = useState<Record<string, string> | null>(null);
  const handledSpotIdRef = useRef<string | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const initiallyCentered = useRef(false);
  useEffect(() => {
    if (!mapReady || !userLocation || initiallyCentered.current || spotId) return;
    initiallyCentered.current = true;
    cameraRef.current?.setCamera({ centerCoordinate: [userLocation.longitude, userLocation.latitude], zoomLevel: 12, animationDuration: 450 });
  }, [mapReady, userLocation, spotId]);

  useEffect(() => {
    const requestedId = String(spotId || '');
    if (!requestedId || handledSpotIdRef.current === requestedId) return;
    const openSpot = (spot: Spot) => {
      handledSpotIdRef.current = requestedId;
      setSelectedSpot(spot);
      setDetailVisible(true);
      cameraRef.current?.setCamera({
        centerCoordinate: [spot.longitude, spot.latitude], zoomLevel: 15, animationDuration: 600,
      });
    };
    const existing = spots.find((spot) => String(spot.id) === requestedId);
    if (existing) { openSpot(existing); return; }
    void fetch(`https://v-room.app/api/spots/${encodeURIComponent(requestedId)}/details`)
      .then(async (response) => {
        if (!response.ok) throw new Error();
        const raw = await response.json();
        openSpot({
          id: String(raw.id), name: raw.name, description: raw.description || '', category: raw.category,
          latitude: raw.latitude, longitude: raw.longitude, photos: raw.photos || [],
          author: raw.author?.username || 'Nieznany', createdAt: raw.createdAt?.split('T')[0] || '',
          likesCount: raw.likesCount ?? 0, commentsCount: raw.commentsCount ?? 0, isLiked: raw.isLiked ?? false,
        });
      })
      .catch(() => {
        handledSpotIdRef.current = requestedId;
        Toast.show({ type: 'info', text1: 'Ta treść nie jest już dostępna' });
      });
  }, [spotId, spots]);


  const toggleMapType = useCallback(() => {
    setIsSatellite(prev => !prev);
  }, []);

  // NOTE: Używamy ref na Mapbox.Camera (nie MapView) — tylko komponent Camera
  //       udostępnia setCamera/flyTo. Wywołanie tych metod na MapView nie działa.
  const handleLocateMe = useCallback(async () => {
    track({ eventName: 'ui_action', screenName: 'spotmap', surface: 'spot_map', priority: 'medium', properties: { action: 'locate_me' } });
    if (userLocation) {
      cameraRef.current?.setCamera({
        centerCoordinate: [userLocation.longitude, userLocation.latitude],
        zoomLevel: 14,
        animationDuration: 600,
      });
      return;
    }
    // Brak userLocation — spróbuj pobrać aktualną pozycję
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Toast.show({ type: 'error', text1: 'BRAK DOSTĘPU', text2: 'Włącz uprawnienia lokalizacji' });
        return;
      }
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const { latitude, longitude } = loc.coords;
      cameraRef.current?.setCamera({
        centerCoordinate: [longitude, latitude],
        zoomLevel: 14,
        animationDuration: 600,
      });
    } catch (error) {
      console.error('[SpotMap] handleLocateMe error:', error);
      Toast.show({ type: 'error', text1: 'BŁĄD', text2: 'Nie można pobrać lokalizacji' });
    }
  }, [userLocation]);

  const handleStartPicking = useCallback(() => setPicking('picking'), []);
  const handleAddCancel    = useCallback(() => { setAddVisible(false); setPickedCoord(null); }, []);
  const handleSelectSpot   = useCallback((spot: Spot) => {
    track({ eventName: 'content_opened', screenName: 'spotmap', surface: 'spot_map', entityType: 'spot', entityId: spot.id, priority: 'medium' });
    setSelectedSpot(spot);
    setDetailVisible(true);
  }, []);

  const handleZoomTo = useCallback((center: [number, number], zoomLevel: number) => {
    cameraRef.current?.setCamera({
      centerCoordinate: center,
      zoomLevel,
      animationDuration: 450,
    });
  }, []);

  const handleRefresh = useCallback(() => {
    void refetch();
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

  if (!region || categorySprites === null) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg, justifyContent: 'center', alignItems: 'center' }}>
        <SpotCategorySpriteGenerator onReady={setCategorySprites} />
        <View style={{ alignItems: 'center', gap: 12, backgroundColor: theme.surface, borderRadius: 20, padding: 32, borderWidth: 1, borderColor: theme.border }}>
          <ActivityIndicator size="large" color="#e33835" />
          <Text style={{ color: theme.text, fontSize: 15, fontWeight: '700', marginTop: 4, fontFamily: 'Manrope_600SemiBold' }}>Ładowanie mapy</Text>
          <Text style={{ color: theme.textDim, fontSize: 12, fontFamily: 'Manrope_600SemiBold' }}>
            {!region ? 'Pobieranie lokalizacji...' : 'Przygotowywanie markerów...'}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>

      {/* MAPA */}
      <View
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
        collapsable={false}
      >
      <Mapbox.MapView
        ref={mapRef}
        style={{ flex: 1 }}
        styleURL={isSatellite ? MAPBOX_STYLE_SATELLITE : mapStyle}
        logoEnabled={false}
        attributionEnabled={false}
        compassEnabled={false}
        scaleBarEnabled={false}
        surfaceView={false}
        onPress={handleMapPress}
        onDidFinishLoadingMap={() => setMapReady(true)}
      >
        <Mapbox.Camera
          ref={cameraRef}
          defaultSettings={{
            centerCoordinate: [region?.longitude ?? 19.0, region?.latitude ?? 52.0],
            zoomLevel: 12,
          }}
        />
        {userLocation && (
          <Mapbox.MarkerView
            coordinate={[userLocation.longitude, userLocation.latitude]}
            anchor={{ x: 0.5, y: 0.5 }}
          >
            <View
              style={{
                width: 18,
                height: 18,
                borderRadius: 9,
                backgroundColor: '#e33835',
                borderWidth: 3,
                borderColor: '#ffffff',
              }}
            />
          </Mapbox.MarkerView>
        )}

        <SpotMapLayers
          spots={visibleSpots}
          categorySprites={categorySprites}
          onSelectSpot={handleSelectSpot}
          onZoomTo={handleZoomTo}
        />

        {/* Pin wybranej lokalizacji (picking) */}
        {pickedCoord && (
          <Mapbox.MarkerView
            coordinate={[pickedCoord.longitude, pickedCoord.latitude]}
            anchor={{ x: 0.5, y: 1 }}
          >
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
      </View>

      <SpotMapHud top={headerTop} count={visibleSpots.length} radius={maxDistance}
        loading={loading} error={error} hasLoaded={hasLoaded} satellite={isSatellite}
        picking={picking === 'picking'} categories={activeCategories}
        onCategory={category => {
          track({ eventName: 'filter_applied', screenName: 'spotmap', surface: 'spot_filters', priority: 'medium', properties: { category } });
          toggleCategory(category);
        }}
        onClear={clearCategories} onDistance={() => setDistanceVisible(true)}
        onList={() => setListVisible(true)} onRefresh={handleRefresh} onSatellite={toggleMapType}
        onLocate={handleLocateMe} onAdd={handleStartPicking} onCancel={() => setPicking('idle')}
      />

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
