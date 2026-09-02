import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { AppText as Text } from '../ui/AppText';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, {
  Circle,
  Defs,
  LinearGradient as SvgLinearGradient,
  Path,
  Stop,
} from 'react-native-svg';
import type { DriveTelemetryPoint } from '../../lib/driveTelemetry';
import { formatSpeedKmh } from '../../lib/tripStatFormatters';

export type TripStoryData = {
  points: DriveTelemetryPoint[];
  distanceKm: number;
  elapsedSec: number;
  movingSec: number;
  stoppedSec: number;
  avgSpeedKmh: number;
  maxSpeedKmh: number;
  elevationGainM: number;
  hardAccelerationCount: number;
  hardBrakingCount: number;
  rankingPoints?: number;
};

type RouteDrawing = {
  path: string;
  start: { x: number; y: number } | null;
  end: { x: number; y: number } | null;
};

const ROUTE_WIDTH = 900;
const ROUTE_HEIGHT = 850;
const ROUTE_PADDING = 90;

function formatDuration(seconds: number) {
  const value = Math.max(0, Math.round(Number(seconds) || 0));
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const secs = value % 60;
  if (hours) return `${hours} h ${String(minutes).padStart(2, '0')} min`;
  if (minutes) return `${minutes} min ${String(secs).padStart(2, '0')} s`;
  return `${secs} s`;
}

function createRouteDrawing(points: DriveTelemetryPoint[]): RouteDrawing {
  const valid = points.filter(
    (point) => Number.isFinite(point.latitude) && Number.isFinite(point.longitude),
  );
  if (valid.length < 2) return { path: '', start: null, end: null };

  const step = Math.max(1, Math.ceil(valid.length / 260));
  const sampled = valid.filter((_, index) => index % step === 0);
  if (sampled.at(-1) !== valid.at(-1)) sampled.push(valid.at(-1)!);

  const minLat = Math.min(...sampled.map((point) => point.latitude));
  const maxLat = Math.max(...sampled.map((point) => point.latitude));
  const minLng = Math.min(...sampled.map((point) => point.longitude));
  const maxLng = Math.max(...sampled.map((point) => point.longitude));
  const latSpan = Math.max(0.00005, maxLat - minLat);
  const lngSpan = Math.max(0.00005, maxLng - minLng);
  const availableWidth = ROUTE_WIDTH - ROUTE_PADDING * 2;
  const availableHeight = ROUTE_HEIGHT - ROUTE_PADDING * 2;
  const scale = Math.min(availableWidth / lngSpan, availableHeight / latSpan);
  const drawnWidth = lngSpan * scale;
  const drawnHeight = latSpan * scale;
  const offsetX = (ROUTE_WIDTH - drawnWidth) / 2;
  const offsetY = (ROUTE_HEIGHT - drawnHeight) / 2;
  const projected = sampled.map((point) => ({
    x: offsetX + (point.longitude - minLng) * scale,
    y: ROUTE_HEIGHT - (offsetY + (point.latitude - minLat) * scale),
  }));

  return {
    path: projected.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(' '),
    start: projected[0],
    end: projected.at(-1) ?? null,
  };
}

function StoryStat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text numberOfLines={1} style={[styles.statValue, accent ? { color: accent } : null]}>{value}</Text>
    </View>
  );
}

