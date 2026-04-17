import { useState, useEffect, useRef, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Toast from 'react-native-toast-message';
import * as Speech from 'expo-speech';
import * as Notifications from 'expo-notifications';
import { API_URL } from '../constants/mapConfig';
import { snapToRoute } from '../scripts/navigationUtils';

export interface LiveUser {
  id:        number;
  username:  string;
  avatarUrl: string | null;
  lat:       number;
  lng:       number;
  online:    boolean;
  isFriend?: boolean;
}

export interface LiveWarning {
  id:           number;
  type:         'traffic' | 'weather' | 'accident' | 'car_breakdown' | 'speed_control' | 'kosmici' | 'Animal';
  lat:          number;
  lng:          number;
  message:      string;
  createdAt:    string;
  expiresAt:    string;
  confirmCount: number;
  user:         { id: number; username: string; avatarUrl: string | null };
}

function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R    = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
    Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const PROXIMITY_THRESHOLD_M     = 500;
const FETCH_TIMEOUT_MS          = 8000;
const WARNING_VISIBLE_RADIUS_KM = 25;

async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs = FETCH_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer      = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}


export function useLiveMap(
  isSharing:       boolean,
  userLocation:    { latitude: number; longitude: number } | null,
  isSpeechEnabled: boolean,
) {
  const [liveUsers,       setLiveUsers]       = useState<LiveUser[]>([]);
  const [warnings,        setWarnings]        = useState<LiveWarning[]>([]);
  const [visibleWarnings, setVisibleWarnings] = useState<LiveWarning[]>([]);
  const [connected,       setConnected]       = useState(false);

  const socketRef          = useRef<Socket | null>(null);
  const tokenRef           = useRef<string | null>(null);
  const alertedWarningsRef = useRef<Set<number>>(new Set());
  const isSpeechRef        = useRef(isSpeechEnabled);
  const isSharingRef       = useRef(isSharing);
  const routePointsRef     = useRef<{ latitude: number; longitude: number }[]>([]);
  const userLocationRef    = useRef<{ latitude: number; longitude: number } | null>(null);

  const checkSingleWarningProximityRef = useRef<((w: LiveWarning) => void) | null>(null);

  useEffect(() => { userLocationRef.current = userLocation; },   [userLocation]);
  useEffect(() => { isSpeechRef.current     = isSpeechEnabled; }, [isSpeechEnabled]);
  useEffect(() => {
    isSharingRef.current = isSharing;
    if (!isSharing) setLiveUsers([]);
  }, [isSharing]);

  // ── Filtruj warnings do 25 km gdy zmienia się pozycja lub lista ──
  useEffect(() => {
    const src = warnings ?? [];
    if (!userLocation) {
      setVisibleWarnings(src);
      return;
    }
    const filtered = src.filter(w => {
      const km = distanceKm(
        userLocation.latitude,  userLocation.longitude,
        Number(w.lat),          Number(w.lng),
      );
      return km <= WARNING_VISIBLE_RADIUS_KM;
    });
    setVisibleWarnings(filtered);
  }, [userLocation?.latitude, userLocation?.longitude, warnings]);

  // ── Pobierz dane startowe ─────────────────────────────
  const fetchInitialData = useCallback(async (token: string) => {
    try {
      const [warningsRes, usersRes] = await Promise.all([
        fetchWithTimeout(`${API_URL}/api/live/warnings`, { headers: { Authorization: `Bearer ${token}` } }),
        fetchWithTimeout(`${API_URL}/api/live/users`,    { headers: { Authorization: `Bearer ${token}` } }),
      ]);
      if (warningsRes.ok) {
        const data = await warningsRes.json();
        setWarnings(Array.isArray(data) ? data : []);
      }
      if (usersRes.ok && isSharingRef.current) {
        const data = await usersRes.json();
        setLiveUsers(Array.isArray(data) ? data : []);
      }
    } catch (e) {
      console.log('fetchInitialData error:', e);
    }
  }, []);

  // ── Init Socket ───────────────────────────────────────
  useEffect(() => {
    (async () => {
      const token = await AsyncStorage.getItem('token');
      if (!token) return;
      tokenRef.current = token;

      const socket = io(API_URL, {
        auth:              { token },
        transports:        ['websocket'],
        reconnection:      true,
        reconnectionDelay: 2000,
        pingTimeout:       60000,
        pingInterval:      25000,
      });
      socketRef.current = socket;

      socket.on('connect', async () => {
        setConnected(true);
        fetchInitialData(token);
        try {
          await fetchWithTimeout(`${API_URL}/api/live/location/reset`, {
            method:  'POST',
            headers: { Authorization: `Bearer ${token}` },
          });
        } catch {}
        socket.emit('user:stop_sharing');
      });

      socket.on('disconnect', (reason) => {
        setConnected(false);
        if (reason === 'io server disconnect') socket.connect();
      });

      socket.on('connect_error', (err) => console.log('❌ connect_error:', err.message));

      socket.on('user:location', (data) => {
        if (!isSharingRef.current) return;
        setLiveUsers(prev => {
          const exists = prev.find(u => u.id === data.id);
          if (exists) return prev.map(u => u.id === data.id ? { ...u, ...data } : u);
          return [...prev, data];
        });
      });

      socket.on('user:offline', (data) => {
        setLiveUsers(prev => prev.filter(u => u.id !== data.id));
      });

      socket.on('warning:new', (warning: LiveWarning) => {
        setWarnings(prev => [warning, ...(prev ?? [])]);
        checkSingleWarningProximityRef.current?.(warning);
      });

      socket.on('warning:confirmed', ({ id, confirmCount, expiresAt }: any) => {
        setWarnings(prev =>
          (prev ?? []).map(w => w.id === id ? { ...w, confirmCount, expiresAt } : w),
        );
      });

      socket.on('warning:removed', ({ id }: any) => {
        setWarnings(prev => (prev ?? []).filter(w => w.id !== id));
        alertedWarningsRef.current.delete(id);
      });

      socket.on('warnings:cleanup', () => {
        const now = new Date();
        setWarnings(prev => {
          const src     = prev ?? [];
          const expired = src.filter(w => new Date(w.expiresAt) <= now);
          expired.forEach(w => alertedWarningsRef.current.delete(w.id));
          return src.filter(w => new Date(w.expiresAt) > now);
        });
      });

      await fetchInitialData(token);
    })();
    return () => { socketRef.current?.disconnect(); };
  }, [fetchInitialData]);

  // ── Proximity alert ───────────────────────────────────
  const triggerProximityAlert = useCallback((warning: LiveWarning, distM: number) => {
    alertedWarningsRef.current.add(warning.id);
    const label   = getWarningLabel(warning.type);
    const distTxt = distM < 1000 ? `${distM}m` : `${(distM / 1000).toFixed(1)}km`;
    const message = warning.message
      ? `${label}: ${warning.message} — ${distTxt} od Ciebie`
      : `${label} za ${distTxt}`;

    Toast.show({
      type:           'error',
      text1:          `⚠️ ${label.toUpperCase()}`,
      text2:          `${distTxt} od Ciebie${warning.message ? ` · ${warning.message}` : ''}`,
      visibilityTime: 5000,
    });
    if (isSpeechRef.current) {
      Speech.stop().catch(() => {});
      setTimeout(() => Speech.speak(message, { language: 'pl-PL', pitch: 1.0, rate: 0.88 }), 300);
    }
    Notifications.scheduleNotificationAsync({
      content: {
        title: `⚠️ ${label}`,
        body:  `${distTxt} od Twojej lokalizacji${warning.message ? ` · ${warning.message}` : ''}`,
        sound: true,
        data:  { warningId: warning.id, type: warning.type },
      },
      trigger: null,
    });
  }, []);

  const checkSingleWarningProximity = useCallback((warning: LiveWarning) => {
    const loc = userLocationRef.current;
    if (!loc) return;
    if (alertedWarningsRef.current.has(warning.id)) return;
    const distM = distanceKm(loc.latitude, loc.longitude, warning.lat, warning.lng) * 1000;
    if (distM <= PROXIMITY_THRESHOLD_M) triggerProximityAlert(warning, Math.round(distM));
  }, [triggerProximityAlert]);

  useEffect(() => {
    checkSingleWarningProximityRef.current = checkSingleWarningProximity;
  }, [checkSingleWarningProximity]);

  // ── Skanuj wszystkie warnings przy ruchu użytkownika ──
  useEffect(() => {
    if (!userLocation || !(warnings?.length)) return;
    const clustered = clusterWarnings(warnings);
    clustered.forEach(warning => {
      if (alertedWarningsRef.current.has(warning.id)) return;
      const distM = distanceKm(
        userLocation.latitude, userLocation.longitude,
        Number(warning.lat),   Number(warning.lng),
      ) * 1000;
      if (distM <= PROXIMITY_THRESHOLD_M) triggerProximityAlert(warning, Math.round(distM));
    });
  }, [userLocation?.latitude, userLocation?.longitude, warnings, triggerProximityAlert]);

  // ── Wyślij lokalizację ────────────────────────────────
  const sendLocation = useCallback((
    lat:          number,
    lng:          number,
    routePoints?: { latitude: number; longitude: number }[],
  ) => {
    if (!isSharing) return;
    const socket = socketRef.current;
    if (!socket?.connected) return;

    if (routePoints && routePoints.length > 1) routePointsRef.current = routePoints;

    const points = routePoints ?? routePointsRef.current;
    if (points.length > 1) {
      const snapped = snapToRoute(lat, lng, points, 30);
      socket.emit('location:update', { lat: snapped.latitude, lng: snapped.longitude });
    } else {
      socket.emit('location:update', { lat, lng });
    }
  }, [isSharing]);

  // ── Toggle sharing ────────────────────────────────────
  const toggleSharing = useCallback(async (): Promise<boolean> => {
    if (!tokenRef.current) return false;
    try {
      const res  = await fetchWithTimeout(`${API_URL}/api/live/location/toggle`, {
        method:  'POST',
        headers: { Authorization: `Bearer ${tokenRef.current}` },
      });
      const data = await res.json();
      if (data.shareLocation) {
        Toast.show({ type: 'success', text1: '📍 Lokalizacja widoczna', text2: 'Inni widzą Cię na mapie' });
      } else {
        Toast.show({ type: 'info', text1: '👁️ Lokalizacja ukryta', text2: 'Jesteś niewidoczny na mapie' });
        socketRef.current?.emit('user:stop_sharing');
      }
      return data.shareLocation;
    } catch { return false; }
  }, []);

  // ── Dodaj ostrzeżenie ─────────────────────────────────
  const addWarning = useCallback(async (
    type:         LiveWarning['type'],
    lat:          number,
    lng:          number,
    message?:     string,
    routePoints?: { latitude: number; longitude: number }[],
  ): Promise<void> => {
    if (!tokenRef.current) return;

    let snappedLat = lat;
    let snappedLng = lng;

    try {
      const points = routePoints ?? routePointsRef.current;
      if (points.length > 1) {
        const snapped = snapToRoute(lat, lng, points, 50);
        snappedLat = snapped.latitude;
        snappedLng = snapped.longitude;
      } else {
        // Brak punktów trasy — użyj surowej pozycji GPS
        snappedLat = lat;
        snappedLng = lng;
      }
    } catch (e) {
      console.log('warning snap error — using raw GPS:', e);
    }

    try {
      const res = await fetchWithTimeout(
        `${API_URL}/api/live/warnings`,
        {
          method:  'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization:  `Bearer ${tokenRef.current}`,
          },
          body: JSON.stringify({ type, lat: snappedLat, lng: snappedLng, message: message ?? '' }),
        },
        10000,
      );

      const data = await res.json();

      if (res.status === 429) {
        Toast.show({
          type:           'error',
          text1:          '⏱️ COOLDOWN',
          text2:          data.message ?? 'Poczekaj przed kolejnym zgłoszeniem',
          visibilityTime: 5000,
        });
        return;
      }
      if (!res.ok) {
        Toast.show({ type: 'error', text1: 'Błąd zgłaszania ostrzeżenia' });
        return;
      }
      if (data.merged) {
        Toast.show({
          type:           'info',
          text1:          '✅ POTWIERDZONO',
          text2:          'Twoje zgłoszenie wzmocniło istniejące ostrzeżenie',
          visibilityTime: 4000,
        });
      }
    } catch (e: any) {
      if (e.name === 'AbortError') {
        Toast.show({
          type:           'error',
          text1:          '⏱️ TIMEOUT',
          text2:          'Słaby internet — spróbuj ponownie',
          visibilityTime: 4000,
        });
      } else {
        Toast.show({ type: 'error', text1: 'Błąd połączenia' });
      }
    }
  }, []);

  // ── Potwierdź ostrzeżenie ─────────────────────────────
  const confirmWarning = useCallback(async (warningId: number): Promise<void> => {
    if (!tokenRef.current) return;
    try {
      const res  = await fetchWithTimeout(
        `${API_URL}/api/live/warnings/${warningId}/confirm`,
        { method: 'POST', headers: { Authorization: `Bearer ${tokenRef.current}` } },
      );
      const data = await res.json();
      if (!res.ok) {
        Toast.show({ type: 'info', text1: data.error ?? 'Nie można potwierdzić' });
        return;
      }
      Toast.show({ type: 'success', text1: '👍 POTWIERDZONO', text2: 'Ostrzeżenie aktywne jeszcze 15 min' });
    } catch (e: any) {
      if (e.name === 'AbortError') {
        Toast.show({ type: 'error', text1: '⏱️ TIMEOUT', text2: 'Słaby internet — spróbuj ponownie' });
      } else {
        Toast.show({ type: 'error', text1: 'Błąd połączenia' });
      }
    }
  }, []);

  const cancelWarning = useCallback(async (warningId: number): Promise<void> => {
    if (!tokenRef.current) return;
    try {
      const res = await fetchWithTimeout(
        `${API_URL}/api/live/warnings/${warningId}`,
        { method: 'DELETE', headers: { Authorization: `Bearer ${tokenRef.current}` } },
      );
      if (!res.ok) {
        const data = await res.json();
        Toast.show({ type: 'error', text1: data.error ?? 'Błąd usuwania' });
        return;
      }
      // socket 'warning:removed' sam zaktualizuje state
      Toast.show({ type: 'success', text1: '🗑️ ZGŁOSZENIE ANULOWANE' });
    } catch (e: any) {
      if (e.name === 'AbortError') {
        Toast.show({ type: 'error', text1: '⏱️ TIMEOUT', text2: 'Słaby internet — spróbuj ponownie' });
      } else {
        Toast.show({ type: 'error', text1: 'Błąd połączenia' });
      }
    }
  }, []);

  return {
    liveUsers,
    warnings: visibleWarnings,  // ← zawsze przefiltrowane do 25km
    connected,
    sendLocation,
    toggleSharing,
    addWarning,
    confirmWarning,
    cancelWarning,
  };
}

