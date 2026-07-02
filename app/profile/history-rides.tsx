import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import Mapbox from '@rnmapbox/maps';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useTheme } from '../../contexts/ThemeContext';
import { resolveStandardMapStyle, MAPBOX_TOKEN } from '../../constants/mapConfig';
import { useProfile } from '../../hooks/useProfile';
import { snapHistoryRouteToRoad } from '../../scripts/snapHistoryRoute';
import { filterVisibleRideHistory } from '../../lib/activityHistoryFilter';

Mapbox.setAccessToken(MAPBOX_TOKEN);

const MAX_HISTORY_ROUTES_ON_MAP = 20;
const MAX_POINTS_PER_ROUTE_ON_MAP = 500;
const HISTORY_SANITIZE_MAX_JUMP_KM = 0.2;

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
    Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function perpendicularDistanceMeters(
  point: [number, number],
  lineStart: [number, number],
  lineEnd: [number, number],
): number {
  const [px, py] = point;
  const [x1, y1] = lineStart;
  const [x2, y2] = lineEnd;
  const dx = x2 - x1;
  const dy = y2 - y1;
  if (dx === 0 && dy === 0) return haversineKm(py, px, y1, x1) * 1000;
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)));
  const projX = x1 + t * dx;
  const projY = y1 + t * dy;
  return haversineKm(py, px, projY, projX) * 1000;
}

function simplifyDouglasPeucker(points: [number, number][], epsilonMeters: number): [number, number][] {
  if (points.length <= 2) return points;
  let maxDistance = 0;
  let index = 0;
  const end = points.length - 1;
  for (let i = 1; i < end; i += 1) {
    const d = perpendicularDistanceMeters(points[i], points[0], points[end]);
    if (d > maxDistance) {
      maxDistance = d;
      index = i;
    }
  }
  if (maxDistance <= epsilonMeters) {
    return [points[0], points[end]];
  }
  const left = simplifyDouglasPeucker(points.slice(0, index + 1), epsilonMeters);
  const right = simplifyDouglasPeucker(points.slice(index), epsilonMeters);
  return [...left.slice(0, -1), ...right];
}

function sanitizeAndDownsampleRoutePoints(points: any[]): [number, number][] {
  const sorted = (points || []).slice().sort((a: any, b: any) => {
    const oa = Number(a?.order ?? 0);
    const ob = Number(b?.order ?? 0);
    return oa - ob;
  });
  const valid: [number, number][] = sorted
    .map((p: any) => [Number(p?.longitude), Number(p?.latitude)] as [number, number])
    .filter(([lng, lat]) =>
      Number.isFinite(lat) &&
      Number.isFinite(lng) &&
      lat >= -90 &&
      lat <= 90 &&
      lng >= -180 &&
      lng <= 180,
    );
  if (valid.length === 0) return [];

  const sanitized: [number, number][] = [valid[0]];
  for (let i = 1; i < valid.length; i += 1) {
    const [lng, lat] = valid[i];
    const prev = sanitized[sanitized.length - 1];
    const jumpKm = haversineKm(prev[1], prev[0], lat, lng);
    if (!Number.isFinite(jumpKm)) continue;
    if (jumpKm > HISTORY_SANITIZE_MAX_JUMP_KM) continue;
    sanitized.push([lng, lat]);
  }

  if (sanitized.length <= MAX_POINTS_PER_ROUTE_ON_MAP) return sanitized;
  const epsilonMeters = 3;
  let simplified = simplifyDouglasPeucker(sanitized, epsilonMeters);
  if (simplified.length <= MAX_POINTS_PER_ROUTE_ON_MAP) return simplified;
  const step = Math.ceil(simplified.length / MAX_POINTS_PER_ROUTE_ON_MAP);
  simplified = simplified.filter((_, idx) => idx % step === 0);
  const last = sanitized[sanitized.length - 1];
  if (!simplified.length || simplified[simplified.length - 1][0] !== last[0] || simplified[simplified.length - 1][1] !== last[1]) {
    simplified.push(last);
  }
  return simplified;
}

