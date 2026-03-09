    import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
    import * as Location from 'expo-location';
    import AsyncStorage from '@react-native-async-storage/async-storage';
    import Toast from 'react-native-toast-message';
    import { Spot, SpotCategory } from '../constants/spotTypes';

    const API_URL = 'https://v-room.app/api/spots';

    function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    export function useSpots() {
    const [userLocation, setUserLocation] = useState<{ latitude: number; longitude: number } | null>(null);
    const [region, setRegion]             = useState<any>(null);
    const [spots, setSpots]               = useState<Spot[]>([]);
    const [maxDistance, setMaxDistance]   = useState(25);
    const [loading, setLoading]           = useState(false);
    const locationInitialized             = useRef(false);

    // ── Pobierz lokalizację ──────────────────────────────────────────────────────
    useEffect(() => {
    (async () => {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
        Toast.show({ type: 'error', text1: 'BRAK DOSTĘPU', text2: 'Włącz lokalizację' });
        return;
        }
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        const { latitude, longitude } = loc.coords;
        setUserLocation({ latitude, longitude });
        setRegion({ latitude, longitude, latitudeDelta: 0.05, longitudeDelta: 0.05 });
        locationInitialized.current = true;
    })();
    }, []);

    // ── Pobierz spoty z API gdy lokalizacja gotowa lub zmienił się radius ────────
    const fetchSpots = useCallback(async (lat: number, lng: number, radius: number) => {
    try {
        setLoading(true);
        const res = await fetch(
        `${API_URL}?lat=${lat}&lng=${lng}&radius=${radius}`,
        );
        if (!res.ok) throw new Error('Błąd serwera');
        const data = await res.json();

        // Mapuj dane z API na lokalny typ Spot
        const mapped: Spot[] = data.map((s: any) => ({
        id:          String(s.id),
        name:        s.name,
        description: s.description || '',
        category:    s.category as SpotCategory,
        latitude:    s.latitude,
        longitude:   s.longitude,
        photos:      s.photos || [],
        author:      s.author?.username || 'Nieznany',
        createdAt:   s.createdAt?.split('T')[0] || '',
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

    // ── Widoczne spoty (już przefiltrowane przez API, ale lokalnie też filtrujemy) ─
    const visibleSpots = useMemo(() => {
    if (!userLocation) return [];
    return spots.filter(s =>
        calculateDistance(userLocation.latitude, userLocation.longitude, s.latitude, s.longitude) <= maxDistance
    );
    }, [spots, userLocation, maxDistance]);

    // ── Dodaj spot ───────────────────────────────────────────────────────────────
    const addSpot = useCallback(async (
        name: string,
        description: string,
        category: SpotCategory,
        photos: string[],
        pickedCoord?: { latitude: number; longitude: number } | null,
    ): Promise<boolean> => {
        if (!userLocation) return false;

        const lat = pickedCoord?.latitude  ?? userLocation.latitude;
        const lng = pickedCoord?.longitude ?? userLocation.longitude;

        try {
        const token = await AsyncStorage.getItem('userToken');

        const formData = new FormData();
        formData.append('name',        name.trim());
        formData.append('description', description.trim());
        formData.append('category',    category);
        formData.append('latitude',    String(lat));
        formData.append('longitude',   String(lng));

        photos.forEach((uri, i) => {
            const filename = uri.split('/').pop() || `photo_${i}.jpg`;
            const match    = /\.(\w+)$/.exec(filename);
            const type     = match ? `image/${match[1]}` : 'image/jpeg';
            formData.append('photos', { uri, name: filename, type } as any);
        });


        const res = await fetch(API_URL, {
            method:  'POST',
            headers: { Authorization: `Bearer ${token}` },
            body:    formData,
        });

        const data = await res.json();

        if (!res.ok) {
            Toast.show({ type: 'error', text1: 'BŁĄD', text2: data.error || 'Nie można dodać spotu' });
            return false;
        }

        const mapped: Spot = {
            id:            String(data.id),
            name:          data.name,
            description:   data.description || '',
            category:      data.category as SpotCategory,
            latitude:      data.latitude,
            longitude:     data.longitude,
            photos:        data.photos || [],
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
    addSpot,
    getDistance,
    loading,
    refetch: () => userLocation && fetchSpots(userLocation.latitude, userLocation.longitude, maxDistance),
    };
    }