// ── Grupowanie ostrzeżeń ──────────────────────────────────
const CLUSTER_RADIUS_KM = 0.3;

export function clusterWarnings(warnings: LiveWarning[]): LiveWarning[] {
  if (!warnings?.length) return [];
  const result: LiveWarning[] = [];
  for (const warning of warnings) {
    const existing = result.find(r =>
      r.type === warning.type &&
      distanceKm(
        Number(r.lat), Number(r.lng),
        Number(warning.lat), Number(warning.lng),
      ) < CLUSTER_RADIUS_KM,
    );
    if (existing) {
      const idx = result.indexOf(existing);
      result[idx] = {
        ...existing,
        confirmCount: existing.confirmCount + warning.confirmCount,
        expiresAt:    new Date(existing.expiresAt) > new Date(warning.expiresAt)
          ? existing.expiresAt
          : warning.expiresAt,
      };
    } else {
      result.push({ ...warning });
    }
  }
  return result;
}

export function getWarningLabel(type: string): string {
  switch (type) {
    case 'traffic':       return 'Korek';
    case 'weather':       return 'Zła pogoda';
    case 'accident':      return 'Wypadek';
    case 'car_breakdown': return 'Awaria auta';
    case 'speed_control': return 'Kontrola prędkości';
    case 'kosmici':       return 'Kosmici';
    case 'Animal':        return 'Zwierzę na drodze';
    default:              return 'Ostrzeżenie';
  }
}

export function getWarningColor(type: string): string {
  switch (type) {
    case 'traffic':       return '#ff6b6b';
    case 'weather':       return '#ffd43b';
    case 'accident':      return '#ff922b';
    case 'car_breakdown': return '#748ffc';
    case 'speed_control': return '#0535f7';
    case 'kosmici':       return '#05f711';
    default:              return '#ffffff';
  }
}

export function getWarningIcon(type: string): string {
  switch (type) {
    case 'traffic':       return 'car-multiple';
    case 'weather':       return 'weather-lightning-rainy';
    case 'accident':      return 'car-emergency';
    case 'speed_control': return 'access-point';
    case 'kosmici':       return 'alien-outline';
    case 'car_breakdown': return 'car-wrench';
    default:              return 'alert-circle';
  }
}