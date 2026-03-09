import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useFocusEffect } from 'expo-router';
import {
  View, Text, ActivityIndicator, TouchableOpacity,
  Platform, Alert, StyleSheet, NativeModules 
} from 'react-native';
const { UsersModule } = NativeModules;
import AsyncStorage from '@react-native-async-storage/async-storage';
import MapView, { PROVIDER_GOOGLE, Marker, Polyline } from 'react-native-maps';
import * as Location from 'expo-location';
import * as Speech from 'expo-speech';
import { MaterialIcons, MaterialCommunityIcons } from '@expo/vector-icons';
import Toast from 'react-native-toast-message';

import { styles } from '../../styles/mapstyle';
import { User, LocationState, RouteInfo } from '../../constants/types';
import { GOOGLE_MAPS_APIKEY, customMapStyle, MAX_NEARBY_USERS_DISTANCE } from '../../constants/mapConfig';
import { latFilter, lngFilter } from '../../scripts/kalmanFilter';
import { calculateDistance } from '../../scripts/distance';
import { useGoogleDirections } from '../../hooks/useGoogleDirections';
import { useCameraAnimation } from '../../hooks/useCameraAnimation';
import { CarMarker } from '../../components/markers/CarMarker';
import { UserCarMarker } from '../../components/markers/UserCarMarker';
import { MarkerRenderer } from '../../components/markers/MarkerRenderer';
import { UserInfoModal } from '../../components/modals/UserInfoModal';
import { SearchModal } from '../../components/modals/SearchModal';
import { SettingsModal } from '../../components/modals/SettingsModal';
import { ReportModal } from '../../components/modals/ReportModal';

