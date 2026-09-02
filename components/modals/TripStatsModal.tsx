import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Dimensions, Modal, Pressable, ScrollView, TouchableOpacity, View } from 'react-native';
import { AppText as Text } from '../ui/AppText';
import { MaterialIcons } from '@expo/vector-icons';
import Mapbox from '@rnmapbox/maps';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { TripStoryComposer } from '../trips/TripStoryComposer';
import { resolveStandardMapStyle } from '../../constants/mapConfig';
import { useTheme } from '../../contexts/ThemeContext';
import type { TripStats } from '../../hooks/useTripStats';
import { useModalBackHandler } from '../../hooks/useModalBackHandler';
import { useEffectivePremium } from '../../hooks/useEffectivePremium';
import { apiRequest } from '../../lib/api/client';
import { initMapbox } from '../../lib/mapboxInit';
import { formatDistanceKm, formatSpeedKmh } from '../../lib/tripStatFormatters';

const SCREEN_H = Dimensions.get('window').height;
type ServerSummary = { activityId: number; analysisStatus: string; telemetryQuality: any; availability: any; summary: any; insight?: any; personalRecords?: Array<{ kind: string; value: number }>; premiumLocked?: boolean };
const formatTime = (seconds: number) => { const sec = Math.max(0, Math.round(seconds || 0)); const h = Math.floor(sec / 3600); const m = Math.floor((sec % 3600) / 60); const s = sec % 60; return h ? `${h} h ${m} min` : m ? `${m} min ${s} s` : `${s} s`; };
const statCard = (theme: any) => ({ flex: 1, minHeight: 84, borderRadius: 15, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.surface2, padding: 12 });

interface Props { visible: boolean; stats: TripStats | null; onClose: () => void }

