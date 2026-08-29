import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import Mapbox from '@rnmapbox/maps';
import * as Location from 'expo-location';
import * as FileSystem from 'expo-file-system/legacy';
import Toast from 'react-native-toast-message';
import { useTheme } from '../contexts/ThemeContext';
import { apiRequest } from '../lib/api/client';
import { resolveStandardMapStyle } from '../constants/mapConfig';
import { pickPremiumDocuments } from '../lib/native/premiumNativeCapabilities';
import { initMapbox } from '../lib/mapboxInit';
import { ScreenCrashFallback } from '../components/ScreenCrashFallback';
import { fetchDirectionsViaProxy } from '../scripts/mapboxProxyClient';

export function ErrorBoundary({ retry }: { error: Error; retry: () => void }) { return <ScreenCrashFallback title="ROUTE STUDIO NIE URUCHOMIŁO SIĘ" retry={retry} />; }
import { SearchModal } from '../components/modals/SearchModal';
import type { LocationState } from '../constants/types';

type Waypoint = { latitude: number; longitude: number; label: string; kind: 'stop' | 'via' };
type Preferences = { scenic: boolean; lessCities: boolean; avoidMotorways: boolean; avoidTolls: boolean; avoidFerries: boolean; avoidUnpaved: boolean };
const PREFS: Array<[keyof Preferences, string, boolean]> = [['scenic', 'SCENIC', true], ['lessCities', 'MNIEJ MIAST', true], ['avoidMotorways', 'BEZ AUTOSTRAD', false], ['avoidTolls', 'BEZ OPŁAT', false], ['avoidFerries', 'BEZ PROMÓW', false], ['avoidUnpaved', 'BEZ SZUTRÓW', false]];
const DEFAULT_PREFS: Preferences = { scenic: false, lessCities: false, avoidMotorways: false, avoidTolls: false, avoidFerries: false, avoidUnpaved: false };
const POLAND_CENTER: [number, number] = [19.1451, 51.9194];

