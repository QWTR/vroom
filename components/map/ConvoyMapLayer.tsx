import Mapbox from '@rnmapbox/maps';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import React, { useMemo } from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { AppText as Text } from '../ui/AppText';
import type { ConvoySnapshot } from '../../lib/convoyLive';

export function ConvoyMapLayer({
  snapshot,
  onMeetingPress,
  showSharedRoute = true,
}: {
  snapshot: ConvoySnapshot | null;
  onMeetingPress?: () => void;
  showSharedRoute?: boolean;
}) {
  const routeShape = useMemo(() => {
    const coordinates = (snapshot?.convoy.route?.points ?? [])
      .slice()
      .sort((a, b) => Number(a.order ?? 0) - Number(b.order ?? 0))
      .map((point) => [Number(point.longitude), Number(point.latitude)])
      .filter(([longitude, latitude]) => Number.isFinite(longitude) && Number.isFinite(latitude));
    return coordinates.length >= 2 ? {
      type: 'Feature' as const,
      properties: {},
      geometry: { type: 'LineString' as const, coordinates },
    } : null;
  }, [snapshot]);

  const meetingShape = useMemo(() => {
    if (snapshot?.convoy.meetingLat == null || snapshot?.convoy.meetingLng == null) return null;
    const lat = Number(snapshot?.convoy.meetingLat);
    const lng = Number(snapshot?.convoy.meetingLng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { type: 'Feature' as const, properties: { label: 'PUNKT ZBIÓRKI' }, geometry: { type: 'Point' as const, coordinates: [lng, lat] } };
  }, [snapshot]);

  if (!snapshot || snapshot.convoy.status !== 'active') return null;
  return <>
    {routeShape && showSharedRoute && <Mapbox.ShapeSource id="convoy-active-route-source" shape={routeShape}>
      <Mapbox.LineLayer id="convoy-active-route-glow" style={{ lineColor: '#FFD44755', lineWidth: 10, lineCap: 'round', lineJoin: 'round' }} />
      <Mapbox.LineLayer id="convoy-active-route-line" style={{ lineColor: '#FFD447', lineWidth: 4, lineCap: 'round', lineJoin: 'round' }} />
    </Mapbox.ShapeSource>}
    {meetingShape && <Mapbox.MarkerView
      coordinate={meetingShape.geometry.coordinates as [number, number]}
      anchor={{ x: 0.5, y: 1 }}
      allowOverlap
    >
      <TouchableOpacity accessibilityRole="button" accessibilityLabel="Nawiguj do punktu zbiórki" onPress={onMeetingPress} activeOpacity={0.82} style={styles.meetingMarker}>
        <View style={styles.meetingIcon}>
          <MaterialCommunityIcons name="flag-checkered" size={20} color="#171200" />
        </View>
        <Text style={styles.meetingLabel}>PUNKT ZBIÓRKI</Text>
      </TouchableOpacity>
    </Mapbox.MarkerView>}
  </>;
}

const styles = StyleSheet.create({
  meetingMarker: { alignItems: 'center', minWidth: 96, minHeight: 52 },
  meetingIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFD447',
    borderWidth: 3,
    borderColor: '#090909',
  },
  meetingLabel: {
    marginTop: 2,
    color: '#FFD447',
    backgroundColor: '#090909E8',
    borderRadius: 7,
    paddingHorizontal: 7,
    paddingVertical: 3,
    fontSize: 8,
    fontFamily: 'Manrope_700Bold',
  },
});
