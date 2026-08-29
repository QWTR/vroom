import Mapbox from '@rnmapbox/maps';
import React, { useMemo } from 'react';
import type { ConvoySnapshot } from '../../lib/convoyLive';
import { CONVOY_STATUS_LABELS } from '../../lib/convoyLive';

export function ConvoyMapLayer({ snapshot }: { snapshot: ConvoySnapshot | null }) {
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

  const participantShape = useMemo(() => ({
    type: 'FeatureCollection' as const,
    features: (snapshot?.participants ?? []).flatMap((participant) => {
      const lat = Number(participant.position?.lat);
      const lng = Number(participant.position?.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return [];
      const status = participant.quickStatus ? CONVOY_STATUS_LABELS[participant.quickStatus] : null;
      return [{
        type: 'Feature' as const,
        id: `convoy-user-${participant.userId}`,
        properties: {
          userId: participant.userId,
          label: `${participant.user.username}${status ? ` · ${status}` : ''}`,
          host: participant.userId === snapshot?.convoy.hostId,
          paused: participant.connection === 'paused',
        },
        geometry: { type: 'Point' as const, coordinates: [lng, lat] },
      }];
    }),
  }), [snapshot]);

  const meetingShape = useMemo(() => {
    const lat = Number(snapshot?.convoy.meetingLat);
    const lng = Number(snapshot?.convoy.meetingLng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { type: 'Feature' as const, properties: { label: 'PUNKT ZBIÓRKI' }, geometry: { type: 'Point' as const, coordinates: [lng, lat] } };
  }, [snapshot]);

  if (!snapshot || snapshot.convoy.status !== 'active') return null;
  return <>
    {routeShape && <Mapbox.ShapeSource id="convoy-active-route-source" shape={routeShape}>
      <Mapbox.LineLayer id="convoy-active-route-glow" style={{ lineColor: '#FFD44755', lineWidth: 10, lineCap: 'round', lineJoin: 'round' }} />
      <Mapbox.LineLayer id="convoy-active-route-line" style={{ lineColor: '#FFD447', lineWidth: 4, lineCap: 'round', lineJoin: 'round' }} />
    </Mapbox.ShapeSource>}
    {meetingShape && <Mapbox.ShapeSource id="convoy-meeting-source" shape={meetingShape}>
      <Mapbox.CircleLayer id="convoy-meeting-ring" style={{ circleRadius: 12, circleColor: '#FFD44722', circleStrokeColor: '#FFD447', circleStrokeWidth: 3 }} />
      <Mapbox.SymbolLayer id="convoy-meeting-label" style={{ textField: ['get', 'label'] as any, textSize: 9, textColor: '#FFD447', textHaloColor: '#090909', textHaloWidth: 2, textOffset: [0, 2.2] }} />
    </Mapbox.ShapeSource>}
    <Mapbox.ShapeSource id="convoy-participants-source" shape={participantShape}>
      <Mapbox.CircleLayer id="convoy-participants-glow" style={{ circleRadius: 14, circleColor: ['case', ['get', 'host'], '#FFD44733', ['get', 'paused'], '#ff922b33', '#31c8ff33'] as any }} />
      <Mapbox.CircleLayer id="convoy-participants-dot" style={{ circleRadius: 8, circleColor: ['case', ['get', 'host'], '#FFD447', ['get', 'paused'], '#ff922b', '#31c8ff'] as any, circleStrokeColor: '#090909', circleStrokeWidth: 2 }} />
      <Mapbox.SymbolLayer id="convoy-participants-label" style={{ textField: ['get', 'label'] as any, textSize: 10, textColor: '#ffffff', textHaloColor: '#090909', textHaloWidth: 2, textOffset: [0, 2] }} />
    </Mapbox.ShapeSource>
  </>;
}