export default function RouteStudioScreen() {
  const { theme, isDark, presetId } = useTheme();
  const router = useRouter();
  const cameraRef = useRef<Mapbox.Camera>(null);
  const requestRef = useRef(0);
  const [mapReady, setMapReady] = useState(false);
  const [name, setName] = useState('Nowa trasa');
  const [waypoints, setWaypoints] = useState<Waypoint[]>([]);
  const [userLocation, setUserLocation] = useState<LocationState | null>(null);
  const [preferences, setPreferences] = useState<Preferences>(DEFAULT_PREFS);
  const [preview, setPreview] = useState<any>(null);
  const [selectedRoute, setSelectedRoute] = useState(0);
  const [importedGeometry, setImportedGeometry] = useState<number[][]>([]);
  const [searchVisible, setSearchVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { initMapbox().then(() => setMapReady(true)).catch(() => setError('Nie udało się uruchomić mapy.')); }, []);
  useEffect(() => {
    let mounted = true;
    void Location.getForegroundPermissionsAsync().then(async (permission) => {
      if (permission.status !== 'granted') return;
      const current = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      if (!mounted) return;
      const location = { latitude: current.coords.latitude, longitude: current.coords.longitude, name: 'Moja pozycja' };
      setUserLocation(location);
      setWaypoints((points) => points.length ? points : [{ ...location, label: 'Start', kind: 'stop' }]);
      cameraRef.current?.setCamera({ centerCoordinate: [location.longitude, location.latitude], zoomLevel: 12, animationDuration: 450 });
    }).catch(() => {});
    return () => { mounted = false; requestRef.current += 1; };
  }, []);
  useEffect(() => {
    if (waypoints.length < 2) return undefined;
    const timer = setTimeout(() => {
      const minLat = Math.min(...waypoints.map((point) => point.latitude));
      const maxLat = Math.max(...waypoints.map((point) => point.latitude));
      const minLng = Math.min(...waypoints.map((point) => point.longitude));
      const maxLng = Math.max(...waypoints.map((point) => point.longitude));
      cameraRef.current?.fitBounds([maxLng, maxLat], [minLng, minLat], 72, 420);
    }, 120);
    return () => clearTimeout(timer);
  }, [waypoints]);

  const calculate = useCallback(async () => {
    if (waypoints.length < 2) return;
    const request = ++requestRef.current;
    setBusy(true); setError('');
    try {
      const response = await apiRequest<any>('/routes/studio/preview', { method: 'POST', body: { waypoints: waypoints.map((point, order) => ({ ...point, order })), preferences } });
      if (request !== requestRef.current) return;
      setPreview(response); setSelectedRoute(0);
    } catch (e: any) {
      if (request !== requestRef.current) return;
      try {
        const fallback = await fetchDirectionsViaProxy<any>({
          coordinates: waypoints.map((point) => [point.longitude, point.latitude]),
          profile: 'driving',
          alternatives: true,
          geometries: 'geojson',
          steps: true,
          language: 'pl',
          overview: 'full',
        }, { timeoutMs: 15_000 });
        if (!Array.isArray(fallback?.routes) || fallback.routes.length === 0) throw new Error('NO_ROUTE');
        setPreview({
          routes: fallback.routes.slice(0, 3).map((route: any) => ({
            ...route,
            warnings: (preferences.scenic || preferences.lessCities || preferences.avoidMotorways || preferences.avoidTolls || preferences.avoidFerries || preferences.avoidUnpaved)
              ? ['Trasa została wyznaczona w trybie podstawowym. Wybrane preferencje mogą nie być w pełni zastosowane.']
              : [],
          })),
          warning: 'Użyto zapasowego routingu VROOM. Możesz normalnie wybrać wariant i zapisać trasę.',
        });
        setSelectedRoute(0);
        setError('');
      } catch {
        setError(e.message === 'Routing jest niedostępny.' ? 'Nie udało się teraz połączyć z routingiem VROOM. Spróbuj ponownie.' : (e.message || 'Nie udało się wyznaczyć trasy.'));
      }
    }
    finally { if (request === requestRef.current) setBusy(false); }
  }, [preferences, waypoints]);
  useEffect(() => { if (waypoints.length < 2) return undefined; const timer = setTimeout(() => void calculate(), 550); return () => clearTimeout(timer); }, [calculate, waypoints.length]);

  const addPoint = useCallback((location: LocationState, asStart = false) => {
    const point: Waypoint = { latitude: location.latitude, longitude: location.longitude, label: location.name || (asStart ? 'Start' : 'Cel'), kind: 'stop' };
    setWaypoints((current) => {
      if (asStart) return current.length ? [point, ...current.slice(1)] : [point];
      if (current.length === 0) return [{ ...point, label: 'Start' }];
      if (current.length === 1) return [...current, point];
      const viaPoint: Waypoint = { ...point, label: `Punkt ${current.length}`, kind: 'via' };
      return [...current.slice(0, -1), viaPoint, current[current.length - 1]].slice(0, 12);
    });
    setSearchVisible(false); setImportedGeometry([]);
  }, []);
  const setDestination = useCallback((location: LocationState) => addPoint(location, false), [addPoint]);
  const onMapPress = useCallback((event: any) => {
    const coordinate = event?.geometry?.coordinates;
    if (!Array.isArray(coordinate) || !Number.isFinite(Number(coordinate[0])) || !Number.isFinite(Number(coordinate[1]))) return;
    addPoint({ longitude: Number(coordinate[0]), latitude: Number(coordinate[1]), name: waypoints.length ? 'Punkt na mapie' : 'Start' });
  }, [addPoint, waypoints.length]);
  const updateWaypoint = (index: number, patch: Partial<Waypoint>) => setWaypoints((points) => points.map((point, pointIndex) => pointIndex === index ? { ...point, ...patch } : point));
  const moveWaypoint = (index: number, delta: number) => setWaypoints((points) => { const target = index + delta; if (target < 0 || target >= points.length) return points; const next = [...points]; [next[index], next[target]] = [next[target], next[index]]; return next; });

  const importGpx = async () => {
    setBusy(true); setError('');
    try {
      const picked = await pickPremiumDocuments({ type: ['application/gpx+xml', 'application/xml', 'text/xml', 'text/plain'], copyToCacheDirectory: true });
      if (picked.canceled || !picked.assets[0]?.uri) return;
      const gpx = await FileSystem.readAsStringAsync(picked.assets[0].uri);
      const imported = await apiRequest<any>('/routes/studio/import-gpx', { method: 'POST', body: { gpx, name: picked.assets[0].name.replace(/\.gpx$/i, '') } });
      setName(imported.name); setWaypoints(imported.waypoints); setImportedGeometry((imported.geometry || []).map((point: any) => [point.longitude, point.latitude])); setPreview(null);
      Toast.show({ type: 'success', text1: 'GPX gotowy do edycji', text2: 'Pełny ślad został zachowany.' });
    } catch (e: any) { setError(e.message || 'Nie udało się zaimportować GPX.'); }
    finally { setBusy(false); }
  };
  const routes = preview?.routes || [];
  const activeRoute = routes[selectedRoute];
  const activeCoordinates: number[][] = activeRoute?.geometry?.coordinates || importedGeometry;
  const routeShapes = useMemo<Array<{ index: number; shape: any }>>(() => routes.map((route: any, index: number) => ({ index, shape: { type: 'Feature', properties: {}, geometry: route.geometry } })), [routes]);
  const waypointShape = useMemo(() => ({
    type: 'FeatureCollection',
    features: waypoints.map((point, index) => ({
      type: 'Feature',
      properties: {
        number: String(index + 1),
        color: index === 0 ? '#22c55e' : index === waypoints.length - 1 ? '#ef4444' : '#FFD447',
      },
      geometry: { type: 'Point', coordinates: [point.longitude, point.latitude] },
    })),
  }) as any, [waypoints]);
  const save = async () => {
    if (activeCoordinates.length < 2) return;
    setBusy(true);
    try {
      await apiRequest('/routes', { method: 'POST', body: { name, points: activeCoordinates.map(([longitude, latitude]) => ({ latitude, longitude })), distance: Number(activeRoute?.distance || 0) / 1000, duration: activeRoute?.duration || null, isPublic: false, profile: preferences.scenic ? 'scenic' : 'fastest', avoidances: [preferences.avoidMotorways && 'motorway', preferences.avoidTolls && 'toll', preferences.avoidFerries && 'ferry', preferences.avoidUnpaved && 'unpaved'].filter(Boolean), routeVariant: preferences.scenic ? 'scenic' : preferences.lessCities ? 'less_cities' : 'standard', waypoints } });
      Toast.show({ type: 'success', text1: 'Trasa zapisana' }); router.back();
    } catch (e: any) { setError(e.message || 'Nie udało się zapisać trasy.'); }
    finally { setBusy(false); }
  };

  return <SafeAreaView style={[s.safe, { backgroundColor: theme.bg }]}>
    <View style={s.mapWrap}>{mapReady ? <Mapbox.MapView style={s.mapCanvas} styleURL={resolveStandardMapStyle(isDark, presetId)} logoEnabled={false} attributionEnabled={false} onPress={onMapPress}>
      <Mapbox.Camera ref={cameraRef} defaultSettings={{ centerCoordinate: POLAND_CENTER, zoomLevel: 5.2 }} />
      {routeShapes.map(({ index, shape }) => <Mapbox.ShapeSource key={String(index)} id={`studio-route-${index}`} shape={shape as any}><Mapbox.LineLayer id={`studio-line-${index}`} style={{ lineColor: index === selectedRoute ? '#FFD447' : '#64748b', lineOpacity: index === selectedRoute ? 1 : 0.5, lineWidth: index === selectedRoute ? 6 : 4, lineCap: 'round' }} /></Mapbox.ShapeSource>)}
      {!routes.length && importedGeometry.length > 1 ? <Mapbox.ShapeSource id="studio-import" shape={{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: importedGeometry } } as any}><Mapbox.LineLayer id="studio-import-line" style={{ lineColor: '#FFD447', lineWidth: 5 }} /></Mapbox.ShapeSource> : null}
      {waypoints.length ? <Mapbox.ShapeSource id="studio-waypoints" shape={waypointShape}><Mapbox.CircleLayer id="studio-waypoint-circles" style={{ circleColor: ['get', 'color'] as any, circleRadius: 18, circleStrokeColor: '#ffffff', circleStrokeWidth: 4, circlePitchAlignment: 'map' }} /><Mapbox.SymbolLayer id="studio-waypoint-labels" style={{ textField: ['get', 'number'] as any, textColor: '#111111', textSize: 13, textFont: ['DIN Pro Bold', 'Arial Unicode MS Bold'], textAllowOverlap: true, textIgnorePlacement: true }} /></Mapbox.ShapeSource> : null}
      {waypoints.map((point, index) => <Mapbox.PointAnnotation key={`${index}-${point.latitude}-${point.longitude}`} id={`studio-point-${index}`} coordinate={[point.longitude, point.latitude]} draggable onDragEnd={(event: any) => { const coordinate = event?.geometry?.coordinates; if (Array.isArray(coordinate)) updateWaypoint(index, { longitude: Number(coordinate[0]), latitude: Number(coordinate[1]) }); }}><View collapsable={false} style={s.dragAnchor} /></Mapbox.PointAnnotation>)}
    </Mapbox.MapView> : <ActivityIndicator color="#FFD447" />}</View>
    <View pointerEvents="box-none" style={s.top}><TouchableOpacity onPress={() => router.back()} style={s.circle}><MaterialIcons name="arrow-back" size={25} color="#fff" /></TouchableOpacity><TouchableOpacity onPress={() => setSearchVisible(true)} style={s.search}><MaterialIcons name="search" size={21} color="#FFD447" /><Text style={s.searchText}>{waypoints.length < 2 ? 'Wyszukaj cel albo dotknij mapy' : 'Dodaj kolejny punkt'}</Text></TouchableOpacity><TouchableOpacity onPress={() => void importGpx()} style={s.circle}><MaterialIcons name="upload-file" size={23} color="#FFD447" /></TouchableOpacity></View>
    <View pointerEvents="none" style={s.mapHint}><Text style={s.mapHintTitle}>{waypoints.length === 0 ? 'DOTKNIJ MAPY — USTAW START' : waypoints.length === 1 ? 'DOTKNIJ MAPY — USTAW CEL' : 'DOTKNIJ MAPY — DODAJ PUNKT POŚREDNI'}</Text><View style={s.legendRow}><View style={[s.legendDot, { backgroundColor: '#22c55e' }]} /><Text style={s.legendText}>START</Text><View style={[s.legendDot, { backgroundColor: '#FFD447' }]} /><Text style={s.legendText}>PRZEZ</Text><View style={[s.legendDot, { backgroundColor: '#ef4444' }]} /><Text style={s.legendText}>CEL</Text></View></View>
    <View style={[s.sheet, { backgroundColor: theme.bg, borderColor: theme.border }]}><ScrollView contentContainerStyle={s.sheetContent} keyboardShouldPersistTaps="handled">
      <View style={s.grabber} /><TextInput value={name} onChangeText={setName} placeholder="Nazwa trasy" placeholderTextColor={theme.textDim} style={[s.name, { color: theme.text, borderColor: theme.border, backgroundColor: theme.surface }]} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 7 }}>{PREFS.map(([key, label, beta]) => <TouchableOpacity key={key} onPress={() => setPreferences((value) => ({ ...value, [key]: !value[key] }))} style={[s.chip, { borderColor: preferences[key] ? '#FFD447' : theme.border, backgroundColor: preferences[key] ? '#FFD44718' : theme.surface }]}><Text style={{ color: preferences[key] ? '#FFD447' : theme.textDim, fontSize: 8, fontWeight: '900' }}>{label}{beta ? ' BETA' : ''}</Text></TouchableOpacity>)}</ScrollView>
      {(preferences.scenic || preferences.lessCities) ? <Text style={s.warning}>{preferences.scenic ? 'Scenic preferuje kręte drogi. ' : ''}{preferences.lessCities ? 'Mniej miast ogranicza udział obszarów miejskich. ' : ''}To preferencje Beta, nie gwarancja.</Text> : null}
      <View style={{ gap: 7 }}>{waypoints.map((point, index) => <View key={index} style={[s.point, { borderColor: theme.border, backgroundColor: theme.surface }]}><View style={[s.pointNo, { backgroundColor: index === 0 ? '#22c55e' : index === waypoints.length - 1 ? '#ef4444' : '#FFD447' }]}><Text style={s.pointNoText}>{index + 1}</Text></View><View style={{ flex: 1 }}><Text style={{ color: index === 0 ? '#22c55e' : index === waypoints.length - 1 ? '#ef4444' : '#FFD447', fontSize: 7, fontWeight: '900', marginLeft: 3 }}>{index === 0 ? 'START' : index === waypoints.length - 1 ? 'CEL' : 'PUNKT POŚREDNI'}</Text><TextInput value={point.label} onChangeText={(label) => updateWaypoint(index, { label })} style={[s.pointName, { color: theme.text }]} /></View>{index > 0 && index < waypoints.length - 1 ? <TouchableOpacity onPress={() => updateWaypoint(index, { kind: point.kind === 'stop' ? 'via' : 'stop' })}><Text style={{ color: point.kind === 'stop' ? '#FFD447' : theme.textDim, fontSize: 8, fontWeight: '900' }}>{point.kind === 'stop' ? 'POSTÓJ' : 'PRZEZ'}</Text></TouchableOpacity> : null}<TouchableOpacity disabled={index === 0} onPress={() => moveWaypoint(index, -1)}><MaterialIcons name="arrow-upward" size={18} color={index === 0 ? '#555' : theme.text} /></TouchableOpacity><TouchableOpacity disabled={index === waypoints.length - 1} onPress={() => moveWaypoint(index, 1)}><MaterialIcons name="arrow-downward" size={18} color={index === waypoints.length - 1 ? '#555' : theme.text} /></TouchableOpacity><TouchableOpacity onPress={() => setWaypoints((points) => points.filter((_, i) => i !== index))}><MaterialIcons name="close" size={19} color="#ef4444" /></TouchableOpacity></View>)}</View>
      {routes.length ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>{routes.map((route: any, index: number) => <TouchableOpacity key={index} onPress={() => setSelectedRoute(index)} style={[s.alternative, { borderColor: index === selectedRoute ? '#FFD447' : theme.border, backgroundColor: theme.surface }]}><Text style={{ color: index === selectedRoute ? '#FFD447' : theme.text, fontWeight: '900' }}>WARIANT {index + 1}</Text><Text style={{ color: theme.textDim, fontSize: 10, marginTop: 4 }}>{(route.distance / 1000).toFixed(1)} km · {Math.round(route.duration / 60)} min</Text>{Number.isFinite(route.urbanSharePercent) ? <Text style={{ color: theme.textDim, fontSize: 9 }}>miasto {route.urbanSharePercent}%</Text> : null}</TouchableOpacity>)}</ScrollView> : null}
      {preview?.warning ? <Text style={[s.warning, { color: '#fbbf24' }]}>{preview.warning}</Text> : null}{activeRoute?.warnings?.map((warning: string) => <Text key={warning} style={s.error}>{warning}</Text>)}{!!error && <Text style={s.error}>{error}</Text>}
      <TouchableOpacity disabled={waypoints.length < 2 || busy} onPress={activeCoordinates.length > 1 ? save : calculate} style={[s.primary, { opacity: waypoints.length < 2 ? 0.45 : 1 }]}>{busy ? <ActivityIndicator color="#111" /> : <Text style={s.primaryText}>{activeCoordinates.length > 1 ? 'ZAPISZ TRASĘ' : 'WYZNACZ TRASĘ'}</Text>}</TouchableOpacity>
    </ScrollView></View>
    <SearchModal visible={searchVisible} onClose={() => setSearchVisible(false)} onSelectStart={(location) => addPoint(location, true)} onSelectEnd={setDestination} userLocation={userLocation} nearbyUsers={[]} />
  </SafeAreaView>;
}

