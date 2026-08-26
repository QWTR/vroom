import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Text, TouchableOpacity, View } from 'react-native';
import Mapbox from '@rnmapbox/maps';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useIsFocused } from '@react-navigation/native';
import { useTheme } from '../../contexts/ThemeContext';
import { fetchCoverageCells, fetchGamificationStatus, type CoverageCell } from '../../lib/gamificationClient';

type Props = {
  userId?: number | null;
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
  height = 170,
  interactive = false,
  autoRefreshMs = 0,
}: Props) {
  const { theme, isDark } = useTheme();
  const isFocused = useIsFocused();
  const [cells, setCells] = useState<CoverageCell[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [totalRevealed, setTotalRevealed] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const fullscreenCameraRef = useRef<Mapbox.Camera>(null);
  const cameraStateRef = useRef<{ center: [number, number]; zoom: number }>(getCameraForCells([]));
  const coverageByIdRef = useRef<Map<string, CoverageCell>>(new Map());
  const requestVersionRef = useRef(0);
  const loadedAllRef = useRef(false);
  const loadedViewportRef = useRef<Set<string>>(new Set());

  const loadCells = useCallback(async (options?: { silent?: boolean; bbox?: string; force?: boolean }) => {
    const viewportKey = options?.bbox ?? null;
    if (
      !options?.force
      && (loadedAllRef.current || (viewportKey && loadedViewportRef.current.has(viewportKey)))
    ) return;
    const requestVersion = ++requestVersionRef.current;
    if (!options?.silent) setLoading(true);
    let cursor: string | null = null;
    try {
      do {
        const page = await fetchCoverageCells({
          userId: userId ?? undefined,
          bbox: options?.bbox,
          cursor,
          limit: 400,
        });
        if (requestVersion !== requestVersionRef.current) return;
        for (const cell of page.cells) coverageByIdRef.current.set(cell.cellId, cell);
        setCells(Array.from(coverageByIdRef.current.values()));
        setTotalRevealed(Math.max(0, page.totalRevealed));
        setLoading(false);
        cursor = page.hasMore ? page.nextCursor : null;
      } while (cursor);

      if (requestVersion === requestVersionRef.current) {
        if (viewportKey) loadedViewportRef.current.add(viewportKey);
        else loadedAllRef.current = true;
      }

      if (userId == null) {
        const status = await fetchGamificationStatus();
        if (requestVersion !== requestVersionRef.current) return;
        setSyncing(
          Number(status?.bufferedPings ?? 0) > 0
          || Number(status?.activityCoverageSync?.pending ?? 0) > 0,
        );
      }
    } finally {
      if (requestVersion === requestVersionRef.current) setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    coverageByIdRef.current = new Map();
    loadedAllRef.current = false;
    loadedViewportRef.current = new Set();
    setCells([]);
    setTotalRevealed(0);
    void loadCells();
    return () => {
      requestVersionRef.current += 1;
    };
  }, [loadCells]);

  useEffect(() => {
    if (!isFocused || !autoRefreshMs || autoRefreshMs < 30_000) return undefined;
    const timer = setInterval(() => {
      void loadCells({ silent: true, force: true });
    }, autoRefreshMs);
    return () => clearInterval(timer);
  }, [autoRefreshMs, isFocused, loadCells]);

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
  useEffect(() => {
    if (!fullscreen) cameraStateRef.current = camera;
  }, [camera, fullscreen]);

  useEffect(() => {
    if (!fullscreen) return;
    const timer = setTimeout(() => {
      fullscreenCameraRef.current?.setCamera({
        centerCoordinate: cameraStateRef.current.center,
        zoomLevel: cameraStateRef.current.zoom,
        animationDuration: 0,
      });
    }, 0);
    return () => clearTimeout(timer);
  }, [fullscreen]);

  const setZoom = useCallback((direction: 1 | -1) => {
    const nextZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, cameraStateRef.current.zoom + direction * 1.1));
    cameraStateRef.current = { ...cameraStateRef.current, zoom: nextZoom };
    fullscreenCameraRef.current?.zoomTo(nextZoom, 180);
  }, []);

  const handleMapIdle = useCallback((event: any) => {
    const center = event?.properties?.center;
    const zoom = Number(event?.properties?.zoom);
    if (Array.isArray(center) && center.length >= 2 && Number.isFinite(zoom)) {
      cameraStateRef.current = {
        center: [Number(center[0]), Number(center[1])],
        zoom: Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom)),
      };
    }
    const bounds = event?.properties?.bounds;
    const northEast = bounds?.ne ?? bounds?.northEast ?? bounds?.[0];
    const southWest = bounds?.sw ?? bounds?.southWest ?? bounds?.[1];
    if (
      Array.isArray(northEast)
      && Array.isArray(southWest)
      && northEast.length >= 2
      && southWest.length >= 2
    ) {
      const bbox = [
        Number(southWest[0]),
        Number(southWest[1]),
        Number(northEast[0]),
        Number(northEast[1]),
      ];
      if (bbox.every(Number.isFinite)) {
        const viewportBbox = bbox.map((value) => value.toFixed(3)).join(',');
        void loadCells({ silent: true, bbox: viewportBbox });
      }
    }
  }, [loadCells]);

  const progressLabel = cells.length > 0
    ? `${totalRevealed || cells.length} kafelkow`
    : syncing ? 'Synchronizuje przejazd' : '0 kafelkow';

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
      <TouchableOpacity
        activeOpacity={interactive && shape.features.length > 0 ? 0.86 : 1}
        disabled={!interactive || loading || shape.features.length === 0}
        onPress={() => setFullscreen(true)}
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          paddingHorizontal: 20,
          backgroundColor: isDark ? '#0b0b0d' : '#17171a',
        }}
      >
        <View style={{
          width: 54,
          height: 54,
          borderRadius: 27,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: theme.primarySoft,
          borderWidth: 1,
          borderColor: theme.primaryBorder,
        }}>
          <MaterialCommunityIcons name="map-marker-radius-outline" size={29} color={theme.primary} />
        </View>
        <Text style={{ color: theme.text, fontSize: 14, fontWeight: '900', marginTop: 10 }}>
          Mapa odkryc
        </Text>
        <Text style={{ color: theme.textMuted, fontSize: 11, fontWeight: '800', marginTop: 3 }}>
          {progressLabel}
        </Text>
        {interactive && shape.features.length > 0 ? (
          <View style={{
            marginTop: 10,
            borderRadius: 999,
            paddingHorizontal: 12,
            paddingVertical: 7,
            backgroundColor: '#000000aa',
            borderWidth: 1,
            borderColor: theme.primaryBorder,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
          }}
          >
          <MaterialCommunityIcons name="gesture-tap" size={16} color={theme.primary} />
            <Text style={{ color: theme.text, fontSize: 10, fontWeight: '900' }}>OTWORZ MAPE</Text>
          </View>
        ) : null}
      </TouchableOpacity>

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
          backgroundColor: '#000000dd',
        }}>
          <Text style={{ color: theme.textMuted, fontWeight: '800', textAlign: 'center' }}>
            {syncing ? 'Synchronizuje przejazd...' : 'Brak odkrytych kafelkow'}
          </Text>
        </View>
      ) : null}

      {fullscreen ? (
        <Modal
          visible
          animationType="slide"
          presentationStyle="fullScreen"
          onRequestClose={() => setFullscreen(false)}
        >
        <View style={{ flex: 1, backgroundColor: isDark ? '#050505' : '#f5f5f5' }}>
          <Mapbox.MapView
            style={{ flex: 1 }}
            styleURL={isDark ? Mapbox.StyleURL.Dark : Mapbox.StyleURL.Light}
            scaleBarEnabled={false}
            compassEnabled
            logoEnabled={false}
            attributionEnabled={false}
            scrollEnabled
            zoomEnabled
            pitchEnabled={false}
            rotateEnabled={false}
            onMapIdle={handleMapIdle}
          >
            <Mapbox.Camera
              ref={fullscreenCameraRef}
              defaultSettings={{
                zoomLevel: cameraStateRef.current.zoom,
                centerCoordinate: cameraStateRef.current.center,
              }}
            />
            {shape.features.length > 0 ? (
              <Mapbox.ShapeSource id={`exploration-coverage-full-${userId ?? 'me'}`} shape={shape as any}>
                <Mapbox.FillLayer
                  id={`exploration-coverage-full-fill-${userId ?? 'me'}`}
                  style={{
                    fillColor: theme.primary,
                    fillOpacity: 0.82,
                    fillOutlineColor: theme.primary,
                  }}
                />
                <Mapbox.LineLayer
                  id={`exploration-coverage-full-line-${userId ?? 'me'}`}
                  style={{
                    lineColor: isDark ? '#ffffff' : theme.primary,
                    lineOpacity: 0.95,
                    lineWidth: 1.8,
                  }}
                />
              </Mapbox.ShapeSource>
            ) : null}
          </Mapbox.MapView>

          <View
            pointerEvents="box-none"
            style={{
              position: 'absolute',
              top: 46,
              left: 14,
              right: 14,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 10,
            }}
          >
            <View style={{
              flex: 1,
              borderRadius: 16,
              paddingHorizontal: 14,
              paddingVertical: 10,
              backgroundColor: '#000000d9',
              borderWidth: 1,
              borderColor: theme.border,
            }}>
              <Text style={{ color: theme.text, fontSize: 13, fontWeight: '900' }}>Mapa odkryc</Text>
              <Text style={{ color: theme.textMuted, fontSize: 11, fontWeight: '800', marginTop: 2 }}>
                {progressLabel}
              </Text>
            </View>
            <TouchableOpacity
              onPress={() => setFullscreen(false)}
              activeOpacity={0.85}
              style={{
                width: 46,
                height: 46,
                borderRadius: 23,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: '#000000d9',
                borderWidth: 1,
                borderColor: theme.border,
              }}
            >
              <MaterialCommunityIcons name="close" size={24} color={theme.text} />
            </TouchableOpacity>
          </View>

          <View
            style={{
              position: 'absolute',
              right: 14,
              bottom: 34,
              borderRadius: 18,
              overflow: 'hidden',
              borderWidth: 1,
              borderColor: theme.border,
              backgroundColor: '#000000d9',
            }}
          >
            <TouchableOpacity onPress={() => setZoom(1)} style={{ width: 48, height: 44, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ color: theme.text, fontSize: 24, fontWeight: '900', lineHeight: 26 }}>+</Text>
            </TouchableOpacity>
            <View style={{ height: 1, backgroundColor: theme.border }} />
            <TouchableOpacity onPress={() => setZoom(-1)} style={{ width: 48, height: 44, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ color: theme.text, fontSize: 26, fontWeight: '900', lineHeight: 26 }}>-</Text>
            </TouchableOpacity>
          </View>
        </View>
        </Modal>
      ) : null}
    </View>
  );
}