export default function MapScreen() {
  const mapRef = useRef<MapView>(null);
  const lastInstructionRef = useRef('');
  const locationSubscription = useRef<any>(null);
  const lastHeadingRef = useRef<number>(0);
  const locationInitialized = useRef(false);

  const [userLocation, setUserLocation]   = useState<LocationState | null>(null);
  const [startLocation, setStartLocation] = useState<LocationState | null>(null);
  const [endLocation, setEndLocation]     = useState<LocationState | null>(null);
  const [region, setRegion]               = useState<any>(null);

  const [isNavigating, setIsNavigating] = useState(false);
  const [routeInfo, setRouteInfo]       = useState<RouteInfo | null>(null);
  const [currentStep, setCurrentStep]   = useState(0);
  const [directions, setDirections]     = useState<any[]>([]);

  const [mapType, setMapType]                       = useState('standard');
  const [settingsVisible, setSettingsVisible]       = useState(false);
  const [reportVisible, setReportVisible]           = useState(false);
  const [searchModalVisible, setSearchModalVisible] = useState(false);
  const [userInfoVisible, setUserInfoVisible]       = useState(false);
  const [selectedUser, setSelectedUser]             = useState<User | null>(null);
  const [heading, setHeading]     = useState(0);
  const [speed, setSpeed]         = useState<number | null>(null);
  const [isSpeechEnabled, setIsSpeechEnabled] = useState(true);
  const [nearbyUsers, setNearbyUsers]         = useState<User[]>([]);
  const [markerImages, setMarkerImages]       = useState<Record<string, string>>({});

  // ── nearbyUsers init ────────────────────────────────────────────────────────
  useEffect(() => {
    if (userLocation && !locationInitialized.current) {
      locationInitialized.current = true;
      setNearbyUsers([
        { id: 'user_1', name: 'Anna K.',  latitude: userLocation.latitude + 0.005, longitude: userLocation.longitude + 0.003, avatar: '👩',   status: 'Online',  isFriend: true  },
        { id: 'user_2', name: 'Marek W.', latitude: userLocation.latitude - 0.004, longitude: userLocation.longitude + 0.006, avatar: '👨',   status: 'Online',  isFriend: true  },
        { id: 'user_3', name: 'Ewa S.',   latitude: userLocation.latitude + 0.008, longitude: userLocation.longitude - 0.005, avatar: '👩‍🦰', status: 'Offline', isFriend: false },
        { id: 'user_4', name: 'Jan K.',   latitude: userLocation.latitude - 0.003, longitude: userLocation.longitude - 0.007, avatar: '👨‍💼', status: 'Online',  isFriend: false },
        { id: 'user_5', name: 'Tomek Z.', latitude: userLocation.latitude + 0.010, longitude: userLocation.longitude + 0.010, avatar: '👨',   status: 'Online',  isFriend: true  },
      ]);
    }
  }, [userLocation]);


  
  // ── nav_destination z SpotMap ───────────────────────────────────────────────
  useFocusEffect(
    useCallback(() => {
      const check = async () => {
        try {
          const raw = await AsyncStorage.getItem('nav_destination');
          if (!raw) return;
          await AsyncStorage.removeItem('nav_destination');
          const dest = JSON.parse(raw);

          // Pobierz aktualną lokalizację jeśli userLocation jeszcze null
          let currentLocation = userLocation;
          if (!currentLocation) {
            const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
            currentLocation = {
              latitude: loc.coords.latitude,
              longitude: loc.coords.longitude,
            };
            setUserLocation(currentLocation);
          }

          setStartLocation({ ...currentLocation, name: 'Moja pozycja' });
          setEndLocation({
            latitude:  dest.latitude,
            longitude: dest.longitude,
            name:      dest.name,
          });
          Toast.show({ type: 'success', text1: '📍 CEL USTAWIONY', text2: dest.name });
        } catch (e) {
          console.log('nav_destination error:', e);
        }
      };
      check();
    }, [userLocation]),
  );

  const { animateCameraSmooth } = useCameraAnimation(mapRef);

  const { route: previewRoute } = useGoogleDirections(
    isNavigating ? userLocation : startLocation,
    endLocation,
    GOOGLE_MAPS_APIKEY,
  );
  const { route: navRoute } = useGoogleDirections(
    userLocation,
    endLocation,
    GOOGLE_MAPS_APIKEY,
  );

  // ── helpers ─────────────────────────────────────────────────────────────────
  const extractManeuver = useCallback((instruction: string): string => {
    if (!instruction) return 'Przygotuj się';
    return instruction
      .replace(/<\/b>/g, ' </b>').replace(/<\/u>/g, ' </u>')
      .replace(/<[^>]*>/g, '').replace(/\s\s+/g, ' ').trim();
  }, []);

  const speakInstruction = useCallback((text: string) => {
    if (!isSpeechEnabled) return;
    const clean = extractManeuver(text);
    if (clean && clean !== lastInstructionRef.current) {
      lastInstructionRef.current = clean;
      Speech.stop().catch(() => {});
      setTimeout(() => Speech.speak(clean, { language: 'pl-PL', pitch: 1.0, rate: 0.9 }), 250);
    }
  }, [isSpeechEnabled, extractManeuver]);

  const formatDuration = useCallback(
    (m: number) => m < 60 ? `${m} min` : `${Math.floor(m / 60)}h ${m % 60}min`,
    [],
  );

  const formatSpeed = useCallback(
    (s: number | null) => s == null ? '0 km/h' : `${Math.round(s * 3.6)} km/h`,
    [],
  );

  // ── location init ────────────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
          Toast.show({ type: 'error', text1: 'ODMOWA DOSTĘPU', text2: 'Włącz dostęp do lokalizacji' });
          return;
        }
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        const lat = latFilter.filter(loc.coords.latitude, loc.coords.accuracy);
        const lng = lngFilter.filter(loc.coords.longitude, loc.coords.accuracy);
        setUserLocation({ latitude: lat, longitude: lng });
        setRegion({ latitude: lat, longitude: lng, latitudeDelta: 0.015, longitudeDelta: 0.015 });
      } catch {
        Toast.show({ type: 'error', text1: 'BŁĄD LOKALIZACJI', text2: 'Nie mogę pobrać pozycji' });
      }
    })();
  }, []);

  // ── location watcher ─────────────────────────────────────────────────────────
  useEffect(() => {
    let watcher: any = null;
    (async () => {
      try {
        watcher = await Location.watchPositionAsync(
          {
            accuracy: isNavigating ? Location.Accuracy.BestForNavigation : Location.Accuracy.Balanced,
            timeInterval: isNavigating ? 500 : 3000,
            distanceInterval: 5,
          },
          (loc) => {
            const lat = latFilter.filter(loc.coords.latitude, loc.coords.accuracy);
            const lng = lngFilter.filter(loc.coords.longitude, loc.coords.accuracy);
            setUserLocation({ latitude: lat, longitude: lng });
            const headingDiff = Math.abs((loc.coords.heading || 0) - lastHeadingRef.current);
            if (headingDiff > 5) {
              setHeading(loc.coords.heading || 0);
              lastHeadingRef.current = loc.coords.heading || 0;
            }
            setSpeed(loc.coords.speed);
            if (isNavigating && loc.coords.heading) {
              animateCameraSmooth({
                center: { latitude: lat, longitude: lng },
                pitch: 65, heading: loc.coords.heading, zoom: 18.5, altitude: 0,
              });
              if (directions[currentStep])
                speakInstruction(directions[currentStep].html_instructions);
            }
          },
        );
        locationSubscription.current = watcher;
      } catch (e) { console.log('Watch error:', e); }
    })();
    return () => { locationSubscription.current?.remove(); Speech.stop(); };
  }, [isNavigating, currentStep, directions, speakInstruction, animateCameraSmooth]);

  // ── route info sync ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (previewRoute) {
      setRouteInfo({
        distance: (previewRoute.distanceValue / 1000).toFixed(2),
        duration: previewRoute.duration,
      });
      setDirections(previewRoute.steps);
    }
  }, [previewRoute]);

  // ── handlers ─────────────────────────────────────────────────────────────────
  const handleSelectStart = useCallback((l: LocationState) => setStartLocation(l), []);
  const handleSelectEnd   = useCallback((l: LocationState) => setEndLocation(l),   []);

  const handleUserMarkerPress = useCallback((user: User) => {
    if (!userLocation) return;
    const dist = calculateDistance(
      userLocation.latitude, userLocation.longitude,
      user.latitude, user.longitude,
    );
    setSelectedUser({ ...user, distance: dist });
    setUserInfoVisible(true);
  }, [userLocation]);

  const handleNavigateToUser = useCallback(() => {
    if (!selectedUser) return;
    if (userLocation) setStartLocation({ ...userLocation, name: 'Moja pozycja' });
    setEndLocation({
      latitude: selectedUser.latitude,
      longitude: selectedUser.longitude,
      name: selectedUser.name,
    });
    setUserInfoVisible(false);
    Toast.show({ type: 'success', text1: 'CEL USTAWIONY', text2: selectedUser.name });
  }, [selectedUser, userLocation]);

  const startNavigation = useCallback(() => {
    if (!startLocation || !endLocation) {
      Toast.show({ type: 'error', text1: 'BŁĄD', text2: 'Wybierz początek i koniec' });
      return;
    }
    if (!userLocation) {
      Toast.show({ type: 'error', text1: 'BŁĄD', text2: 'Nie mogę pobrać pozycji' });
      return;
    }
    const distToStart = calculateDistance(
      userLocation.latitude, userLocation.longitude,
      startLocation.latitude, startLocation.longitude,
    );
    if (distToStart > 0.05) {
      Toast.show({ type: 'error', text1: 'BŁĄD', text2: `Jesteś ${(distToStart * 1000).toFixed(0)}m od startu` });
      Alert.alert(
        'Błąd',
        `Jesteś ${(distToStart * 1000).toFixed(0)}m od startu.`,
        [
          { text: 'OK' },
          { text: 'Nawiguj do startu', onPress: () => setEndLocation(startLocation) },
        ],
      );
      return;
    }
    setIsNavigating(true);
    setCurrentStep(0);
    lastInstructionRef.current = '';
    mapRef.current?.animateCamera(
      { center: { latitude: userLocation.latitude, longitude: userLocation.longitude }, pitch: 65, heading, zoom: 18.5 },
      { duration: 600 },
    );
    Toast.show({ type: 'success', text1: 'NAWIGACJA ROZPOCZĘTA', text2: 'Dobrej drogi!' });
  }, [startLocation, endLocation, userLocation, heading]);

  const stopNavigation = useCallback(() => {
    setIsNavigating(false);
    Speech.stop();
    mapRef.current?.animateCamera({ pitch: 0, zoom: 15, heading: 0 }, { duration: 1000 });
    Toast.show({ type: 'success', text1: 'NAWIGACJA ZATRZYMANA', text2: '' });
  }, []);

  const handleReset = useCallback(() => {
    setStartLocation(null);
    setEndLocation(null);
    setRouteInfo(null);
    setCurrentStep(0);
    setDirections([]);
  }, []);

  const visibleUsersOnMap = useMemo(() => {
    if (!userLocation) return [];
    return nearbyUsers.filter(u => {
      if (u.isFriend) return true;
      const dist = calculateDistance(
        userLocation.latitude, userLocation.longitude,
        u.latitude, u.longitude,
      );
      return dist <= MAX_NEARBY_USERS_DISTANCE;
    });
  }, [userLocation, nearbyUsers]);

  // ── bridge → Android Auto — status nawigacji ────────────────────────────────
  useEffect(() => {
    if (!UsersModule) return;
    UsersModule.setNavigatingForAuto(isNavigating);
  }, [isNavigating]);

  // ── bridge → Android Auto — prędkość i kierunek ─────────────────────────────
  useEffect(() => {
    if (!UsersModule) return;
    if (userLocation) {
      UsersModule.saveMyLocationForAuto(userLocation.latitude, userLocation.longitude);
      UsersModule.saveSpeedHeadingForAuto(speed ?? 0, heading);
    }
  }, [userLocation, speed, heading]);

  // ── bridge → Android Auto — aktualny krok nawigacji ─────────────────────────
  useEffect(() => {
    if (!UsersModule) return;
    if (isNavigating && directions[currentStep]) {
      const step = directions[currentStep];
      UsersModule.saveNavStepForAuto(
        extractManeuver(step.html_instructions),
        step.distance?.text || '',
        routeInfo ? formatDuration(routeInfo.duration) : '',
      );
    }
  }, [isNavigating, currentStep, directions, routeInfo]);

  // ── bridge → Android Auto — trasa ───────────────────────────────────────────
  useEffect(() => {
    if (!UsersModule) return;
    const route = isNavigating ? navRoute : previewRoute;
    if (route?.points) {
      UsersModule.saveRouteForAuto(JSON.stringify(
        route.points.map((p: any) => ({ lat: p.latitude, lng: p.longitude }))
      ));
    }
  }, [isNavigating, navRoute, previewRoute]);

  // ── bridge → Android Auto — cel ─────────────────────────────────────────────
  useEffect(() => {
    if (!UsersModule) return;
    if (endLocation) {
      UsersModule.saveDestinationForAuto(
        endLocation.latitude,
        endLocation.longitude,
        endLocation.name || 'Cel',
      );
    } 
  }, [endLocation]);

  // ── bridge → Android Auto — nasłuchuj Stop z Auto ───────────────────────────
  useEffect(() => {
    if (!UsersModule || !isNavigating) return;
    const interval = setInterval(async () => {
      try {
        const stopRequested = await UsersModule.checkNavStopRequested();
        if (stopRequested) {
          stopNavigation();
        }
      } catch {}
    }, 1500);
    return () => clearInterval(interval);
  }, [isNavigating, stopNavigation]);
  
  // ── bridge → Android Auto — użytkownicy ─────────────────────────────────────
  useEffect(() => {
    if (!UsersModule) return;
    UsersModule.saveUsersForAuto(JSON.stringify(
      visibleUsersOnMap.map(u => ({
        id:       u.id,
        name:     u.name,
        latitude: u.latitude,
        longitude: u.longitude,
        status:   u.status,
        isFriend: u.isFriend,
      }))
    ));
  }, [visibleUsersOnMap]);
  // ── web guard — PO wszystkich hookach ───────────────────────────────────────
  if (Platform.OS === 'web') {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0f0f0f' }}>
        <Text style={{ color: '#fff' }}>Tylko mobilne</Text>
      </View>
    );
  }

  if (!region) {
    return (
      <View style={styles.loader}>
        <ActivityIndicator size="large" color="#e33835ce" />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#0f0f0f' }}>

      {/* MarkerRenderer POZA MapView */}
      {userLocation && visibleUsersOnMap.map(user => (
        !markerImages[user.id] ? (
          <MarkerRenderer
            key={`renderer_${user.id}`}
            user={user}
            distance={calculateDistance(
              userLocation.latitude, userLocation.longitude,
              user.latitude, user.longitude,
            )}
            onCapture={(uri) => setMarkerImages(prev => ({ ...prev, [user.id]: uri }))}
          />
        ) : null
      ))}

      {/* MAPA */}
      <MapView
        ref={mapRef}
        provider={PROVIDER_GOOGLE}
        style={StyleSheet.absoluteFillObject}
        customMapStyle={customMapStyle}
        initialRegion={region}
        mapType={mapType}
        showsUserLocation={false}
        pitchEnabled
        rotateEnabled
        moveOnMarkerPress={false}
        showsMyLocationButton={false}    
        showsCompass={false}            
        toolbarEnabled={false} 
      >
        {/* Mój marker */}
        {userLocation && (
          <Marker
            coordinate={{ latitude: userLocation.latitude, longitude: userLocation.longitude }}
            anchor={{ x: 0.5, y: 0.5 }}
            flat={false}
            rotation={heading}
            zIndex={1000}
            tracksViewChanges={true}
          >
            <CarMarker heading={heading} />
          </Marker>
        )}

        {/* Cel */}
        {endLocation && (
          <Marker
            coordinate={{ latitude: endLocation.latitude, longitude: endLocation.longitude }}
            pinColor="#e33835"
            zIndex={100}
            tracksViewChanges={false}
          />
        )}

        {/* Użytkownicy */}
        {!isNavigating && userLocation && visibleUsersOnMap.map(user => (
          <UserCarMarker
            key={`user_${user.id}`}
            user={user}
            distance={calculateDistance(
              userLocation.latitude, userLocation.longitude,
              user.latitude, user.longitude,
            )}
            onPress={() => handleUserMarkerPress(user)}
            imageUri={markerImages[user.id] || null}
          />
        ))}

        {/* Trasa podgląd */}
        {!isNavigating && previewRoute?.points && (
          <Polyline coordinates={previewRoute.points} strokeColor="#00bfff" strokeWidth={6} geodesic />
        )}

        {/* Trasa nawigacja */}
        {isNavigating && navRoute?.points && (
          <Polyline coordinates={navRoute.points} strokeColor="#e33835ce" strokeWidth={8} geodesic />
        )}
      </MapView>

      {/* Prędkość */}
      {isNavigating && (
        <View style={styles.speedPanelNav}>
          <Text style={styles.speedValue}>{formatSpeed(speed)}</Text>
          <Text style={styles.speedLabel}>km/h</Text>
        </View>
      )}

      {/* Przyciski boczne */}
      <View style={[styles.rightBottomControls, !isNavigating && { bottom: 220 }]}>
        <TouchableOpacity style={styles.sideBtn} onPress={() => mapRef.current?.animateToRegion(region)} activeOpacity={0.7}>
          <MaterialIcons name="my-location" size={22} color="white" />
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.sideBtn, !isSpeechEnabled && { backgroundColor: '#e33835ce' }]}
          onPress={() => setIsSpeechEnabled(v => !v)}
          activeOpacity={0.7}
        >
          <MaterialIcons name={isSpeechEnabled ? 'volume-up' : 'volume-off'} size={22} color={!isSpeechEnabled ? '#0f0f0f' : 'white'} />
        </TouchableOpacity>
        <TouchableOpacity style={[styles.sideBtn, { backgroundColor: '#e33835ce' }]} onPress={() => setReportVisible(true)} activeOpacity={0.7}>
          <MaterialIcons name="warning" size={22} color="#0f0f0f" />
        </TouchableOpacity>
        <TouchableOpacity style={styles.sideBtn} onPress={() => setSettingsVisible(true)} activeOpacity={0.7}>
          <MaterialCommunityIcons name="menu" size={26} color="#fff" />
        </TouchableOpacity>
      </View>

      {/* Panel nawigacji górny */}
      {isNavigating && directions[currentStep] && (
        <View style={styles.navigationPanelTop}>
          <TouchableOpacity style={styles.closeNavBtn} onPress={stopNavigation}>
            <MaterialIcons name="close" size={22} color="#fff" />
          </TouchableOpacity>
          <View style={styles.instructionBox}>
            <Text style={styles.instructionDistance}>
              {directions[currentStep].distance?.text || '0 m'}
            </Text>
            <Text style={styles.instructionText} numberOfLines={2}>
              {extractManeuver(directions[currentStep].html_instructions)}
            </Text>
            <Text style={styles.stepCounter}>
              {currentStep + 1} / {directions.length}
            </Text>
          </View>
        </View>
      )}

      {/* Przycisk wyszukiwania */}
      {!isNavigating && (
        <TouchableOpacity style={styles.topSearchButton} onPress={() => setSearchModalVisible(true)} activeOpacity={0.7}>
          <MaterialIcons name="search" size={20} color="#ffffff70" />
          <Text style={styles.topSearchButtonText}>Wyszukaj trasę</Text>
          <MaterialIcons name="tune" size={20} color="#ffffff70" />
        </TouchableOpacity>
      )}

      {/* Bottom sheet */}
      {!isNavigating && startLocation && endLocation && routeInfo && (
        <View style={styles.bottomSheet}>
          <View style={styles.expandHandle} />
          <View style={styles.infoPreview}>
            <View style={styles.routeInfoCard}>
              <View style={styles.routeInfoRow}>
                <View style={styles.routeInfoLocation}>
                  <View style={styles.routeInfoDot} />
                  <Text style={styles.routeInfoLocationName} numberOfLines={1}>
                    {startLocation.name || 'Początek'}
                  </Text>
                </View>
              </View>
              <View style={styles.routeInfoDivider} />
              <View style={styles.routeInfoRow}>
                <View style={styles.routeInfoLocation}>
                  <View style={[styles.routeInfoDot, { backgroundColor: '#e33835ce' }]} />
                  <Text style={styles.routeInfoLocationName} numberOfLines={1}>
                    {endLocation.name || 'Koniec'}
                  </Text>
                </View>
              </View>
            </View>
            <View style={styles.routeStatsRow}>
              <View style={styles.statItem}>
                <View style={styles.statIcon}>
                  <MaterialIcons name="straighten" size={16} color="#e33835ce" />
                </View>
                <View>
                  <Text style={styles.statLabel}>Dystans</Text>
                  <Text style={styles.statValue}>{routeInfo.distance} km</Text>
                </View>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.statItem}>
                <View style={styles.statIcon}>
                  <MaterialIcons name="schedule" size={16} color="#e33835ce" />
                </View>
                <View>
                  <Text style={styles.statLabel}>Czas</Text>
                  <Text style={styles.statValue}>{formatDuration(routeInfo.duration)}</Text>
                </View>
              </View>
            </View>
            <View style={styles.bottomSheetButtons}>
              <TouchableOpacity style={styles.navigateButton} onPress={startNavigation} activeOpacity={0.8}>
                <MaterialIcons name="navigation" size={18} color="#fff" />
                <Text style={styles.navigateButtonText}>Nawiguj</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.editButton} onPress={() => setSearchModalVisible(true)} activeOpacity={0.8}>
                <MaterialIcons name="edit" size={18} color="#e33835ce" />
              </TouchableOpacity>
              <TouchableOpacity style={styles.resetButtonSmall} onPress={handleReset} activeOpacity={0.8}>
                <MaterialIcons name="close" size={18} color="#ffffff70" />
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}

      {/* Empty state */}
      {!isNavigating && (!startLocation || !endLocation) && !searchModalVisible && (
        <View style={styles.emptyStateContainer}>
          <View style={styles.emptyState}>
            <MaterialIcons name="location-on" size={48} color="#e33835ce" />
            <Text style={styles.emptyTitle}>Wybierz trasę</Text>
          </View>
        </View>
      )}

      {/* Modale */}
      <SearchModal
        visible={searchModalVisible}
        onClose={() => setSearchModalVisible(false)}
        onSelectStart={handleSelectStart}
        onSelectEnd={handleSelectEnd}
        userLocation={userLocation}
        nearbyUsers={nearbyUsers}
      />
      <UserInfoModal
        visible={userInfoVisible}
        user={selectedUser}
        distance={selectedUser?.distance || 0}
        onNavigate={handleNavigateToUser}
        onClose={() => setUserInfoVisible(false)}
      />
      <SettingsModal
        visible={settingsVisible}
        mapType={mapType}
        onChangeMapType={setMapType}
        onClose={() => setSettingsVisible(false)}
      />
      <ReportModal
        visible={reportVisible}
        onClose={() => setReportVisible(false)}
      />
    </View>
  );
}