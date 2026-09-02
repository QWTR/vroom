import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Switch, TouchableOpacity, View } from 'react-native';
import { AppText as Text } from '../components/ui/AppText';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import Mapbox from '@rnmapbox/maps';
import { useTheme } from '../contexts/ThemeContext';
import { usePremium } from '../contexts/PremiumContext';
import { apiRequest } from '../lib/api/client';
import { initMapbox } from '../lib/mapboxInit';
import { resolveStandardMapStyle } from '../constants/mapConfig';
import { getPremiumNetworkState } from '../lib/native/premiumNativeCapabilities';
import {
  buildOfflineNavigationDownload,
  getOfflineNavigationCapabilities,
  validOfflineRoutePoints,
  VroomOfflineNavigation,
  type OfflineNavigationCapabilities,
  type OfflineNavigationPack,
} from '../lib/offlineNavigation';
import { ScreenCrashFallback } from '../components/ScreenCrashFallback';

export function ErrorBoundary({ retry }: { error: Error; retry: () => void }) { return <ScreenCrashFallback title="NAWIGACJA OFFLINE NIE URUCHOMIŁA SIĘ" retry={retry} />; }

const BUFFERS: Array<5 | 10 | 20> = [5, 10, 20];

export default function OfflineRoutesScreen() {
  const router = useRouter();
  const { theme, isDark, presetId } = useTheme();
  const { isPremium } = usePremium();
  const [capabilities, setCapabilities] = useState<OfflineNavigationCapabilities | null>(null);
  const [routes, setRoutes] = useState<any[]>([]);
  const [packs, setPacks] = useState<OfflineNavigationPack[]>([]);
  const [selectedRouteId, setSelectedRouteId] = useState<number | null>(null);
  const [bufferKm, setBufferKm] = useState<5 | 10 | 20>(10);
  const [allowCellular, setAllowCellular] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [mapReady, setMapReady] = useState(false);

  const refreshPacks = async () => setPacks(VroomOfflineNavigation ? await VroomOfflineNavigation.listPacks() : []);

  useEffect(() => {
    void initMapbox().then(() => setMapReady(true)).catch(() => setError('Nie udało się uruchomić podglądu mapy.'));
    void getOfflineNavigationCapabilities().then(setCapabilities);
  }, []);

  useEffect(() => {
    if (!capabilities?.available || !VroomOfflineNavigation) return;
    void VroomOfflineNavigation.setPremiumEntitlement(isPremium).then(refreshPacks).catch((reason: any) => setError(reason?.message || 'Nie udało się odczytać paczek.'));
    const listener = VroomOfflineNavigation.addListener('packProgress', (pack) => {
      setPacks((current) => [...current.filter((item) => item.id !== pack.id), pack].sort((a, b) => b.updatedAt - a.updatedAt));
    });
    return () => listener.remove();
  }, [capabilities?.available, isPremium]);

  useEffect(() => {
    if (!isPremium) return;
    apiRequest<any>('/routes/my').then((response) => {
      const items = Array.isArray(response) ? response : Array.isArray(response?.items) ? response.items : [];
      const usable = items.filter((item: any) => validOfflineRoutePoints(item?.points ?? item?.routePoints ?? item?.geometry).length >= 2);
      setRoutes(usable);
      setSelectedRouteId((current) => current ?? usable[0]?.id ?? null);
    }).catch((reason) => setError(reason?.message || 'Nie udało się pobrać zapisanych tras.'));
  }, [isPremium]);

  const selectedRoute = routes.find((item) => Number(item.id) === selectedRouteId) ?? null;
  const selectedPoints = validOfflineRoutePoints(selectedRoute?.points ?? selectedRoute?.routePoints ?? selectedRoute?.geometry);
  const routeShape = useMemo(() => selectedPoints.length >= 2 ? ({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: selectedPoints.map((item) => [item.longitude, item.latitude]) } }) : null, [selectedRouteId, routes]);
  const bounds = useMemo(() => selectedPoints.length ? {
    ne: [Math.max(...selectedPoints.map((item) => item.longitude)), Math.max(...selectedPoints.map((item) => item.latitude))] as [number, number],
    sw: [Math.min(...selectedPoints.map((item) => item.longitude)), Math.min(...selectedPoints.map((item) => item.latitude))] as [number, number],
  } : null, [selectedRouteId, routes]);

  const download = async () => {
    if (!selectedRoute || !VroomOfflineNavigation || !capabilities?.available) return;
    const nativeOffline = VroomOfflineNavigation;
    const network = await getPremiumNetworkState();
    if (!network.connected || network.internetReachable === false) return setError('Pobranie nowej paczki wymaga internetu.');
    const input = buildOfflineNavigationDownload(selectedRoute, bufferKm, resolveStandardMapStyle(isDark, presetId));
    const estimate = await nativeOffline.estimatePack(input);
    const execute = async () => {
      setBusy(input.id); setError('');
      try { await nativeOffline.downloadPack(input); await refreshPacks(); }
      catch (reason: any) { setError(reason?.message || 'Nie udało się rozpocząć pobierania.'); }
      finally { setBusy(null); }
    };
    if (network.transport !== 'wifi' && !allowCellular) {
      Alert.alert('Pobieranie bez Wi‑Fi', `Pełna mapa i dane nawigacyjne mogą zająć około ${Math.ceil(estimate.requiredBytes / 1_000_000)} MB.`, [{ text: 'Anuluj', style: 'cancel' }, { text: 'Pobierz', onPress: () => void execute() }]);
    } else await execute();
  };

  if (capabilities && !capabilities.available) return <SafeAreaView style={[s.safe, { backgroundColor: theme.bg }]}><Header theme={theme} onBack={() => router.back()} count={0} /><View style={s.center}><MaterialIcons name="system-update" size={42} color="#FFD447" /><Text style={[s.blockTitle, { color: theme.text }]}>POTRZEBNY NOWY BUILD</Text><Text style={[s.blockText, { color: theme.textDim }]}>{capabilities.reason}</Text><Text style={[s.blockText, { color: theme.textDim }]}>Stary ekran pobierający same kafelki został wyłączony, ponieważ nie zapewniał nawigacji offline.</Text></View></SafeAreaView>;

  const pack = selectedRoute ? packs.find((item) => item.routeId === Number(selectedRoute.id)) : null;
  return <SafeAreaView style={[s.safe, { backgroundColor: theme.bg }]}><Header theme={theme} onBack={() => router.back()} count={packs.length} /><View style={s.map}>{mapReady ? <Mapbox.MapView style={s.mapCanvas} styleURL={resolveStandardMapStyle(isDark, presetId)} logoEnabled={false} attributionEnabled={false}><Mapbox.Camera {...(bounds ? { bounds: { ...bounds, paddingTop: 55, paddingBottom: 55, paddingLeft: 45, paddingRight: 45 } } : { defaultSettings: { centerCoordinate: [19.2, 52.0], zoomLevel: 5 } })} />{routeShape ? <Mapbox.ShapeSource id="offline-route-preview" shape={routeShape as any}><Mapbox.LineLayer id="offline-route-preview-glow" style={{ lineColor: '#FFD44744', lineWidth: 12 }} /><Mapbox.LineLayer id="offline-route-preview-line" style={{ lineColor: '#FFD447', lineWidth: 5, lineCap: 'round' }} /></Mapbox.ShapeSource> : null}</Mapbox.MapView> : <ActivityIndicator color="#FFD447" />}{pack ? <View style={s.mapBadge}><Text style={s.mapBadgeText}>{pack.status === 'ready' ? 'GOTOWA OFFLINE' : `${Math.round(pack.progress)}%`}</Text></View> : null}</View><ScrollView contentContainerStyle={s.content}>
    {!!error && <View style={[s.card, { backgroundColor: theme.surface, borderColor: '#ef444466' }]}><Text style={{ color: '#ef4444', textAlign: 'center' }}>{error}</Text><TouchableOpacity onPress={() => setError('')}><Text style={s.retry}>ZAMKNIJ</Text></TouchableOpacity></View>}
    <View style={[s.card, { backgroundColor: theme.surface, borderColor: theme.border }]}><Text style={[s.label, { color: theme.text }]}>WYBIERZ ZAPISANĄ TRASĘ</Text><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>{routes.map((route) => <TouchableOpacity key={route.id} onPress={() => setSelectedRouteId(Number(route.id))} style={[s.routePill, { borderColor: selectedRouteId === Number(route.id) ? '#FFD447' : theme.border }]}><Text numberOfLines={1} style={{ color: selectedRouteId === Number(route.id) ? '#FFD447' : theme.text, fontWeight: '800', maxWidth: 150 }}>{route.name || 'Trasa'}</Text></TouchableOpacity>)}</ScrollView>{!routes.length ? <Text style={{ color: theme.textDim, fontSize: 12 }}>Zapisz najpierw trasę w Route Studio.</Text> : null}</View>
    <View style={[s.card, { backgroundColor: theme.surface, borderColor: theme.border }]}><Text style={[s.label, { color: theme.text }]}>SZEROKOŚĆ OBSZARU</Text><View style={s.bufferRow}>{BUFFERS.map((value) => <TouchableOpacity key={value} onPress={() => setBufferKm(value)} style={[s.buffer, { borderColor: value === bufferKm ? '#FFD447' : theme.border }]}><Text style={{ color: value === bufferKm ? '#FFD447' : theme.textDim, fontWeight: '900' }}>{value} KM</Text></TouchableOpacity>)}</View><Text style={{ color: theme.textDim, fontSize: 12, lineHeight: 16 }}>Start i cel zawsze dostają obszar 15 km. W pobranym regionie działają mapa, lokalne wyznaczanie trasy, głos i przeliczanie po zjechaniu.</Text><View style={s.switchRow}><Text style={{ color: theme.text, flex: 1 }}>Pozwól pobierać przez sieć komórkową</Text><Switch value={allowCellular} onValueChange={setAllowCellular} trackColor={{ true: '#FFD447' }} /></View></View>
    {pack ? <View style={[s.card, { backgroundColor: theme.surface, borderColor: '#FFD44766' }]}><Text style={[s.label, { color: '#FFD447' }]}>{pack.routeName}</Text><Text style={{ color: theme.textDim }}>{pack.status.toUpperCase()} · {Math.round(pack.progress)}% · {Math.ceil(pack.requiredBytes / 1_000_000)} MB est.</Text><View style={s.actions}><Action label={pack.status === 'paused' ? 'WZNÓW' : 'PAUZA'} onPress={async () => { if (!VroomOfflineNavigation) return; pack.status === 'paused' ? await VroomOfflineNavigation.resumePack(pack.id) : await VroomOfflineNavigation.pausePack(pack.id); await refreshPacks(); }} /><Action label="AKTUALIZUJ" onPress={download} /><Action label="USUŃ" danger onPress={async () => { await VroomOfflineNavigation?.deletePack(pack.id); await refreshPacks(); }} /></View></View> : <TouchableOpacity disabled={!selectedRoute || busy != null || packs.length >= 3} onPress={() => void download()} style={[s.download, (!selectedRoute || packs.length >= 3) && { opacity: .4 }]}>{busy ? <ActivityIndicator color="#111" /> : <Text style={s.downloadText}>POBIERZ MAPĘ + NAWIGACJĘ</Text>}</TouchableOpacity>}
  </ScrollView></SafeAreaView>;
}