const s = StyleSheet.create({ safe: { flex: 1 }, mapWrap: { flex: 1, backgroundColor: '#090909' }, mapCanvas: { width: '100%', height: '100%' }, top: { position: 'absolute', top: 52, left: 14, right: 14, flexDirection: 'row', gap: 9, alignItems: 'center' }, circle: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#050505e8', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#ffffff20' }, search: { flex: 1, height: 48, borderRadius: 16, backgroundColor: '#050505e8', borderWidth: 1, borderColor: '#ffffff20', flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, gap: 9 }, searchText: { color: '#fff', fontSize: 11, fontWeight: '800', flex: 1 }, mapHint: { position: 'absolute', top: 112, alignSelf: 'center', borderRadius: 14, backgroundColor: '#050505e8', borderWidth: 1, borderColor: '#ffffff1e', paddingHorizontal: 13, paddingVertical: 9, alignItems: 'center' }, mapHintTitle: { color: '#fff', fontSize: 8, fontWeight: '900', letterSpacing: 0.6 }, legendRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 6 }, legendDot: { width: 7, height: 7, borderRadius: 4 }, legendText: { color: '#ffffff86', fontSize: 6, fontWeight: '900', marginRight: 5 }, sheet: { maxHeight: '49%', borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 1, borderBottomWidth: 0 }, sheetContent: { padding: 14, gap: 10, paddingBottom: 32 }, grabber: { width: 42, height: 4, borderRadius: 2, backgroundColor: '#ffffff30', alignSelf: 'center' }, name: { borderWidth: 1, borderRadius: 13, paddingHorizontal: 13, height: 45, fontSize: 14, fontWeight: '800' }, chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 11, paddingVertical: 8 }, warning: { color: '#FFD447', backgroundColor: '#FFD44710', borderRadius: 10, padding: 10, fontSize: 9, lineHeight: 14 }, point: { minHeight: 52, borderWidth: 1, borderRadius: 12, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center', gap: 6 }, pointNo: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' }, pointNoText: { color: '#111', fontWeight: '900', fontSize: 11 }, pointName: { fontSize: 11, minWidth: 70, paddingVertical: 2, paddingHorizontal: 3 }, dragAnchor: { width: 46, height: 46, borderRadius: 23, backgroundColor: '#ffffff01' }, marker: { width: 30, height: 30, borderRadius: 15, borderWidth: 3, borderColor: '#fff', alignItems: 'center', justifyContent: 'center' }, markerText: { color: '#111', fontWeight: '900', fontSize: 10 }, alternative: { minWidth: 130, borderWidth: 1, borderRadius: 12, padding: 10 }, primary: { height: 49, backgroundColor: '#FFD447', borderRadius: 13, alignItems: 'center', justifyContent: 'center' }, primaryText: { color: '#111', fontWeight: '900', fontSize: 11 }, error: { color: '#ef4444', fontSize: 10, textAlign: 'center' } });
