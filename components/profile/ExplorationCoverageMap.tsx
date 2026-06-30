import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Text, TouchableOpacity, View } from 'react-native';
import Mapbox from '@rnmapbox/maps';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '../../contexts/ThemeContext';
import { fetchCoverageCells, type CoverageCell } from '../../lib/gamificationClient';

type Props = {
  userId?: number | null;
  limit?: number;
  height?: number;
  interactive?: boolean;
  autoRefreshMs?: number;
};

const POLAND_CENTER: [number, number] = [19.1451, 51.9194];
const MIN_ZOOM = 3.8;
const MAX_ZOOM = 16.5;

function getCameraForCells(cells: CoverageCell[]): { center: [number, number]; zoom: number } {
  if (!cells.length) return { center: POLAND_CENTER, zoom: 4.55 };

  let minLat = 90;
  let maxLat = -90;
  let minLng = 180;
  let maxLng = -180;

  for (const cell of cells) {
    const lat = Number(cell.center?.lat);
    const lng = Number(cell.center?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
    minLng = Math.min(minLng, lng);
    maxLng = Math.max(maxLng, lng);
  }

  if (minLat === 90 || minLng === 180) return { center: POLAND_CENTER, zoom: 4.55 };

  const latSpan = Math.max(0.001, maxLat - minLat);
  const lngSpan = Math.max(0.001, maxLng - minLng);
  const span = Math.max(latSpan, lngSpan);
  const zoom = span > 3 ? 5.2 : span > 1.4 ? 6.3 : span > 0.55 ? 7.5 : span > 0.18 ? 9 : 11.2;

  return {
    center: [(minLng + maxLng) / 2, (minLat + maxLat) / 2],
    zoom,
  };
}

export function ExplorationCoverageMap({
  userId,
  limit = 700,
  height = 170,
  interactive = false,
  autoRefreshMs = 0,
}: Props) {
  const { theme, isDark } = useTheme();
  const [cells, setCells] = useState<CoverageCell[]>([]);
  const [loading, setLoading] = useState(true);
  const [mapControlEnabled, setMapControlEnabled] = useState(false);
  const [manualCamera, setManualCamera] = useState<{ center: [number, number]; zoom: number } | null>(null);

  const loadCells = useCallback((silent = false) => {
    let cancelled = false;
    if (!silent) setLoading(true);
    fetchCoverageCells({ userId: userId ?? undefined, limit })
      .then((next) => {
        if (!cancelled) setCells(next);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [limit, userId]);

  useEffect(() => loadCells(), [loadCells]);

  useEffect(() => {
    if (!autoRefreshMs || autoRefreshMs < 3000) return undefined;
    const timer = setInterval(() => {
      fetchCoverageCells({ userId: userId ?? undefined, limit })
        .then((next) => setCells(next))
        .catch(() => undefined);
    }, autoRefreshMs);
    return () => clearInterval(timer);
  }, [autoRefreshMs, limit, userId]);

  const shape = useMemo(() => ({
    type: 'FeatureCollection' as const,
    features: cells
      .filter((cell) => Array.isArray(cell.polygon) && cell.polygon.length >= 4)
      .map((cell) => ({
        type: 'Feature' as const,
        id: cell.cellId,
        properties: { cellId: cell.cellId },
        geometry: {
          type: 'Polygon' as const,
          coordinates: [cell.polygon],
        },
      })),
  }), [cells]);

  const camera = useMemo(() => getCameraForCells(cells), [cells]);
  const visibleCamera = manualCamera ?? camera;

  useEffect(() => {
    if (!mapControlEnabled) setManualCamera(null);
  }, [camera.center[0], camera.center[1], camera.zoom, mapControlEnabled]);

  const setZoom = useCallback((direction: 1 | -1) => {
    setManualCamera((current) => {
      const base = current ?? camera;
      const nextZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, base.zoom + direction * 1.1));
      return { ...base, zoom: nextZoom };
    });
  }, [camera]);

  const resetView = useCallback(() => {
    setManualCamera({ center: camera.center, zoom: camera.zoom });
  }, [camera]);

  const handleCameraChanged = useCallback((event: any) => {
    if (!mapControlEnabled) return;
    const center = event?.properties?.center;
    const zoom = Number(event?.properties?.zoom);
    if (Array.isArray(center) && center.length >= 2 && Number.isFinite(zoom)) {
      setManualCamera({
        center: [Number(center[0]), Number(center[1])],
        zoom: Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom)),
      });
    }
  }, [mapControlEnabled]);

  return (
    <View
      style={{
        height,
        borderRadius: 18,
        overflow: 'hidden',
        borderWidth: 1,
        borderColor: theme.border,
        backgroundColor: isDark ? '#050505' : '#111',
      }}
      pointerEvents={interactive ? 'auto' : 'none'}
    >
      <Mapbox.MapView
        style={{ flex: 1 }}
        styleURL={isDark ? Mapbox.StyleURL.Dark : Mapbox.StyleURL.Light}
        scaleBarEnabled={false}
        compassEnabled={false}
        logoEnabled={false}
        attributionEnabled={false}
        scrollEnabled={interactive && mapControlEnabled}
        zoomEnabled={interactive && mapControlEnabled}
        pitchEnabled={false}
        rotateEnabled={false}
        onCameraChanged={handleCameraChanged}
      >
        <Mapbox.Camera
          zoomLevel={visibleCamera.zoom}
          centerCoordinate={visibleCamera.center}
          animationMode="flyTo"
          animationDuration={450}
        />
        {shape.features.length > 0 ? (
          <Mapbox.ShapeSource id={`exploration-coverage-${userId ?? 'me'}`} shape={shape as any}>
            <Mapbox.FillLayer
              id={`exploration-coverage-fill-${userId ?? 'me'}`}
              style={{
                fillColor: theme.primary,
                fillOpacity: 0.9,
                fillOutlineColor: theme.primary,
              }}
            />
            <Mapbox.LineLayer
              id={`exploration-coverage-line-${userId ?? 'me'}`}
              style={{
                lineColor: isDark ? '#ffffff' : theme.primary,
                lineOpacity: 0.95,
                lineWidth: 2.2,
              }}
            />
          </Mapbox.ShapeSource>
        ) : null}
      </Mapbox.MapView>

      {interactive && shape.features.length > 0 ? (
        <>
          {!mapControlEnabled ? (
            <TouchableOpacity
              activeOpacity={0.9}
              onPress={() => setMapControlEnabled(true)}
              style={{
                position: 'absolute',
                right: 10,
                top: 10,
                borderRadius: 999,
                paddingHorizontal: 11,
                paddingVertical: 8,
                backgroundColor: '#000000cc',
                borderWidth: 1,
                borderColor: theme.primaryBorder,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <MaterialCommunityIcons name="gesture-tap" size={16} color={theme.primary} />
              <Text style={{ color: theme.text, fontSize: 10, fontWeight: '900' }}>STERUJ</Text>
            </TouchableOpacity>
          ) : (
            <View
              style={{
                position: 'absolute',
                right: 10,
                top: 10,
                gap: 8,
                alignItems: 'flex-end',
              }}
              pointerEvents="box-none"
            >
              <TouchableOpacity
                onPress={() => setMapControlEnabled(false)}
                style={{
                  borderRadius: 999,
                  paddingHorizontal: 11,
                  paddingVertical: 8,
                  backgroundColor: '#000000d9',
                  borderWidth: 1,
                  borderColor: theme.border,
                }}
              >
                <Text style={{ color: theme.text, fontSize: 10, fontWeight: '900' }}>GOTOWE</Text>
              </TouchableOpacity>
              <View style={{ borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: theme.border, backgroundColor: '#000000d9' }}>
                <TouchableOpacity onPress={() => setZoom(1)} style={{ width: 42, height: 38, alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ color: theme.text, fontSize: 22, fontWeight: '900', lineHeight: 24 }}>+</Text>
                </TouchableOpacity>
                <View style={{ height: 1, backgroundColor: theme.border }} />
                <TouchableOpacity onPress={() => setZoom(-1)} style={{ width: 42, height: 38, alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ color: theme.text, fontSize: 24, fontWeight: '900', lineHeight: 24 }}>-</Text>
                </TouchableOpacity>
              </View>
              <TouchableOpacity
                onPress={resetView}
                style={{
                  width: 42,
                  height: 38,
                  borderRadius: 14,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: '#000000d9',
                  borderWidth: 1,
                  borderColor: theme.border,
                }}
              >
                <MaterialCommunityIcons name="crosshairs-gps" size={18} color={theme.primary} />
              </TouchableOpacity>
            </View>
          )}
          {mapControlEnabled ? (
            <View
              pointerEvents="none"
              style={{
                position: 'absolute',
                left: 10,
                bottom: 10,
                borderRadius: 999,
                paddingHorizontal: 10,
                paddingVertical: 6,
                backgroundColor: '#000000b8',
                borderWidth: 1,
                borderColor: theme.border,
              }}
            >
              <Text style={{ color: theme.textMuted, fontSize: 10, fontWeight: '800' }}>Przesuwaj i przyblizaj mape</Text>
            </View>
          ) : null}
        </>
      ) : null}

      {loading ? (
        <View style={{
          position: 'absolute',
          top: 0,
          right: 0,
          bottom: 0,
          left: 0,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#00000066',
        }}>
          <ActivityIndicator color={theme.primary} />
        </View>
      ) : shape.features.length === 0 ? (
        <View style={{
          position: 'absolute',
          top: 0,
          right: 0,
          bottom: 0,
          left: 0,
          alignItems: 'center',
          justifyContent: 'center',
          padding: 18,
          backgroundColor: '#00000055',
        }}>
          <Text style={{ color: theme.textMuted, fontWeight: '800', textAlign: 'center' }}>
            Brak odkrytych kafelkow
          </Text>
        </View>
      ) : null}
    </View>
  );
}
