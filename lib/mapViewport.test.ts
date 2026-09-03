import { describe, expect, it } from 'vitest';
import {
  MAP_LIVE_DETAIL_MIN_ZOOM,
  MAP_LIVE_MIN_ZOOM,
  MAP_POI_CARD_MIN_ZOOM,
  MAP_POI_LABEL_MIN_ZOOM,
  MAP_POI_MIN_ZOOM,
  createMapViewport,
  isCoordinateInViewport,
  viewportCacheKey,
  viewportQueryBoxes,
} from './mapViewport';

describe('map viewport', () => {
  it('keeps LIVE users visible as individual markers at every zoom', () => {
    expect(MAP_POI_MIN_ZOOM).toBe(11.5);
    expect(MAP_POI_CARD_MIN_ZOOM).toBe(14.5);
    expect(MAP_POI_LABEL_MIN_ZOOM).toBe(MAP_POI_CARD_MIN_ZOOM);
    expect(MAP_LIVE_MIN_ZOOM).toBe(0);
    expect(MAP_LIVE_DETAIL_MIN_ZOOM).toBe(11.5);
  });
  it('builds center and 20% query overscan', () => {
    const viewport = createMapViewport([[20, 54], [18, 52]], 14, 3)!;
    expect(viewport.center).toEqual({ latitude: 53, longitude: 19 });
    const box = viewportQueryBoxes(viewport)[0];
    expect(box.north).toBeCloseTo(54.4);
    expect(box.south).toBeCloseTo(51.6);
    expect(box.west).toBeCloseTo(17.6);
    expect(box.east).toBeCloseTo(20.4);
  });

  it('splits a viewport crossing longitude 180', () => {
    const viewport = createMapViewport([[-179, 20], [179, 10]], 13, 1)!;
    const boxes = viewportQueryBoxes(viewport);
    expect(boxes).toHaveLength(2);
    expect(isCoordinateInViewport(15, 179.5, viewport)).toBe(true);
    expect(isCoordinateInViewport(15, -179.5, viewport)).toBe(true);
    expect(isCoordinateInViewport(15, 0, viewport)).toBe(false);
  });

  it('uses region and zoom bucket in the cache key, not request revision', () => {
    const first = createMapViewport([[20, 54], [18, 52]], 14.2, 1)!;
    const sameRegion = { ...first, revision: 99 };
    const otherRegion = createMapViewport([[24, 54], [22, 52]], 14.2, 2)!;
    const otherZoom = { ...first, zoom: 15 };
    expect(viewportCacheKey(first)).toBe(viewportCacheKey(sameRegion));
    expect(viewportCacheKey(first)).not.toBe(viewportCacheKey(otherRegion));
    expect(viewportCacheKey(first)).not.toBe(viewportCacheKey(otherZoom));
  });
});
