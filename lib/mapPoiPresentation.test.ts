import { describe, expect, it } from 'vitest';
import type { FuelStation } from '../hooks/useFuelStations';
import type { OfficialMapMeet } from '../hooks/useOfficialMapMeets';
import type { PartnerPoi } from '../hooks/usePartnerPois';
import { createMapPoiShape, truncateMapPoiText } from './mapPoiPresentation';

const station = {
  id: '7',
  dbId: 7,
  name: 'Stacja przy autostradzie',
  brand: 'Orlen',
  lat: 51.1,
  lng: 19.2,
  prices: [{ pb95: 6.29, pb98: 6.99, diesel: 6.41, lpg: null, updatedAt: null, updatedBy: null }],
} satisfies FuelStation;

const partner = {
  id: 8,
  name: 'VROOM Performance Garage',
  brandSlug: 'vroom',
  lat: 51.2,
  lng: 19.3,
  logoUrl: null,
  websiteUrl: null,
  priorityRank: 10,
  source: 'partner',
  hasActiveOffer: true,
} satisfies PartnerPoi;

const meet = {
  id: 9,
  title: 'Nocne spotkanie klasyków',
  locationName: 'Łódź',
  lat: 51.3,
  lng: 19.4,
  date: '2026-09-03',
  coverImage: null,
  status: 'HOT',
  category: 'official',
  ticketPrice: null,
  ticketCurrency: 'PLN',
  maxParticipants: 100,
  participantsCount: 10,
  source: 'official_meet',
} satisfies OfficialMapMeet;

describe('map POI presentation', () => {
  it('creates exactly one independent feature for every valid POI', () => {
    const shape = createMapPoiShape([station], [partner], [meet], 'pb95');
    expect(shape.features).toHaveLength(3);
    expect(new Set(shape.features.map((feature) => feature.id)).size).toBe(3);
    expect(shape.features.map((feature) => feature.properties.kind)).toEqual(['fuel', 'partner', 'meet']);
  });

  it('formats the two information rows and chooses the offer card', () => {
    const shape = createMapPoiShape([station], [partner], [meet], 'pb98');
    const fuel = shape.features[0].properties;
    const partnerFeature = shape.features[1].properties;
    const event = shape.features[2].properties;

    expect(fuel).toMatchObject({ title: 'ORLEN', subtitle: 'PB98 6.99', hasOffer: 0 });
    expect(partnerFeature.title).toBe('PARTNER');
    expect(partnerFeature.cardImageKey).toContain('offer');
    expect(partnerFeature.subtitle.endsWith('…')).toBe(true);
    expect(event).toMatchObject({ title: 'HOT EVENT' });
  });

  it('uses BRAK CENY and excludes invalid coordinates', () => {
    const noPrice = { ...station, id: '10', prices: [] };
    const invalid = { ...station, id: '11', lat: Number.NaN };
    const shape = createMapPoiShape([noPrice, invalid], [], []);
    expect(shape.features).toHaveLength(1);
    expect(shape.features[0].properties.subtitle).toBe('BRAK CENY');
  });

  it('normalizes whitespace and truncates deterministically', () => {
    expect(truncateMapPoiText('  Bardzo   długa nazwa ', 12)).toBe('Bardzo dług…');
  });
});

