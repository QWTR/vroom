import React, { memo, useMemo } from 'react';
import Mapbox from '@rnmapbox/maps';
import { MAP_LAYER_IDS } from '../../lib/mapScreen/mapLayerContract';
import { NAVIGATION_ROUTE_PALETTE } from '../../constants/navigationPalette';
import { useTheme } from '../../contexts/ThemeContext';

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
  const { isDark } = useTheme();
  const coords = useMemo(
    () => toLineCoords(remainingRoutePoints),
    [remainingRoutePoints],
  );

  const routeShape = useMemo(
    () => coords.length >= 2
      ? lineFeature(coords)
      : ({ type: 'FeatureCollection' as const, features: [] }),
    [coords],
  );

  const navRoute = isNavigating;
  const routeCoreColor = navRoute
    ? (isDark ? NAVIGATION_ROUTE_PALETTE.nightCore : NAVIGATION_ROUTE_PALETTE.dayCore)
    : '#00bfff';
  const routeVisible = coords.length >= 2 && (isNavigating || isDriving);

  const lineCapJoin = { lineCap: 'round' as const, lineJoin: 'round' as const };

  return (
    <>
      <Mapbox.ShapeSource id="routeActiveSource" shape={routeShape}>
        <Mapbox.LineLayer
          id={MAP_LAYER_IDS.routeMain}
          style={{
            lineColor: routeCoreColor,
            lineWidth: navRoute ? 9 : 6,
            lineOpacity: routeVisible ? 1 : 0,
            ...lineCapJoin,
          }}
        />
        <Mapbox.LineLayer
          id={MAP_LAYER_IDS.routeGlow}
          belowLayerID={MAP_LAYER_IDS.routeMain}
          style={{
            lineColor: navRoute ? NAVIGATION_ROUTE_PALETTE.nightGlow : '#ffffff15',
            lineWidth: navRoute ? 17 : 8,
            lineOpacity: routeVisible && navRoute && isDark ? 1 : 0,
            ...lineCapJoin,
          }}
        />
        {navRoute ? (
          <Mapbox.LineLayer
            id={MAP_LAYER_IDS.routeHalo}
            belowLayerID={MAP_LAYER_IDS.routeGlow}
            style={{
              lineColor: NAVIGATION_ROUTE_PALETTE.casing,
              lineWidth: 13,
              lineOpacity: routeVisible ? 0.94 : 0,
              ...lineCapJoin,
            }}
          />
        ) : (
          <Mapbox.LineLayer
            id={MAP_LAYER_IDS.routeHalo}
            belowLayerID={MAP_LAYER_IDS.routeGlow}
            style={{ lineColor: '#00000055', lineWidth: 11, lineOpacity: routeVisible ? 1 : 0, ...lineCapJoin }}
          />
        )}
      </Mapbox.ShapeSource>
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
