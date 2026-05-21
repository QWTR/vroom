import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Platform } from 'react-native';
import * as Location from 'expo-location';
import AsyncStorage  from '@react-native-async-storage/async-storage';
import Toast         from 'react-native-toast-message';
import { Spot, SpotCategory } from '../constants/spotTypes';
import { loadMapLastLocation, saveMapLastLocation } from '../lib/mapLastLocation';

const API_URL           = 'https://v-room.app/api/spots';
const LAST_LOCATION_KEY = 'spots_last_location';
const SPOTS_MAX_ACCURACY_M = 140;

// Domyślna lokalizacja (Warszawa) — gdy brak zapisanej i GPS wolny
const DEFAULT_REGION = {
  latitude:      52.2297,
  longitude:     21.0122,
  latitudeDelta: 0.05,
  longitudeDelta: 0.05,
};

function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R    = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export type SortMode = 'distance' | 'likes' | 'newest';

export function useSpots() {
  const [userLocation, setUserLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [region,       setRegion]       = useState<any>(null);
  const [spots,        setSpots]        = useState<Spot[]>([]);
  const [maxDistance,  setMaxDistance]  = useState(25);
  const [loading,      setLoading]      = useState(false);

  const [activeCategories, setActiveCategories] = useState<SpotCategory[]>([]);
  const [sortMode,         setSortMode]         = useState<SortMode>('distance');

  const locationInitialized = useRef(false);

  const toggleCategory  = useCallback((cat: SpotCategory) => {
    setActiveCategories(prev =>
      prev.includes(cat) ? prev.filter(c => c !== cat) : [...prev, cat]
    );
  }, []);
  const clearCategories = useCallback(() => setActiveCategories([]), []);

  // ── Pobierz lokalizację ──────────────────────────────────────────────────────
  useEffect(() => {
    let mounted = true;
    let watchSub: Location.LocationSubscription | null = null;
    (async () => {
      // 1. Natychmiast pokaż ostatnią zapisaną lokalizację (mapa ładuje się od razu)
      try {
        const cached = await AsyncStorage.getItem(LAST_LOCATION_KEY);
        if (cached) {
          const { latitude, longitude } = JSON.parse(cached);
          if (!locationInitialized.current && mounted) {
            setRegion({ latitude, longitude, latitudeDelta: 0.05, longitudeDelta: 0.05 });
            setUserLocation({ latitude, longitude });
          }
        } else {
          const mapCached = await loadMapLastLocation();
          if (mapCached && mounted) {
            const { latitude, longitude } = mapCached;
            setRegion({ latitude, longitude, latitudeDelta: 0.05, longitudeDelta: 0.05 });
            setUserLocation({ latitude, longitude });
            locationInitialized.current = true;
          } else if (mounted) {
            // Brak cache — pokaż domyślny region żeby mapa się załadowała
            setRegion(DEFAULT_REGION);
          }
        }
      } catch {}

      // 2. Poproś o uprawnienia
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Toast.show({ type: 'error', text1: 'BRAK DOSTĘPU', text2: 'Włącz lokalizację' });
        return;
      }

      // 3. Spróbuj szybko z LastKnownPosition (natychmiastowe, bez GPS fix)
      try {
        const last = await Location.getLastKnownPositionAsync();
        if (last && !locationInitialized.current && mounted) {
          const { latitude, longitude } = last.coords;
          setUserLocation({ latitude, longitude });
          setRegion({ latitude, longitude, latitudeDelta: 0.05, longitudeDelta: 0.05 });
          locationInitialized.current = true;
          await AsyncStorage.setItem(LAST_LOCATION_KEY, JSON.stringify({ latitude, longitude }));
          await saveMapLastLocation(latitude, longitude, last.coords.accuracy ?? undefined);
        }
      } catch {}

      // 4. Dokładna pozycja GPS + ciągłe odświeżanie markera
      try {
        const loc = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        const { latitude, longitude, accuracy } = loc.coords;
        if (mounted && (accuracy == null || accuracy <= SPOTS_MAX_ACCURACY_M)) {
          setUserLocation({ latitude, longitude });
          setRegion({ latitude, longitude, latitudeDelta: 0.05, longitudeDelta: 0.05 });
          locationInitialized.current = true;
          await AsyncStorage.setItem(LAST_LOCATION_KEY, JSON.stringify({ latitude, longitude }));
          await saveMapLastLocation(latitude, longitude, accuracy ?? undefined);
        }

        watchSub = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.Balanced,
            timeInterval: 2500,
            distanceInterval: 6,
          },
          async (next) => {
            if (!mounted) return;
            const { latitude: nLat, longitude: nLng, accuracy: nAcc } = next.coords;
            if (!Number.isFinite(nLat) || !Number.isFinite(nLng)) return;
            if (nAcc != null && nAcc > SPOTS_MAX_ACCURACY_M) return;
            setUserLocation({ latitude: nLat, longitude: nLng });
            if (!locationInitialized.current) {
              setRegion({ latitude: nLat, longitude: nLng, latitudeDelta: 0.05, longitudeDelta: 0.05 });
              locationInitialized.current = true;
            }
            await AsyncStorage.setItem(LAST_LOCATION_KEY, JSON.stringify({ latitude: nLat, longitude: nLng }));
            await saveMapLastLocation(nLat, nLng, nAcc ?? undefined);
          },
        );
      } catch (e) {
        console.log('getCurrentPosition error:', e);
      }
    })();
    return () => {
      mounted = false;
      watchSub?.remove();
    };
  }, []);

  // ── Pobierz spoty z API ──────────────────────────────────────────────────────
  const fetchSpots = useCallback(async (lat: number, lng: number, radius: number) => {
    try {
      setLoading(true);
      const res  = await fetch(`${API_URL}?lat=${lat}&lng=${lng}&radius=${radius}`);
      if (!res.ok) throw new Error('Błąd serwera');
      const data = await res.json();

      const mapped: Spot[] = data.map((s: any) => ({
        id:            String(s.id),
        name:          s.name,
        description:   s.description   || '',
        category:      s.category      as SpotCategory,
        latitude:      s.latitude,
        longitude:     s.longitude,
        photos:        s.photos        || [],
        author:        s.author?.username || 'Nieznany',
        createdAt:     s.createdAt?.split('T')[0] || '',
        likesCount:    s.likesCount    ?? 0,
        commentsCount: s.commentsCount ?? 0,
        isLiked:       s.isLiked       ?? false,
      }));

      setSpots(mapped);
    } catch (e) {
      console.log('fetchSpots error:', e);
      Toast.show({ type: 'error', text1: 'BŁĄD', text2: 'Nie można pobrać spotów' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (userLocation) {
      fetchSpots(userLocation.latitude, userLocation.longitude, maxDistance);
    }
  }, [userLocation, maxDistance, fetchSpots]);

  // ── Widoczne spoty ───────────────────────────────────────────────────────────
  const visibleSpots = useMemo(() => {
    if (!userLocation) return [];

    let result = spots.filter(s =>
      calculateDistance(userLocation.latitude, userLocation.longitude, s.latitude, s.longitude) <= maxDistance
    );

    if (activeCategories.length > 0) {
      result = result.filter(s => activeCategories.includes(s.category));
    }

    switch (sortMode) {
      case 'distance':
        result = [...result].sort((a, b) =>
          calculateDistance(userLocation.latitude, userLocation.longitude, a.latitude, a.longitude) -
          calculateDistance(userLocation.latitude, userLocation.longitude, b.latitude, b.longitude)
        );
        break;
      case 'likes':
        result = [...result].sort((a, b) => b.likesCount - a.likesCount);
        break;
      case 'newest':
        result = [...result].sort((a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );
        break;
    }

    return result;
  }, [spots, userLocation, maxDistance, activeCategories, sortMode]);

  // ── Dodaj spot ───────────────────────────────────────────────────────────────
  const addSpot = useCallback(async (
    name:        string,
    description: string,
    category:    SpotCategory,
    photos:      string[],
    pickedCoord?: { latitude: number; longitude: number } | null,
  ): Promise<boolean> => {
    if (!userLocation) return false;

    const lat = pickedCoord?.latitude  ?? userLocation.latitude;
    const lng = pickedCoord?.longitude ?? userLocation.longitude;

    try {
      const token = await AsyncStorage.getItem('token');

      const formData = new FormData();
      formData.append('name',        name.trim());
      formData.append('description', description.trim());
      formData.append('category',    category);
      formData.append('latitude',    String(lat));
      formData.append('longitude',   String(lng));

      photos.forEach((uri, i) => {
        const filename = uri.split('/').pop() || `photo_${i}.jpg`;
        const ext      = /\.(\w+)$/.exec(filename)?.[1]?.toLowerCase() || 'jpg';
        const type     = ext === 'png'  ? 'image/png'
                       : ext === 'heic' ? 'image/heic'
                       : 'image/jpeg';

        const fileUri = Platform.OS === 'ios'
          ? uri.replace('file://', '')
          : uri;

        formData.append('photos', { uri: fileUri, name: filename, type } as any);
      });

      const res = await fetch(API_URL, {
        method:  'POST',
        headers: { Authorization: `Bearer ${token}` },
        body:    formData,
      });

      const contentType = res.headers.get('content-type') ?? '';
      if (!contentType.includes('application/json')) {
        const text = await res.text();
        console.log('❌ Serwer nie-JSON:', res.status, text.slice(0, 300));
        Toast.show({ type: 'error', text1: 'BŁĄD SERWERA', text2: `HTTP ${res.status}` });
        return false;
      }

      const data = await res.json();
      if (!res.ok) {
        Toast.show({ type: 'error', text1: 'BŁĄD', text2: data.error || 'Nie można dodać spotu' });
        return false;
      }

      const mapped: Spot = {
        id:            String(data.id),
        name:          data.name,
        description:   data.description  || '',
        category:      data.category     as SpotCategory,
        latitude:      data.latitude,
        longitude:     data.longitude,
        photos:        data.photos        || [],
        author:        data.author?.username || 'Ja',
        createdAt:     data.createdAt?.split('T')[0] || '',
        likesCount:    0,
        commentsCount: 0,
        isLiked:       false,
      };

      setSpots(prev => [mapped, ...prev]);
      Toast.show({ type: 'success', text1: '✅ SPOT DODANY!', text2: mapped.name });
      return true;

    } catch (e: any) {
      console.log('❌ addSpot error:', e?.message, e);
      Toast.show({ type: 'error', text1: 'BŁĄD', text2: 'Nie można połączyć się z serwerem' });
      return false;
    }
  }, [userLocation]);

  // ── Dystans do spotu ─────────────────────────────────────────────────────────
  const getDistance = useCallback((spot: Spot): number => {
    if (!userLocation) return 0;
    return calculateDistance(userLocation.latitude, userLocation.longitude, spot.latitude, spot.longitude);
  }, [userLocation]);

  return {
    userLocation,
    region,
    spots,
    visibleSpots,
    maxDistance,
    setMaxDistance,
    activeCategories,
    toggleCategory,
    clearCategories,
    sortMode,
    setSortMode,
    addSpot,
    getDistance,
    loading,
    refetch: () => userLocation && fetchSpots(userLocation.latitude, userLocation.longitude, maxDistance),
  };
}