import { useState, useCallback, useRef, useMemo } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Toast from 'react-native-toast-message';
import { API_URL, MAPBOX_TOKEN } from '../constants/mapConfig';
import { haversineKm } from '../scripts/navigationUtils';
import { fetchDirectionsViaProxy } from '../scripts/mapboxProxyClient';
import { compactRoutePolyline } from '../core/navigationCore';

export const MAX_ROUTE_PINS = 25;
const MAX_DISPLAY_POINTS = 400;
const MAX_SAVE_POINTS = 500;

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
  const segmentCacheRef = useRef<Map<string, { at: number; points: { latitude: number; longitude: number }[] }>>(new Map());

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
    setPins(prev => {
      if (prev.length >= MAX_ROUTE_PINS) {
        Toast.show({
          type: 'info',
          text1: 'Limit punktów',
          text2: `Maksymalnie ${MAX_ROUTE_PINS} punktów na trasę.`,
        });
        return prev;
      }
      counterRef.current += 1;
      return rebuildLabels([
        ...prev,
        { id: `pin_${Date.now()}`, latitude: lat, longitude: lng, label: '' },
      ]);
    });
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
      const segments: { latitude: number; longitude: number }[][] = [];

      for (let i = 0; i < pinsToSnap.length - 1; i++) {
        const origin      = pinsToSnap[i];
        const destination = pinsToSnap[i + 1];

        const url =
          `https://api.mapbox.com/directions/v5/mapbox/driving/` +
          `${origin.longitude},${origin.latitude};${destination.longitude},${destination.latitude}` +
          `?geometries=polyline&overview=full&steps=false&access_token=${MAPBOX_TOKEN}`;

        const segKey =
          `${Math.round(origin.latitude * 10000) / 10000},${Math.round(origin.longitude * 10000) / 10000}` +
          `->${Math.round(destination.latitude * 10000) / 10000},${Math.round(destination.longitude * 10000) / 10000}`;
        const cached = segmentCacheRef.current.get(segKey);
        if (cached && Date.now() - cached.at < 10 * 60_000) {
          segments.push(cached.points);
          continue;
        }

        let segPoints: { latitude: number; longitude: number }[];
        try {
          const json = await fetchDirectionsViaProxy<any>(
            {
              coordinates: [
                [origin.longitude, origin.latitude],
                [destination.longitude, destination.latitude],
              ],
              profile: 'driving',
              alternatives: false,
              geometries: 'polyline',
              steps: false,
              overview: 'full',
              language: 'pl',
            },
            url,
          );
          if (!json.routes?.[0]) {
            segPoints = [
              { latitude: origin.latitude, longitude: origin.longitude },
              { latitude: destination.latitude, longitude: destination.longitude },
            ];
          } else {
            segPoints = decodePolyline(json.routes[0].geometry);
            segmentCacheRef.current.set(segKey, { at: Date.now(), points: segPoints });
          }
        } catch {
          segPoints = [
            { latitude: origin.latitude, longitude: origin.longitude },
            { latitude: destination.latitude, longitude: destination.longitude },
          ];
        }
        segments.push(segPoints);
      }

      const merged: { latitude: number; longitude: number }[] = [];
      for (let i = 0; i < segments.length; i++) {
        merged.push(...(i === 0 ? segments[i] : segments[i].slice(1)));
      }

      const compacted = compactRoutePolyline(merged, MAX_DISPLAY_POINTS).map((p) => ({
        latitude: p.lat,
        longitude: p.lng,
      }));
      setSnappedRoute(compacted);
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
      const routePts = (!isOffroad && snappedRoute.length > 0) ? snappedRoute : pins.map(p => ({
        latitude: p.latitude,
        longitude: p.longitude,
      }));
      const savePoly = compactRoutePolyline(routePts, MAX_SAVE_POINTS).map((p, i, arr) => ({
        latitude: p.lat,
        longitude: p.lng,
        label: i === 0 ? 'Start' : i === arr.length - 1 ? 'Koniec' : null,
      }));

      const pointsToSave = (!isOffroad && snappedRoute.length > 0)
        ? savePoly
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

  const displaySnappedRoute = useMemo(
    () =>
      snappedRoute.length > MAX_DISPLAY_POINTS
        ? compactRoutePolyline(snappedRoute, MAX_DISPLAY_POINTS).map((p) => ({
            latitude: p.lat,
            longitude: p.lng,
          }))
        : snappedRoute,
    [snappedRoute],
  );

  return {
    isBuilding, pins, saving, snapping, snappedRoute, displaySnappedRoute,
    startBuilding, cancelBuilding,
    addPin, removePin, finishPin, snapToRoad,
    totalDistance, saveRoute, maxPins: MAX_ROUTE_PINS,
  };
}