export default function HistoryRidesScreen() {
  const router = useRouter();
  const { theme, isDark, presetId } = useTheme();
  const { activityHistory, fetchActivityHistory } = useProfile();
  const cameraRef = useRef<any>(null);
  const [loading, setLoading] = useState(true);
  const [showAllHistoryOnMap, setShowAllHistoryOnMap] = useState(true);
  const [selectedHistoryRoute, setSelectedHistoryRoute] = useState<any | null>(null);
  const [historyMapEnabled, setHistoryMapEnabled] = useState(false);
  const [snappedCoordsById, setSnappedCoordsById] = useState<Record<number, [number, number][]>>({});

  useEffect(() => {
    (async () => {
      setLoading(true);
      await fetchActivityHistory({ includeRoute: true, allPages: true, limit: 50 });
      setLoading(false);
    })();
  }, [fetchActivityHistory]);

  useEffect(() => {
    if (showAllHistoryOnMap) return;
    const item = selectedHistoryRoute;
    if (!item?.id) return;
    const raw = sanitizeAndDownsampleRoutePoints(item.routePoints || []);
    if (raw.length < 2) return;
    let cancelled = false;
    (async () => {
      const snapped = await snapHistoryRouteToRoad(raw);
      if (!cancelled) {
        setSnappedCoordsById(prev => {
          if (prev[item.id]) return prev;
          return { ...prev, [item.id]: snapped };
        });
      }
    })();
    return () => { cancelled = true; };
  }, [selectedHistoryRoute?.id, showAllHistoryOnMap]);

  const historyWithRoute = useMemo(
    () => filterVisibleRideHistory(activityHistory).filter((a: any) => (a?.routePoints?.length ?? 0) > 1),
    [activityHistory],
  );
  const visibleActivityHistory = useMemo(
    () => filterVisibleRideHistory(activityHistory),
    [activityHistory],
  );

  const mapHistoryItems = showAllHistoryOnMap
    ? historyWithRoute.slice(0, MAX_HISTORY_ROUTES_ON_MAP)
    : (selectedHistoryRoute && (selectedHistoryRoute?.routePoints?.length ?? 0) > 1 ? [selectedHistoryRoute] : []);

  const mapHistoryShapes = mapHistoryItems
    .map((item: any) => {
      const sanitized = sanitizeAndDownsampleRoutePoints(item.routePoints || []);
      const coordinates = !showAllHistoryOnMap && snappedCoordsById[item.id]?.length
        ? snappedCoordsById[item.id]
        : sanitized;
      return {
        id: item.id,
        coordinates,
      };
    })
    .filter((shape: any) => shape.coordinates.length > 1);

  const historyShapeGeoJson = useMemo(() => {
    if (mapHistoryShapes.length === 0) return null;
    if (!showAllHistoryOnMap) {
      return {
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: mapHistoryShapes[0].coordinates },
        properties: {},
      } as any;
    }
    return {
      type: 'Feature',
      geometry: { type: 'MultiLineString', coordinates: mapHistoryShapes.map((s: any) => s.coordinates) },
      properties: {},
    } as any;
  }, [mapHistoryShapes, showAllHistoryOnMap]);

  const mapBounds = useMemo(() => {
    if (mapHistoryShapes.length === 0) return null;
    let minLng = Infinity;
    let minLat = Infinity;
    let maxLng = -Infinity;
    let maxLat = -Infinity;
    for (const shape of mapHistoryShapes) {
      for (const [lng, lat] of shape.coordinates) {
        if (lng < minLng) minLng = lng;
        if (lat < minLat) minLat = lat;
        if (lng > maxLng) maxLng = lng;
        if (lat > maxLat) maxLat = lat;
      }
    }
    if (!Number.isFinite(minLng) || !Number.isFinite(minLat) || !Number.isFinite(maxLng) || !Number.isFinite(maxLat)) {
      return null;
    }
    return {
      ne: [maxLng, maxLat] as [number, number],
      sw: [minLng, minLat] as [number, number],
    };
  }, [mapHistoryShapes]);

  const historyInitialCenter = mapHistoryShapes.length > 0
    ? mapHistoryShapes[0].coordinates[0]
    : null;

  useEffect(() => {
    if (!historyMapEnabled || !mapBounds) return;
    setTimeout(() => {
      cameraRef.current?.fitBounds(mapBounds.ne, mapBounds.sw, 32, 500);
    }, 80);
  }, [historyMapEnabled, mapBounds, showAllHistoryOnMap, selectedHistoryRoute?.id]);

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingTop: 54, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: theme.border }}>
        <TouchableOpacity onPress={() => router.back()} style={{ marginRight: 10, width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.surface }}>
          <MaterialIcons name="arrow-back" size={20} color={theme.text} />
        </TouchableOpacity>
        <Text style={{ fontFamily: 'Orbitron', fontSize: 11, color: theme.text }}>HISTORIA PRZEJAZDOW</Text>
      </View>

      <View style={{ padding: 14, gap: 10 }}>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <TouchableOpacity
            style={{ flex: 1, borderRadius: 10, paddingVertical: 9, alignItems: 'center', borderWidth: 1, borderColor: showAllHistoryOnMap ? '#268bff40' : theme.border, backgroundColor: showAllHistoryOnMap ? '#268bff18' : theme.surface }}
            onPress={() => { setShowAllHistoryOnMap(true); setSelectedHistoryRoute(null); }}
          >
            <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: showAllHistoryOnMap ? '#268bff' : theme.textDim }}>POKAZ WSZYSTKO</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={{ borderRadius: 10, paddingVertical: 9, paddingHorizontal: 12, alignItems: 'center', borderWidth: 1, borderColor: historyMapEnabled ? '#4de92640' : theme.border, backgroundColor: historyMapEnabled ? '#4de92618' : theme.surface }}
            onPress={() => setHistoryMapEnabled(v => !v)}
          >
            <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: historyMapEnabled ? '#4de926' : theme.textDim }}>
              {historyMapEnabled ? 'UKRYJ MAPE' : 'POKAZ MAPE'}
            </Text>
          </TouchableOpacity>
        </View>

        <View style={{ height: 260, borderRadius: 14, overflow: 'hidden', borderWidth: 1, borderColor: theme.border }}>
          {historyMapEnabled && historyShapeGeoJson && historyInitialCenter ? (
            <Mapbox.MapView
              style={{ flex: 1 }}
              styleURL={resolveStandardMapStyle(isDark, presetId)}
              logoEnabled={false}
              attributionEnabled={false}
              pitchEnabled={false}
              rotateEnabled={false}
            >
              <Mapbox.Camera
                ref={cameraRef}
                defaultSettings={{ centerCoordinate: historyInitialCenter, zoomLevel: 12 }}
                animationDuration={0}
              />
              <Mapbox.ShapeSource id="history-routes-source-screen" shape={historyShapeGeoJson}>
                <Mapbox.LineLayer
                  id="history-routes-layer-screen"
                  style={{
                    lineColor: showAllHistoryOnMap ? '#e33835aa' : '#e33835',
                    lineWidth: showAllHistoryOnMap ? 3 : 5,
                    lineCap: 'round',
                    lineJoin: 'round',
                  }}
                />
              </Mapbox.ShapeSource>
            </Mapbox.MapView>
          ) : (
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.surface }}>
              <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: theme.textDim }}>
                {loading ? 'Ladowanie historii...' : historyShapeGeoJson ? 'Kliknij POKAZ MAPE' : 'Brak danych tras do mapy'}
              </Text>
            </View>
          )}
        </View>

        {showAllHistoryOnMap && historyWithRoute.length > MAX_HISTORY_ROUTES_ON_MAP && (
          <Text style={{ fontFamily: 'Orbitron', fontSize: 7, color: theme.textDim }}>
            Na mapie pokazano ostatnie {MAX_HISTORY_ROUTES_ON_MAP} tras.
          </Text>
        )}

        <ScrollView style={{ maxHeight: 320 }} showsVerticalScrollIndicator={false}>
          {loading ? (
            <ActivityIndicator color="#e33835" style={{ marginTop: 20 }} />
          ) : visibleActivityHistory.map((a: any) => {
            const hasRoute = (a?.routePoints?.length ?? 0) > 1;
            const selected = !showAllHistoryOnMap && selectedHistoryRoute?.id === a.id;
            return (
              <TouchableOpacity
                key={a.id}
                style={{
                  backgroundColor: selected ? '#e3383515' : theme.surface,
                  borderWidth: 1,
                  borderColor: selected ? '#e3383540' : theme.border,
                  borderRadius: 10,
                  padding: 10,
                  marginBottom: 8,
                }}
                onPress={() => {
                  if (!hasRoute) return;
                  setSelectedHistoryRoute(a);
                  setShowAllHistoryOnMap(false);
                }}
                activeOpacity={0.8}
              >
                <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: theme.text }}>
                  {new Date(a.createdAt).toLocaleDateString('pl-PL')} · {Number(a.distance || 0).toFixed(1)} km
                </Text>
                <Text style={{ fontFamily: 'Orbitron', fontSize: 7, color: theme.textDim, marginTop: 4 }}>
                  Max: {Number(a.maxSpeed || 0).toFixed(1)} km/h · Avg: {Number(a.avgSpeed || 0).toFixed(1)} km/h
                </Text>
                {!hasRoute && (
                  <Text style={{ fontFamily: 'Orbitron', fontSize: 7, color: '#ff922b', marginTop: 4 }}>
                    Brak zapisanego sladu mapy dla tego przejazdu.
                  </Text>
                )}
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>
    </View>
  );
}
