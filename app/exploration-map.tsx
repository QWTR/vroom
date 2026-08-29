import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import Mapbox from '@rnmapbox/maps';
import { useTheme } from '../contexts/ThemeContext';
import { fetchCoverageCells, type CoverageCell } from '../lib/gamificationClient';
import { initMapbox } from '../lib/mapboxInit';
import { ScreenCrashFallback } from '../components/ScreenCrashFallback';

export function ErrorBoundary({ retry }: { error: Error; retry: () => void }) { return <ScreenCrashFallback title="MAPA ODKRYĆ NIE URUCHOMIŁA SIĘ" retry={retry} />; }

const POLAND_CENTER: [number, number] = [19.1451, 51.9194];
const MAX_VISIBLE_CELLS = 900;
function validRing(polygon: unknown): polygon is [number, number][] { return Array.isArray(polygon) && polygon.length >= 4 && polygon.every((point) => Array.isArray(point) && point.length >= 2 && Number.isFinite(Number(point[0])) && Number.isFinite(Number(point[1])) && Number(point[0]) >= -180 && Number(point[0]) <= 180 && Number(point[1]) >= -90 && Number(point[1]) <= 90); }

export default function ExplorationMapScreen() {
  const { userId: rawUserId } = useLocalSearchParams<{ userId?: string }>();
  const userId = Number.isInteger(Number(rawUserId)) ? Number(rawUserId) : undefined;
  const router = useRouter();
  const { theme, isDark } = useTheme();
  const requestRef = useRef(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [cells, setCells] = useState<CoverageCell[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [total, setTotal] = useState(0);
  useEffect(() => { initMapbox().then(() => setMapReady(true)).catch(() => setError('Nie udało się uruchomić mapy.')); }, []);
  useEffect(() => () => { requestRef.current += 1; if (debounceRef.current) clearTimeout(debounceRef.current); }, []);
  const loadViewport = useCallback(async (bbox: string) => {
    const request = ++requestRef.current; setLoading(true); setError('');
    try { const page = await fetchCoverageCells({ userId, bbox, limit: MAX_VISIBLE_CELLS }); if (request !== requestRef.current) return; setCells(page.cells.slice(0, MAX_VISIBLE_CELLS)); setTotal(page.totalRevealed); }
    catch { if (request === requestRef.current) setError('Nie udało się pobrać tego fragmentu mapy.'); }
    finally { if (request === requestRef.current) setLoading(false); }
  }, [userId]);
  useEffect(() => { void loadViewport('13.8,48.7,24.5,55.4'); }, [loadViewport]);
  const onMapIdle = useCallback((event: any) => {
    const bounds = event?.properties?.bounds; const ne = bounds?.ne ?? bounds?.northEast ?? bounds?.[0]; const sw = bounds?.sw ?? bounds?.southWest ?? bounds?.[1];
    if (!Array.isArray(ne) || !Array.isArray(sw)) return;
    const bbox = [Number(sw[0]), Number(sw[1]), Number(ne[0]), Number(ne[1])]; if (!bbox.every(Number.isFinite)) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => void loadViewport(bbox.map((value) => value.toFixed(4)).join(',')), 420);
  }, [loadViewport]);
  const shape = useMemo(() => ({ type: 'FeatureCollection' as const, features: cells.filter((cell) => validRing(cell.polygon)).map((cell) => { const ring = [...cell.polygon]; const first = ring[0]; const last = ring[ring.length - 1]; if (first[0] !== last[0] || first[1] !== last[1]) ring.push(first); return { type: 'Feature' as const, id: cell.cellId, properties: { cellId: cell.cellId }, geometry: { type: 'Polygon' as const, coordinates: [ring] } }; }) }), [cells]);
  return <SafeAreaView style={{ flex: 1, backgroundColor: theme.bg }}>
    {mapReady ? <Mapbox.MapView style={{ flex: 1 }} styleURL={isDark ? Mapbox.StyleURL.Dark : Mapbox.StyleURL.Light} logoEnabled={false} attributionEnabled={false} scaleBarEnabled={false} onMapIdle={onMapIdle}><Mapbox.Camera defaultSettings={{ centerCoordinate: POLAND_CENTER, zoomLevel: 5.2 }} />{shape.features.length ? <Mapbox.ShapeSource id="exploration-viewport" shape={shape as any}><Mapbox.FillLayer id="exploration-viewport-fill" style={{ fillColor: theme.primary, fillOpacity: 0.78, fillOutlineColor: theme.primary }} /><Mapbox.LineLayer id="exploration-viewport-line" style={{ lineColor: '#ffffff', lineOpacity: 0.8, lineWidth: 1 }} /></Mapbox.ShapeSource> : null}</Mapbox.MapView> : <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color={theme.primary} /></View>}
    <View pointerEvents="box-none" style={{ position: 'absolute', top: 48, left: 14, right: 14, flexDirection: 'row', gap: 10 }}><TouchableOpacity onPress={() => router.back()} style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: '#050505e8', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: theme.border }}><MaterialCommunityIcons name="arrow-left" size={25} color="#fff" /></TouchableOpacity><View style={{ flex: 1, minHeight: 48, borderRadius: 16, backgroundColor: '#050505e8', borderWidth: 1, borderColor: error ? '#ef4444' : theme.border, paddingHorizontal: 14, justifyContent: 'center' }}><Text style={{ color: '#fff', fontWeight: '900', fontSize: 13 }}>Mapa odkryć</Text><Text style={{ color: error ? '#ef4444' : '#ffffff99', fontSize: 10, marginTop: 2 }}>{error || `${total} odkrytych · ${shape.features.length} w tym widoku`}</Text></View></View>
    {loading ? <View style={{ position: 'absolute', bottom: 28, alignSelf: 'center', borderRadius: 999, backgroundColor: '#050505dd', paddingHorizontal: 15, paddingVertical: 9, flexDirection: 'row', gap: 8 }}><ActivityIndicator size="small" color={theme.primary} /><Text style={{ color: '#fff', fontSize: 11, fontWeight: '800' }}>Ładuję widoczny obszar</Text></View> : error ? <TouchableOpacity onPress={() => void loadViewport('13.8,48.7,24.5,55.4')} style={{ position: 'absolute', bottom: 28, alignSelf: 'center', borderRadius: 999, backgroundColor: theme.primary, paddingHorizontal: 18, paddingVertical: 11 }}><Text style={{ color: '#111', fontWeight: '900' }}>SPRÓBUJ PONOWNIE</Text></TouchableOpacity> : null}
  </SafeAreaView>;
}
