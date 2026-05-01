import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import Mapbox from '@rnmapbox/maps';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useTheme } from '../../contexts/ThemeContext';
import { MAPBOX_STYLE_DARK, MAPBOX_STYLE_LIGHT, MAPBOX_TOKEN } from '../../constants/mapConfig';
import { useProfile } from '../../hooks/useProfile';

Mapbox.setAccessToken(MAPBOX_TOKEN);

const MAX_HISTORY_ROUTES_ON_MAP = 20;
const MAX_POINTS_PER_ROUTE_ON_MAP = 180;

function sanitizeAndDownsampleRoutePoints(points: any[]): [number, number][] {
  const valid: [number, number][] = (points || [])
    .map((p: any) => [Number(p?.longitude), Number(p?.latitude)] as [number, number])
    .filter(([lng, lat]) =>
      Number.isFinite(lat) &&
      Number.isFinite(lng) &&
      lat >= -90 &&
      lat <= 90 &&
      lng >= -180 &&
      lng <= 180,
    );
  if (valid.length <= MAX_POINTS_PER_ROUTE_ON_MAP) return valid;
  const step = Math.ceil(valid.length / MAX_POINTS_PER_ROUTE_ON_MAP);
  const sampled = valid.filter((_, idx) => idx % step === 0);
  const last = valid[valid.length - 1];
  if (!sampled.length || sampled[sampled.length - 1][0] !== last[0] || sampled[sampled.length - 1][1] !== last[1]) {
    sampled.push(last);
  }
  return sampled;
}

export default function HistoryRidesScreen() {
  const router = useRouter();
  const { theme, isDark } = useTheme();
  const { activityHistory, fetchActivityHistory } = useProfile();
  const [loading, setLoading] = useState(true);
  const [showAllHistoryOnMap, setShowAllHistoryOnMap] = useState(true);
  const [selectedHistoryRoute, setSelectedHistoryRoute] = useState<any | null>(null);
  const [historyMapEnabled, setHistoryMapEnabled] = useState(false);

  useEffect(() => {
    (async () => {
      setLoading(true);
      await fetchActivityHistory({ includeRoute: true });
      setLoading(false);
    })();
  }, [fetchActivityHistory]);

  const historyWithRoute = useMemo(
    () => activityHistory.filter((a: any) => (a?.routePoints?.length ?? 0) > 1),
    [activityHistory],
  );

  const mapHistoryItems = showAllHistoryOnMap
    ? historyWithRoute.slice(0, MAX_HISTORY_ROUTES_ON_MAP)
    : (selectedHistoryRoute && (selectedHistoryRoute?.routePoints?.length ?? 0) > 1 ? [selectedHistoryRoute] : []);

  const mapHistoryShapes = mapHistoryItems
    .map((item: any) => ({
      id: item.id,
      coordinates: sanitizeAndDownsampleRoutePoints(item.routePoints || []),
    }))
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

  const historyInitialCenter = mapHistoryShapes.length > 0
    ? mapHistoryShapes[0].coordinates[0]
    : null;

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
              styleURL={isDark ? MAPBOX_STYLE_DARK : MAPBOX_STYLE_LIGHT}
              logoEnabled={false}
              attributionEnabled={false}
              pitchEnabled={false}
              rotateEnabled={false}
            >
              <Mapbox.Camera
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
          ) : activityHistory.map((a: any) => {
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
                  {new Date(a.createdAt).toLocaleDateString('pl-PL')} · {Math.round(a.distance || 0)} km
                </Text>
                <Text style={{ fontFamily: 'Orbitron', fontSize: 7, color: theme.textDim, marginTop: 4 }}>
                  Max: {Math.round(a.maxSpeed || 0)} km/h · Avg: {Math.round(a.avgSpeed || 0)} km/h
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