export function TripStoryCard({ data }: { data: TripStoryData }) {
  const route = useMemo(() => createRouteDrawing(data.points), [data.points]);
  const hasRoute = Boolean(route.path);

  return (
    <LinearGradient
      colors={['#030506', '#071316', '#050505', '#100d04']}
      locations={[0, 0.36, 0.74, 1]}
      style={styles.card}
    >
      <View style={styles.glowTop} />
      <View style={styles.glowBottom} />
      <View style={styles.grid} pointerEvents="none">
        {Array.from({ length: 10 }).map((_, index) => <View key={`h-${index}`} style={[styles.gridLineH, { top: `${index * 11}%` as any }]} />)}
        {Array.from({ length: 7 }).map((_, index) => <View key={`v-${index}`} style={[styles.gridLineV, { left: `${index * 17}%` as any }]} />)}
      </View>

      <View style={styles.header}>
        <View>
          <Text style={styles.brand}>VROOM</Text>
          <Text style={styles.kicker}>DRIVE STORY</Text>
        </View>
        <View style={styles.completedPill}>
          <View style={styles.liveDot} />
          <Text style={styles.completedText}>PRZEJAZD UKOŃCZONY</Text>
        </View>
      </View>

      <View style={styles.heroCopy}>
        <Text style={styles.heroLabel}>DZISIEJSZA TRASA</Text>
        <View style={styles.distanceRow}>
          <Text numberOfLines={1} style={styles.distance}>{data.distanceKm.toFixed(1)}</Text>
          <View style={styles.distanceUnitWrap}>
            <Text style={styles.distanceUnit}>KM</Text>
            <Text style={styles.duration}>{formatDuration(data.elapsedSec)}</Text>
          </View>
        </View>
      </View>

      <View style={styles.routeStage}>
        <View style={styles.routeBadge}><Text style={styles.routeBadgeText}>YOUR LINE. YOUR STORY.</Text></View>
        {hasRoute ? (
          <Svg viewBox={`0 0 ${ROUTE_WIDTH} ${ROUTE_HEIGHT}`} width="100%" height="100%" style={styles.routeSvg}>
            <Defs>
              <SvgLinearGradient id="routeGradient" x1="0" y1="0" x2="1" y2="1">
                <Stop offset="0" stopColor="#18e07b" />
                <Stop offset="0.48" stopColor="#29c7ff" />
                <Stop offset="0.74" stopColor="#ffd447" />
                <Stop offset="1" stopColor="#ff4242" />
              </SvgLinearGradient>
            </Defs>
            <Path d={route.path} fill="none" stroke="#22d3ee" strokeWidth="48" strokeOpacity="0.07" strokeLinecap="round" strokeLinejoin="round" />
            <Path d={route.path} fill="none" stroke="#29c7ff" strokeWidth="24" strokeOpacity="0.13" strokeLinecap="round" strokeLinejoin="round" />
            <Path d={route.path} fill="none" stroke="url(#routeGradient)" strokeWidth="10" strokeLinecap="round" strokeLinejoin="round" />
            {route.start ? <Circle cx={route.start.x} cy={route.start.y} r="18" fill="#18e07b" stroke="#ffffff" strokeWidth="7" /> : null}
            {route.end ? <Circle cx={route.end.x} cy={route.end.y} r="18" fill="#ff4242" stroke="#ffffff" strokeWidth="7" /> : null}
          </Svg>
        ) : (
          <View style={styles.emptyRoute}>
            <View style={styles.emptyRouteLine} />
            <Text style={styles.emptyRouteText}>KRÓTKI PRZEJAZD</Text>
          </View>
        )}
        <View style={styles.routeLegend}>
          <View style={styles.routeLegendItem}><View style={[styles.legendDot, { backgroundColor: '#18e07b' }]} /><Text style={styles.legendText}>START</Text></View>
          <View style={styles.legendRule} />
          <View style={styles.routeLegendItem}><View style={[styles.legendDot, { backgroundColor: '#ff4242' }]} /><Text style={styles.legendText}>META</Text></View>
        </View>
      </View>

      <View style={styles.statsPanel}>
        <View style={styles.statsRow}>
          <StoryStat label="ŚREDNIA" value={`${formatSpeedKmh(data.avgSpeedKmh)} KM/H`} accent="#29c7ff" />
          <View style={styles.statDivider} />
          <StoryStat label="MAKSYMALNA" value={`${formatSpeedKmh(data.maxSpeedKmh)} KM/H`} accent="#ff4b4b" />
        </View>
        <View style={styles.statsDivider} />
        <View style={styles.statsRow}>
          <StoryStat label="CZAS W RUCHU" value={formatDuration(data.movingSec)} accent="#18e07b" />
          <View style={styles.statDivider} />
          <StoryStat label="PRZEWYŻSZENIE" value={`${Math.round(data.elevationGainM)} M`} accent="#ffd447" />
        </View>
      </View>

      <View style={styles.footer}>
        <View style={styles.eventStrip}>
          <Text style={styles.eventValue}>{data.hardAccelerationCount}</Text><Text style={styles.eventLabel}> MOCNE PRZYSPIESZENIA</Text>
          <View style={styles.eventDot} />
          <Text style={styles.eventValue}>{data.hardBrakingCount}</Text><Text style={styles.eventLabel}> HAMOWANIA</Text>
        </View>
        <View style={styles.footerBrand}>
          <Text style={styles.footerCopy}>DRIVE • DISCOVER • CONNECT</Text>
          <Text style={styles.footerVroom}>VROOM</Text>
        </View>
      </View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  card: { width: '100%', aspectRatio: 9 / 16, overflow: 'hidden', paddingHorizontal: '6.5%', paddingTop: '6.5%', paddingBottom: '5.5%' },
  glowTop: { position: 'absolute', width: '90%', height: '32%', borderRadius: 999, backgroundColor: '#00d9ff18', top: '-13%', right: '-24%', transform: [{ rotate: '-18deg' }] },
  glowBottom: { position: 'absolute', width: '75%', height: '25%', borderRadius: 999, backgroundColor: '#ffd44714', bottom: '-10%', left: '-28%', transform: [{ rotate: '16deg' }] },
  grid: { ...StyleSheet.absoluteFillObject, opacity: 0.2 },
  gridLineH: { position: 'absolute', left: 0, right: 0, height: 1, backgroundColor: '#ffffff12' },
  gridLineV: { position: 'absolute', top: 0, bottom: 0, width: 1, backgroundColor: '#ffffff0c' },
  header: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  brand: { color: '#ffffff', fontFamily: 'Manrope_700Bold', fontSize: 23, letterSpacing: 1 },
  kicker: { color: '#29c7ff', fontWeight: '900', fontSize: 12, letterSpacing: 1, marginTop: 4 },
  completedPill: { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 999, borderWidth: 1, borderColor: '#ffffff22', backgroundColor: '#ffffff0c', paddingHorizontal: 9, paddingVertical: 6 },
  liveDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: '#18e07b' },
  completedText: { color: '#ffffffb8', fontWeight: '900', fontSize: 12, letterSpacing: 1 },
  heroCopy: { marginTop: '9%' },
  heroLabel: { color: '#ffffff75', fontWeight: '900', fontSize: 12, letterSpacing: 1 },
  distanceRow: { flexDirection: 'row', alignItems: 'flex-end', marginTop: -2 },
  distance: { color: '#fff', fontWeight: '900', fontSize: 72, lineHeight: 80, letterSpacing: -0.2, maxWidth: '72%' },
  distanceUnitWrap: { marginLeft: 10, paddingBottom: 11 },
  distanceUnit: { color: '#ffd447', fontFamily: 'Manrope_700Bold', fontSize: 15, letterSpacing: 1 },
  duration: { color: '#ffffff9c', fontWeight: '800', fontSize: 12, marginTop: 3 },
  routeStage: { height: '43%', marginTop: '1%', borderRadius: 25, borderWidth: 1, borderColor: '#ffffff12', backgroundColor: '#030607b8', overflow: 'hidden' },
  routeSvg: { position: 'absolute', left: 0, top: 13, right: 0, bottom: 0 },
  routeBadge: { position: 'absolute', zIndex: 2, top: 14, left: 14, backgroundColor: '#ffffff0c', borderRadius: 7, paddingHorizontal: 8, paddingVertical: 5 },
  routeBadgeText: { color: '#ffffff6b', fontWeight: '900', fontSize: 12, letterSpacing: 1 },
  emptyRoute: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyRouteLine: { width: '45%', height: 4, borderRadius: 2, backgroundColor: '#ffd44740', transform: [{ rotate: '-25deg' }] },
  emptyRouteText: { color: '#ffffff55', fontFamily: 'Manrope_700Bold', fontSize: 12, letterSpacing: 1, marginTop: 22 },
  routeLegend: { position: 'absolute', right: 12, bottom: 11, flexDirection: 'row', alignItems: 'center', borderRadius: 999, backgroundColor: '#020303e8', paddingHorizontal: 8, paddingVertical: 5 },
  routeLegendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendDot: { width: 5, height: 5, borderRadius: 3 },
  legendText: { color: '#ffffff8c', fontWeight: '900', fontSize: 12, letterSpacing: 0.8 },
  legendRule: { width: 16, height: 1, backgroundColor: '#ffffff24', marginHorizontal: 6 },
  statsPanel: { marginTop: '5%', borderRadius: 20, borderWidth: 1, borderColor: '#ffffff17', backgroundColor: '#ffffff0a', paddingHorizontal: '5%', paddingVertical: '4%' },
  statsRow: { flexDirection: 'row', alignItems: 'center' },
  statsDivider: { height: 1, backgroundColor: '#ffffff12', marginVertical: '3.3%' },
  statDivider: { width: 1, height: '70%', backgroundColor: '#ffffff15', marginHorizontal: '4%' },
  stat: { flex: 1 },
  statLabel: { color: '#ffffff61', fontSize: 12, fontWeight: '900', letterSpacing: 1 },
  statValue: { color: '#fff', fontSize: 15, fontWeight: '900', marginTop: 4 },
  footer: { flex: 1, justifyContent: 'flex-end' },
  eventStrip: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: '3%' },
  eventValue: { color: '#fff', fontSize: 12, fontWeight: '900' },
  eventLabel: { color: '#ffffff5e', fontSize: 12, fontWeight: '800', letterSpacing: 0.4 },
  eventDot: { width: 3, height: 3, borderRadius: 2, backgroundColor: '#ffd447', marginHorizontal: 8 },
  footerBrand: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginTop: '3%' },
  footerCopy: { color: '#ffffff52', fontWeight: '900', fontSize: 12, letterSpacing: 1 },
  footerVroom: { color: '#ffd447', fontFamily: 'Manrope_700Bold', fontSize: 12, letterSpacing: 1 },
});
