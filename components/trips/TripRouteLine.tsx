import React, { useMemo } from 'react';
import Mapbox from '@rnmapbox/maps';
import { buildTripRouteLine, type SpeedPalette, type TripRoutePoint } from '../../lib/tripRouteLine';

export function TripRouteLine({ id, points, showSpeed, palette }: {
  id: string;
  points: readonly TripRoutePoint[];
  showSpeed: boolean;
  palette: SpeedPalette;
}) {
  const route = useMemo(() => buildTripRouteLine(points, palette), [points, palette]);
  if (!route) return null;
  return <Mapbox.ShapeSource id={id} shape={route.shape} lineMetrics tolerance={0}>
    <Mapbox.LineLayer id={`${id}-line`} style={{
      lineColor: '#FFD447',
      lineGradient: showSpeed ? route.gradient : '#FFD447',
      lineWidth: 6,
      lineCap: 'round',
      lineJoin: 'round',
    }} />
  </Mapbox.ShapeSource>;
}
