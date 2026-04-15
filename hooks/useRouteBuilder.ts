import { useState, useCallback, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_URL, GOOGLE_MAPS_APIKEY } from '../constants/mapConfig';
import { haversineKm } from '../scripts/navigationUtils';

export type RoutePin = {
  id:        string;
  latitude:  number;
  longitude: number;
  label:     string;
};

export function useRouteBuilder() {
  const [isBuilding,   setIsBuilding]   = useState(false);
  const [pins,         setPins]         = useState<RoutePin[]>([]);
  const [saving,       setSaving]       = useState(false);
  const [snapping,     setSnapping]     = useState(false);
  const [snappedRoute, setSnappedRoute] = useState<{ latitude: number; longitude: number }[]>([]);
  const counterRef = useRef(0);

  const startBuilding = useCallback(() => {
    setPins([]);
    setSnappedRoute([]);
    counterRef.current = 0;
    setIsBuilding(true);
  }, []);

  const cancelBuilding = useCallback(() => {
    setPins([]);
    setSnappedRoute([]);
    counterRef.current = 0;
    setIsBuilding(false);
  }, []);

  const rebuildLabels = (arr: RoutePin[]): RoutePin[] =>
    arr.map((p, i) => ({
      ...p,
      label: i === 0 ? 'Start' : i === arr.length - 1 ? 'Koniec' : `Punkt ${i + 1}`,
    }));

  const addPin = useCallback((lat: number, lng: number) => {
    counterRef.current += 1;
    setPins(prev => rebuildLabels([
      ...prev,
      { id: `pin_${Date.now()}`, latitude: lat, longitude: lng, label: '' },
    ]));
    setSnappedRoute([]);
  }, []);

  const removePin = useCallback((id: string) => {
    setPins(prev => rebuildLabels(prev.filter(p => p.id !== id)));
    setSnappedRoute([]);
  }, []);

  const finishPin = useCallback(() => {
    setPins(prev => rebuildLabels(prev));
  }, []);

  const snapToRoad = useCallback(async (pinsToSnap: RoutePin[]) => {
    if (pinsToSnap.length < 2) return;
    setSnapping(true);

    try {
      const segmentPromises: Promise<{ latitude: number; longitude: number }[]>[] = [];

      for (let i = 0; i < pinsToSnap.length - 1; i++) {
        const origin      = pinsToSnap[i];
        const destination = pinsToSnap[i + 1];

        const url =
          `https://maps.googleapis.com/maps/api/directions/json` +
          `?origin=${origin.latitude},${origin.longitude}` +
          `&destination=${destination.latitude},${destination.longitude}` +
          `&mode=driving` +
          `&key=${GOOGLE_MAPS_APIKEY}`;

        segmentPromises.push(
          fetch(url)
            .then(r => r.json())
            .then(json => {
              if (json.status !== 'OK' || !json.routes?.[0]) {
                return [
                  { latitude: origin.latitude,      longitude: origin.longitude },
                  { latitude: destination.latitude, longitude: destination.longitude },
                ];
              }
              return decodePolyline(json.routes[0].overview_polyline.points);
            })
            .catch(() => [
              { latitude: origin.latitude,      longitude: origin.longitude },
              { latitude: destination.latitude, longitude: destination.longitude },
            ])
        );
      }

      const segments = await Promise.all(segmentPromises);
      const merged: { latitude: number; longitude: number }[] = [];
      for (let i = 0; i < segments.length; i++) {
        merged.push(...(i === 0 ? segments[i] : segments[i].slice(1)));
      }

      setSnappedRoute(merged);
    } catch (e) {
      console.log('snapToRoad error:', e);
      setSnappedRoute(pinsToSnap.map(p => ({ latitude: p.latitude, longitude: p.longitude })));
    } finally {
      setSnapping(false);
    }
  }, []);

  function decodePolyline(encoded: string): { latitude: number; longitude: number }[] {
    const points: { latitude: number; longitude: number }[] = [];
    let index = 0, lat = 0, lng = 0;

    while (index < encoded.length) {
      let b: number, shift = 0, result = 0;
      do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
      lat += (result & 1) !== 0 ? ~(result >> 1) : result >> 1;

      shift = 0; result = 0;
      do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
      lng += (result & 1) !== 0 ? ~(result >> 1) : result >> 1;

      points.push({ latitude: lat / 1e5, longitude: lng / 1e5 });
    }
    return points;
  }

  const totalDistance = useCallback((ps: { latitude: number; longitude: number }[]) => {
    let d = 0;
    for (let i = 1; i < ps.length; i++) {
      d += haversineKm(ps[i-1].latitude, ps[i-1].longitude, ps[i].latitude, ps[i].longitude);
    }
    return Math.round(d * 100) / 100;
  }, []);

  // ── Zapis trasy — dodano isOffroad ────────────────────────
  const saveRoute = useCallback(async (
    name:        string,
    description: string,
    isPublic:    boolean,
    isOffroad:   boolean,   // ← NOWE
  ) => {
    if (pins.length < 2) return null;
    setSaving(true);
    try {
      const token = await AsyncStorage.getItem('token');
      if (!token) return null;

      // Offroad = zawsze surowe piny, nigdy snapped
      const pointsToSave = (!isOffroad && snappedRoute.length > 0)
        ? snappedRoute.map((p, i) => ({
            latitude:  p.latitude,
            longitude: p.longitude,
            label: i === 0 ? 'Start' : i === snappedRoute.length - 1 ? 'Koniec' : null,
          }))
        : pins.map(p => ({
            latitude:  p.latitude,
            longitude: p.longitude,
            label:     p.label,
          }));

      const dist = totalDistance(pointsToSave);

      const res = await fetch(`${API_URL}/api/routes`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          name, description, isPublic,
          isOffroad,          // ← NOWE
          distance: dist,
          points:   pointsToSave,
        }),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      cancelBuilding();
      return json;
    } catch (e) {
      console.log('saveRoute error:', e);
      return null;
    } finally {
      setSaving(false);
    }
  }, [pins, snappedRoute, cancelBuilding, totalDistance]);

  return {
    isBuilding, pins, saving, snapping, snappedRoute,
    startBuilding, cancelBuilding,
    addPin, removePin, finishPin, snapToRoad,
    totalDistance, saveRoute,
  };
}