export function TripStatsModal({ visible, stats, onClose }: Props) {
  const { theme, isDark, presetId } = useTheme();
  const { isPremium } = useEffectivePremium();
  const router = useRouter();
  const [server, setServer] = useState<ServerSummary | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [storyVisible, setStoryVisible] = useState(false);
  useModalBackHandler(visible, onClose);
  useEffect(() => { if (visible) void initMapbox().catch(() => {}); }, [visible]);
  useEffect(() => {
    if (!visible || !stats?.tripSessionId) return undefined;
    let cancelled = false; let attempt = 0; let timer: ReturnType<typeof setTimeout> | null = null;
    const load = async () => {
      setSyncing(true);
      try { const response = await apiRequest<ServerSummary>(`/activity/summary/session/${encodeURIComponent(stats.tripSessionId!)}`); if (!cancelled) { setServer(response); setSyncing(false); } }
      catch { attempt += 1; if (!cancelled && attempt < 6) timer = setTimeout(load, 1300); else if (!cancelled) setSyncing(false); }
    };
    void load();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [stats?.tripSessionId, visible]);
  useEffect(() => { if (!visible) { setServer(null); setStoryVisible(false); } }, [visible]);
  const points = useMemo(() => (stats?.trackedPoints || []).filter((point) => Number.isFinite(point.latitude) && Number.isFinite(point.longitude)).slice(-1500), [stats]);
  const speedValues = useMemo(() => points.map((point) => Number(point.speedKmh)).filter(Number.isFinite), [points]);
  const altitudeValues = useMemo(() => points.map((point) => Number(point.altitudeM)).filter(Number.isFinite), [points]);
  const routeShape = useMemo(() => ({ type: 'FeatureCollection', features: points.slice(0, -1).map((point, index) => ({ type: 'Feature', properties: { speed: (Number(point.speedKmh) + Number(points[index + 1]?.speedKmh)) / 2 || 0 }, geometry: { type: 'LineString', coordinates: [[point.longitude, point.latitude], [points[index + 1].longitude, points[index + 1].latitude]] } })) }) as any, [points]);
  if (!stats) return null;
  const summary = server?.summary || {};
  const movingSec = Number(summary.movingDurationSec || stats.elapsedSec);
  const stoppedSec = Number(summary.stoppedDurationSec || 0);
  const shortTrip = stats.distanceKm < 1;
  const bounds = points.length > 1 ? { minLat: Math.min(...points.map((p) => p.latitude)), maxLat: Math.max(...points.map((p) => p.latitude)), minLng: Math.min(...points.map((p) => p.longitude)), maxLng: Math.max(...points.map((p) => p.longitude)) } : null;
  const hasSpeed = speedValues.length >= 2;
  const hasAltitude = altitudeValues.length >= 2;
  const storyData = {
    points,
    distanceKm: stats.distanceKm,
    elapsedSec: stats.elapsedSec,
    movingSec,
    stoppedSec,
    avgSpeedKmh: stats.avgSpeedKmh,
    maxSpeedKmh: stats.maxSpeedKmh,
    elevationGainM: Number(summary.elevationGainM || server?.insight?.elevationGainM || 0),
    hardAccelerationCount: Number(server?.insight?.hardAccelerationCount || 0),
    hardBrakingCount: Number(server?.insight?.hardBrakingCount || 0),
    rankingPoints: Number(summary.rankingPointsAwarded || 0),
  };
  return <><Modal visible={visible} transparent animationType="slide" statusBarTranslucent onRequestClose={onClose}>
    <View style={{ flex: 1, backgroundColor: '#000000c7', justifyContent: 'flex-end' }}><Pressable style={{ position: 'absolute', inset: 0 } as any} onPress={onClose} />
      <View style={{ maxHeight: SCREEN_H * 0.93, backgroundColor: theme.surface, borderTopLeftRadius: 26, borderTopRightRadius: 26, borderWidth: 1, borderColor: theme.border, overflow: 'hidden' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', padding: 15, gap: 10 }}><View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: '#22c55e20', alignItems: 'center', justifyContent: 'center' }}><MaterialIcons name="flag" size={22} color="#22c55e" /></View><View style={{ flex: 1 }}><Text style={{ color: theme.text, fontFamily: 'Manrope_700Bold', fontSize: 14, letterSpacing: 1 }}>PRZEJAZD ZAKOŃCZONY</Text><Text style={{ color: syncing ? '#FFD447' : shortTrip ? '#f59e0b' : '#22c55e', fontSize: 12, marginTop: 3 }}>{syncing ? 'Zapisuję i uzupełniam analizę…' : shortTrip ? 'Poniżej 1 km — przejazd nie trafi do historii' : 'Przejazd zapisany w historii'}</Text></View><TouchableOpacity onPress={onClose} style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: theme.surface2, alignItems: 'center', justifyContent: 'center' }}><MaterialIcons name="close" size={19} color={theme.text} /></TouchableOpacity></View>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 15, paddingBottom: 34, gap: 12 }}>
          {bounds ? <View style={{ height: 250, borderRadius: 18, overflow: 'hidden', borderWidth: 1, borderColor: theme.border }}><Mapbox.MapView style={{ flex: 1 }} styleURL={resolveStandardMapStyle(isDark, presetId)} logoEnabled={false} attributionEnabled={false} scrollEnabled={false} zoomEnabled={false} rotateEnabled={false} pitchEnabled={false}><Mapbox.Camera bounds={{ ne: [bounds.maxLng, bounds.maxLat], sw: [bounds.minLng, bounds.minLat], paddingTop: 34, paddingBottom: 34, paddingLeft: 34, paddingRight: 34 }} /><Mapbox.ShapeSource id="finish-route" shape={routeShape}><Mapbox.LineLayer id="finish-route-line" style={{ lineColor: isPremium && hasSpeed ? ['interpolate', ['linear'], ['get', 'speed'], 0, '#22c55e', 60, '#FFD447', 120, '#f97316', 180, '#ef4444'] as any : '#FFD447', lineWidth: 6, lineCap: 'round' }} /></Mapbox.ShapeSource><Mapbox.PointAnnotation id="finish-start" coordinate={[points[0].longitude, points[0].latitude]}><View style={{ width: 13, height: 13, borderRadius: 7, backgroundColor: '#22c55e', borderWidth: 2, borderColor: '#fff' }} /></Mapbox.PointAnnotation><Mapbox.PointAnnotation id="finish-end" coordinate={[points.at(-1)!.longitude, points.at(-1)!.latitude]}><View style={{ width: 13, height: 13, borderRadius: 7, backgroundColor: '#ef4444', borderWidth: 2, borderColor: '#fff' }} /></Mapbox.PointAnnotation></Mapbox.MapView><View style={{ position: 'absolute', left: 10, bottom: 10, borderRadius: 10, backgroundColor: '#050505dd', paddingHorizontal: 10, paddingVertical: 7 }}><Text style={{ color: '#fff', fontWeight: '900' }}>{formatDistanceKm(stats.distanceKm)} km</Text></View>{isPremium && hasSpeed ? <View style={{ position: 'absolute', right: 10, bottom: 10, borderRadius: 10, backgroundColor: '#050505dd', paddingHorizontal: 9, paddingVertical: 6 }}><Text style={{ color: '#ffffffbb', fontSize: 12 }}>WOLNO <Text style={{ color: '#FFD447' }}>●</Text> SZYBKO <Text style={{ color: '#ef4444' }}>●</Text></Text></View> : null}</View> : <View style={{ height: 100, borderRadius: 18, backgroundColor: theme.surface2, alignItems: 'center', justifyContent: 'center' }}><MaterialIcons name="map" size={25} color={theme.textDim} /><Text style={{ color: theme.textDim, fontSize: 12, marginTop: 6 }}>Brak zapisanego przebiegu mapy</Text></View>}
          <LinearGradient colors={['#0b2530', '#11140e', '#191303']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ borderRadius: 19, borderWidth: 1, borderColor: '#FFD44745', padding: 15, overflow: 'hidden' }}>
            <View style={{ position: 'absolute', width: 145, height: 145, borderRadius: 80, right: -48, top: -70, backgroundColor: '#29c7ff16' }} />
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <View style={{ width: 45, height: 45, borderRadius: 14, backgroundColor: '#FFD447', alignItems: 'center', justifyContent: 'center' }}><MaterialIcons name="auto-awesome" size={23} color="#111" /></View>
              <View style={{ flex: 1 }}><Text style={{ color: '#fff', fontFamily: 'Manrope_700Bold', fontSize: 12, letterSpacing: 1 }}>VROOM STORY</Text><Text style={{ color: '#ffffff8b', fontSize: 12, lineHeight: 16, marginTop: 4 }}>Twoja trasa i statystyki w efektownej grafice 1080×1920.</Text></View>
            </View>
            <TouchableOpacity onPress={() => setStoryVisible(true)} activeOpacity={0.86} style={{ height: 48, borderRadius: 14, backgroundColor: '#fff', flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', marginTop: 14 }}><MaterialIcons name="ios-share" size={19} color="#111" /><Text style={{ color: '#111', fontWeight: '900', fontSize: 12 }}>UTWÓRZ GRAFIKĘ I OPUBLIKUJ</Text></TouchableOpacity>
          </LinearGradient>
          <View style={{ flexDirection: 'row', gap: 9 }}><View style={statCard(theme)}><Text style={{ color: theme.textDim, fontSize: 12 }}>DYSTANS</Text><Text style={{ color: theme.text, fontSize: 24, fontWeight: '900', marginTop: 8 }}>{formatDistanceKm(stats.distanceKm)} <Text style={{ fontSize: 12 }}>km</Text></Text></View><View style={statCard(theme)}><Text style={{ color: theme.textDim, fontSize: 12 }}>CAŁY CZAS</Text><Text style={{ color: theme.text, fontSize: 20, fontWeight: '900', marginTop: 9 }}>{formatTime(stats.elapsedSec)}</Text></View></View>
          <View style={{ flexDirection: 'row', gap: 9 }}><View style={statCard(theme)}><Text style={{ color: theme.textDim, fontSize: 12 }}>ŚREDNIA</Text><Text style={{ color: '#38bdf8', fontSize: 23, fontWeight: '900', marginTop: 8 }}>{formatSpeedKmh(stats.avgSpeedKmh)} <Text style={{ fontSize: 12 }}>km/h</Text></Text></View><View style={statCard(theme)}><Text style={{ color: theme.textDim, fontSize: 12 }}>MAKSYMALNA</Text><Text style={{ color: '#ef4444', fontSize: 23, fontWeight: '900', marginTop: 8 }}>{formatSpeedKmh(stats.maxSpeedKmh)} <Text style={{ fontSize: 12 }}>km/h</Text></Text></View></View>
          <View style={{ flexDirection: 'row', gap: 9 }}><View style={statCard(theme)}><Text style={{ color: theme.textDim, fontSize: 12 }}>RUCH</Text><Text style={{ color: '#22c55e', fontSize: 18, fontWeight: '900', marginTop: 10 }}>{formatTime(movingSec)}</Text></View><View style={statCard(theme)}><Text style={{ color: theme.textDim, fontSize: 12 }}>POSTÓJ</Text><Text style={{ color: '#f59e0b', fontSize: 18, fontWeight: '900', marginTop: 10 }}>{formatTime(stoppedSec)}</Text></View></View>
          {Number(summary.rankingPointsAwarded || 0) > 0 || summary.achievements?.length ? <View style={{ borderRadius: 16, borderWidth: 1, borderColor: '#FFD44755', backgroundColor: '#FFD44710', padding: 14 }}><Text style={{ color: '#FFD447', fontWeight: '900' }}>+{summary.rankingPointsAwarded || 0} punktów</Text>{summary.achievements?.map((achievement: any) => <Text key={String(achievement.id)} style={{ color: theme.text, fontSize: 12, marginTop: 6 }}>🏆 {achievement.name}</Text>)}</View> : null}
          {isPremium ? <><View style={{ borderRadius: 16, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.surface2, padding: 13, gap: 13 }}><Text style={{ color: '#FFD447', fontFamily: 'Manrope_700Bold', fontSize: 12 }}>ANALIZA PREMIUM</Text><Text style={{ color: theme.textMuted, fontSize: 12 }}>Przewyższenie: {Math.round(summary.elevationGainM || server?.insight?.elevationGainM || 0)} m · mocne przyspieszenia: {server?.insight?.hardAccelerationCount || 0} · hamowania: {server?.insight?.hardBrakingCount || 0}</Text><MiniChart label="PRĘDKOŚĆ" values={speedValues} color="#FFD447" textColor={theme.text} /><MiniChart label="WYSOKOŚĆ" values={altitudeValues} color="#38bdf8" textColor={theme.text} /></View>{server?.personalRecords?.length ? <View style={{ borderRadius: 16, backgroundColor: '#22c55e12', borderWidth: 1, borderColor: '#22c55e44', padding: 13 }}><Text style={{ color: '#22c55e', fontWeight: '900' }}>NOWY REKORD</Text>{server.personalRecords.map((record) => <Text key={record.kind} style={{ color: theme.text, fontSize: 12, marginTop: 5 }}>{record.kind.startsWith('route_time') ? 'Najlepszy czas tej trasy' : record.kind === 'distance' ? 'Najdłuższy przejazd' : record.kind === 'elevation_gain' ? 'Największe przewyższenie' : 'Najdłuższy czas ruchu'}</Text>)}</View> : null}{server?.activityId ? <TouchableOpacity onPress={() => { onClose(); router.push(`/replay/${server.activityId}` as any); }} style={{ height: 50, borderRadius: 14, backgroundColor: '#FFD447', alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: '#111', fontWeight: '900' }}>OTWÓRZ ANIMOWANY REPLAY</Text></TouchableOpacity> : null}</> : <TouchableOpacity onPress={() => { onClose(); router.push('/premium-hub' as any); }} style={{ borderRadius: 17, borderWidth: 1, borderColor: '#FFD44755', backgroundColor: '#FFD4470d', padding: 16 }}><Text style={{ color: '#FFD447', fontFamily: 'Manrope_700Bold', fontSize: 12 }}>ODBLOKUJ PEŁNĄ ANALIZĘ</Text><Text style={{ color: theme.textMuted, fontSize: 12, lineHeight: 16, marginTop: 8 }}>Animowany Replay, heatmapa prędkości, wykresy, postoje, zdarzenia, rekordy i porównania tras.</Text><View style={{ marginTop: 12, height: 42, borderRadius: 12, backgroundColor: '#FFD447', alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: '#111', fontWeight: '900' }}>ZOBACZ PREMIUM</Text></View></TouchableOpacity>}
          <TouchableOpacity onPress={onClose} style={{ height: 49, borderRadius: 14, backgroundColor: theme.surface2, borderWidth: 1, borderColor: theme.border, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: theme.text, fontWeight: '900' }}>GOTOWE</Text></TouchableOpacity>
        </ScrollView>
      </View>
    </View>
  </Modal><TripStoryComposer visible={visible && storyVisible} data={storyData} onClose={() => setStoryVisible(false)} /></>;
}

function MiniChart({ label, values, color, textColor }: { label: string; values: number[]; color: string; textColor: string }) {
  const step = Math.max(1, Math.ceil(values.length / 55)); const sample = values.filter((_, index) => index % step === 0).slice(0, 55); const min = sample.length ? Math.min(...sample) : 0; const max = sample.length ? Math.max(...sample) : 1;
  return <View><Text style={{ color: textColor, fontSize: 12, fontWeight: '900' }}>{label}</Text><View style={{ height: 65, flexDirection: 'row', alignItems: 'flex-end', gap: 2, marginTop: 6 }}>{sample.length ? sample.map((value, index) => <View key={index} style={{ flex: 1, minWidth: 2, height: 4 + ((value - min) / Math.max(1, max - min)) * 58, backgroundColor: color, opacity: 0.45 + index / Math.max(1, sample.length) * 0.5, borderTopLeftRadius: 2, borderTopRightRadius: 2 }} />) : <Text style={{ color: '#888', fontSize: 12 }}>Brak wiarygodnych danych — niczego nie zgadujemy.</Text>}</View></View>;
}
