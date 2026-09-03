import type { FuelStation } from '../hooks/useFuelStations';
import type { OfficialMapMeet } from '../hooks/useOfficialMapMeets';
import type { PartnerPoi } from '../hooks/usePartnerPois';
import { MAP_MARKER_IMAGE_KEYS } from '../constants/mapMarkerAssets';
import { resolveStationDisplayPrice } from './fuelDisplayPrice';

export type MapPoiKind = 'fuel' | 'partner' | 'meet';

export type MapPoiFeatureProperties = {
  id: string;
  kind: MapPoiKind;
  title: string;
  subtitle: string;
  compactImageKey: string;
  cardImageKey: string;
  hasOffer: 0 | 1;
  sortKey: number;
  titleColor: string;
  subtitleColor: string;
};

export type MapPoiFeature = {
  type: 'Feature';
  id: string;
  geometry: { type: 'Point'; coordinates: [number, number] };
  properties: MapPoiFeatureProperties;
};

export type MapPoiFeatureCollection = {
  type: 'FeatureCollection';
  features: MapPoiFeature[];
};

export function truncateMapPoiText(value: unknown, maxLength: number): string {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(1, maxLength - 1)).trimEnd()}…`;
}

function pointFeature(
  id: string,
  longitude: number,
  latitude: number,
  properties: MapPoiFeatureProperties,
): MapPoiFeature | null {
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return null;
  return {
    type: 'Feature',
    id,
    geometry: { type: 'Point', coordinates: [longitude, latitude] },
    properties,
  };
}

export function createMapPoiShape(
  stations: FuelStation[],
  partners: PartnerPoi[],
  meets: OfficialMapMeet[],
  preferredFuel?: string | null,
): MapPoiFeatureCollection {
  const features: MapPoiFeature[] = [];

  stations.forEach((station) => {
    const display = resolveStationDisplayPrice(station.prices, preferredFuel);
    const feature = pointFeature(`fuel:${station.id}`, station.lng, station.lat, {
      id: String(station.id),
      kind: 'fuel',
      title: truncateMapPoiText((station.brand || station.name || 'STACJA').toUpperCase(), 12),
      subtitle: display ? `${display.label} ${display.value.toFixed(2)}` : 'BRAK CENY',
      compactImageKey: MAP_MARKER_IMAGE_KEYS.fuelCompact,
      cardImageKey: MAP_MARKER_IMAGE_KEYS.fuelCard,
      hasOffer: 0,
      sortKey: 30,
      titleColor: '#D8E9FF',
      subtitleColor: display ? '#7DD3FC' : '#8B95A6',
    });
    if (feature) features.push(feature);
  });

  partners.forEach((partner) => {
    const feature = pointFeature(`partner:${partner.id}`, partner.lng, partner.lat, {
      id: String(partner.id),
      kind: 'partner',
      title: 'PARTNER',
      subtitle: truncateMapPoiText(partner.name || 'VROOM', 13),
      compactImageKey: MAP_MARKER_IMAGE_KEYS.partnerCompact,
      cardImageKey: partner.hasActiveOffer ? MAP_MARKER_IMAGE_KEYS.partnerOfferCard : MAP_MARKER_IMAGE_KEYS.partnerCard,
      hasOffer: partner.hasActiveOffer ? 1 : 0,
      sortKey: 50,
      titleColor: '#FF6662',
      subtitleColor: '#EDF3FF',
    });
    if (feature) features.push(feature);
  });

  meets.forEach((meet) => {
    const hot = String(meet.status ?? '').toUpperCase() === 'HOT';
    const feature = pointFeature(`meet:${meet.id}`, meet.lng, meet.lat, {
      id: String(meet.id),
      kind: 'meet',
      title: hot ? 'HOT EVENT' : 'EVENT',
      subtitle: truncateMapPoiText(meet.title || meet.locationName || 'SPOT', 13),
      compactImageKey: MAP_MARKER_IMAGE_KEYS.meetCompact,
      cardImageKey: MAP_MARKER_IMAGE_KEYS.meetCard,
      hasOffer: 0,
      sortKey: 40,
      titleColor: hot ? '#FFB547' : '#F5D95A',
      subtitleColor: '#F6F8FC',
    });
    if (feature) features.push(feature);
  });

  return { type: 'FeatureCollection', features };
}