function Header({ theme, onBack, count }: any) { return <View style={s.header}><TouchableOpacity onPress={onBack}><MaterialIcons name="arrow-back" size={24} color={theme.text} /></TouchableOpacity><Text style={[s.title, { color: theme.text }]}>NAWIGACJA OFFLINE</Text><Text style={{ color: '#FFD447', fontWeight: '900' }}>{count}/3</Text></View>; }
function Action({ label, onPress, danger }: any) { return <TouchableOpacity onPress={onPress} style={s.action}><Text style={{ color: danger ? '#ef4444' : '#FFD447', fontSize: 12, fontWeight: '900' }}>{label}</Text></TouchableOpacity>; }
const s = StyleSheet.create({ safe: { flex: 1 }, header: { height: 56, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, title: { fontFamily: 'Manrope_700Bold', fontSize: 13, letterSpacing: 1 }, map: { height: 300, backgroundColor: '#111' }, mapCanvas: { width: '100%', height: '100%' }, mapBadge: { position: 'absolute', right: 14, bottom: 14, borderRadius: 10, backgroundColor: '#090909dd', borderWidth: 1, borderColor: '#FFD44755', paddingHorizontal: 10, paddingVertical: 7 }, mapBadgeText: { color: '#FFD447', fontSize: 12, fontWeight: '900' }, content: { padding: 14, gap: 11, paddingBottom: 38 }, card: { borderWidth: 1, borderRadius: 15, padding: 15, gap: 11 }, label: { fontFamily: 'Manrope_600SemiBold', fontSize: 12, fontWeight: '900' }, routePill: { minHeight: 40, borderWidth: 1, borderRadius: 11, justifyContent: 'center', paddingHorizontal: 12 }, bufferRow: { flexDirection: 'row', gap: 8 }, buffer: { flex: 1, minHeight: 42, borderWidth: 1, borderRadius: 11, alignItems: 'center', justifyContent: 'center' }, switchRow: { minHeight: 46, flexDirection: 'row', alignItems: 'center', gap: 8 }, actions: { flexDirection: 'row', gap: 7 }, action: { flex: 1, borderWidth: 1, borderColor: '#ffffff18', borderRadius: 9, paddingVertical: 11, alignItems: 'center' }, download: { minHeight: 52, backgroundColor: '#FFD447', borderRadius: 13, alignItems: 'center', justifyContent: 'center' }, downloadText: { color: '#111', fontSize: 12, fontWeight: '900' }, retry: { color: '#FFD447', fontSize: 12, fontWeight: '900', textAlign: 'center' }, center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 16 }, blockTitle: { fontFamily: 'Manrope_700Bold', fontSize: 16, letterSpacing: 1 }, blockText: { textAlign: 'center', fontSize: 12, lineHeight: 19 } });
