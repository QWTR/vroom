import React, { memo, useMemo } from 'react';
import Mapbox from '@rnmapbox/maps';

type Coord = { latitude: number; longitude: number };

function toLineCoords(points: Coord[]): [number, number][] {
  return points.map((c) => [c.longitude, c.latitude]);
}

function lineFeature(coords: [number, number][]) {
  return {
    type: 'Feature' as const,
    geometry: { type: 'LineString' as const, coordinates: coords },
    properties: {},
  };
}

type RouteLayersProps = {
  remainingRoutePoints: Coord[];
  isNavigating: boolean;
  isDriving: boolean;
};

export const MapActiveRouteLayers = memo(function MapActiveRouteLayers({
  remainingRoutePoints,
  isNavigating,
  isDriving,
}: RouteLayersProps) {
  const coords = useMemo(
    () => toLineCoords(remainingRoutePoints),
    [remainingRoutePoints],
  );

  const shadowShape = useMemo(() => lineFeature(coords), [coords]);
  const mainShape = useMemo(() => lineFeature(coords), [coords]);
  const glowShape = useMemo(() => lineFeature(coords), [coords]);

  if (coords.length < 2) return null;

  const navRoute = isNavigating;
  const routeCoreColor = navRoute ? '#FFF200' : '#00bfff';
  const routeHaloColor = navRoute ? '#FFFFFF' : '#ffffff55';

  return (
    <>
      {navRoute ? (
        <Mapbox.ShapeSource id="routeNavHaloSource" shape={shadowShape}>
          <Mapbox.LineLayer
            id="routeNavHaloLayer"
            style={{
              lineColor: routeHaloColor,
              lineWidth: 14,
              lineOpacity: 0.92,
              lineCap: 'round',
              lineJoin: 'round',
            }}
          />
        </Mapbox.ShapeSource>
      ) : (
        <Mapbox.ShapeSource id="routeShadowSource" shape={shadowShape}>
          <Mapbox.LineLayer id="routeShadowLayer" style={{ lineColor: '#00000055', lineWidth: 11, lineCap: 'round', lineJoin: 'round' }} />
        </Mapbox.ShapeSource>
      )}
      <Mapbox.ShapeSource id="routeMainSource" shape={mainShape}>
        <Mapbox.LineLayer
          id="routeMainLayer"
          style={{
            lineColor: routeCoreColor,
            lineWidth: navRoute ? 9 : 6,
            lineCap: 'round',
            lineJoin: 'round',
          }}
        />
      </Mapbox.ShapeSource>
      {(isNavigating || isDriving) ? (
        <Mapbox.ShapeSource id="routeGlowSource" shape={glowShape}>
          <Mapbox.LineLayer
            id="routeGlowLayer"
            style={{
              lineColor: navRoute ? '#FFF20055' : '#ffffff15',
              lineWidth: navRoute ? 12 : 8,
              lineCap: 'round',
              lineJoin: 'round',
            }}
          />
        </Mapbox.ShapeSource>
      ) : null}
    </>
  );
});

type BuilderRouteProps = {
  displaySnappedRoute: Coord[];
  pins: Coord[];
  isBuilding: boolean;
  snappedRoute: Coord[];
};

export const MapBuilderRouteLayers = memo(function MapBuilderRouteLayers({
  displaySnappedRoute,
  pins,
  isBuilding,
  snappedRoute,
}: BuilderRouteProps) {
  const snappedCoords = useMemo(
    () => toLineCoords(displaySnappedRoute),
    [displaySnappedRoute],
  );
  const pinCoords = useMemo(() => toLineCoords(pins), [pins]);

  const snappedShadow = useMemo(() => lineFeature(snappedCoords), [snappedCoords]);
  const snappedMain = useMemo(() => lineFeature(snappedCoords), [snappedCoords]);
  const snappedGlow = useMemo(() => lineFeature(snappedCoords), [snappedCoords]);
  const pinsShadow = useMemo(() => lineFeature(pinCoords), [pinCoords]);
  const pinsDashed = useMemo(() => lineFeature(pinCoords), [pinCoords]);

  return (
    <>
      {displaySnappedRoute.length > 1 ? (
        <>
          <Mapbox.ShapeSource id="snappedShadowSource" shape={snappedShadow}>
            <Mapbox.LineLayer id="snappedShadowLayer" style={{ lineColor: '#00000070', lineWidth: 10, lineCap: 'round', lineJoin: 'round' }} />
          </Mapbox.ShapeSource>
          <Mapbox.ShapeSource id="snappedRouteSource" shape={snappedMain}>
            <Mapbox.LineLayer id="snappedRouteLayer" style={{ lineColor: '#FFF200', lineWidth: 9, lineCap: 'round', lineJoin: 'round' }} />
          </Mapbox.ShapeSource>
          <Mapbox.ShapeSource id="snappedGlowSource" shape={snappedGlow}>
            <Mapbox.LineLayer id="snappedGlowLayer" style={{ lineColor: '#ffffff20', lineWidth: 3, lineCap: 'round', lineJoin: 'round' }} />
          </Mapbox.ShapeSource>
        </>
      ) : null}

      {isBuilding && pins.length > 1 && snappedRoute.length === 0 ? (
        <>
          <Mapbox.ShapeSource id="pinsShadowSource" shape={pinsShadow}>
            <Mapbox.LineLayer id="pinsShadowLayer" style={{ lineColor: '#00000080', lineWidth: 8, lineCap: 'round', lineJoin: 'round' }} />
          </Mapbox.ShapeSource>
          <Mapbox.ShapeSource id="pinsDashedSource" shape={pinsDashed}>
            <Mapbox.LineLayer
              id="pinsDashedLayer"
              style={{
                lineColor: '#ff922b',
                lineWidth: 4,
                lineCap: 'round',
                lineJoin: 'round',
                lineDasharray: [12, 7],
              }}
            />
          </Mapbox.ShapeSource>
        </>
      ) : null}
    </>
  );
});
