import { useState, useCallback, useRef } from 'react';
import { fetchSearchCategoryViaProxy, isMapboxProxyAbortError } from '../scripts/mapboxProxyClient';

export interface NearbyPlace {
  placeId:   string;
  name:      string;
  address:   string;
  lat:       number;
  lng:       number;
  rating?:   number;
  isOpen?:   boolean;
  distance?: number;
}

export type PlaceCategory =
  | 'gas_station'
  | 'restaurant'
  | 'cafe'
  | 'parking'
  | 'car_wash'
  | 'car_repair'
  | 'hotel'
  | 'atm'
  | 'supermarket'  // ← NOWE
  | 'store';

export const PLACE_CATEGORIES: {
  key:   PlaceCategory;
  label: string;
  icon:  string;
  color: string;
  emoji: string;
}[] = [
  { key: 'gas_station', label: 'STACJE',    icon: 'local-gas-station', color: '#ff922b', emoji: '⛽' },
  { key: 'restaurant',  label: 'JEDZENIE',  icon: 'restaurant',        color: '#e33835', emoji: '🍔' },
  { key: 'supermarket', label: 'SKLEPY',    icon: 'shopping-cart',     color: '#4CAF50', emoji: '🛒' }, // ← NOWE
  { key: 'cafe',        label: 'KAWIARNIE', icon: 'local-cafe',        color: '#a0522d', emoji: '☕' },
  { key: 'parking',     label: 'PARKINGI',  icon: 'local-parking',     color: '#268bff', emoji: '🅿️' },
  { key: 'car_wash',    label: 'MYJNIE',    icon: 'local-car-wash',    color: '#00bfff', emoji: '🚿' },
  { key: 'car_repair',  label: 'WARSZTATY', icon: 'build',             color: '#ff922b', emoji: '🔧' },
  { key: 'hotel',       label: 'HOTELE',    icon: 'hotel',             color: '#a855f7', emoji: '🏨' },
  { key: 'atm',         label: 'BANKOMATY', icon: 'local-atm',         color: '#f5c518', emoji: '💳' },
];

export const BRAND_KEYWORDS: {
  keywords: string[];
  type:     PlaceCategory;
  label:    string;
}[] = [
  {
    keywords: ['orlen', 'bp', 'shell', 'lotos', 'circle k', 'mol', 'amic', 'stacja paliw', 'paliwo'],
    type: 'gas_station',
    label: 'Stacje paliw',
  },
  {
    // ← Sklepy spożywcze — supermarket zamiast restaurant
    keywords: ['lidl', 'biedronka', 'kaufland', 'aldi', 'netto', 'spar', 'carrefour', 'tesco', 'dino', 'sklep', 'supermarket', 'spożywczy'],
    type: 'supermarket',
    label: 'Sklepy',
  },
  {
    keywords: ['mcdonald', 'mcdonalds', 'kfc', 'burger king', 'subway', 'pizza hut', 'dominos', 'kebab', 'restauracja', 'jedzenie'],
    type: 'restaurant',
    label: 'Restauracje',
  },
  {
    keywords: ['myjnia', 'car wash', 'autowash'],
    type: 'car_wash',
    label: 'Myjnie',
  },
  {
    keywords: ['parking', 'parkuj'],
    type: 'parking',
    label: 'Parkingi',
  },
  {
    keywords: ['starbucks','żabka', 'zabka', 'costa coffee', 'kawiarnia', 'coffeeheaven', 'kawa'],
    type: 'cafe',
    label: 'Kawiarnie',
  },
  {
    keywords: ['hotel', 'motel', 'hostel', 'nocleg', 'ibis', 'hilton', 'marriott'],
    type: 'hotel',
    label: 'Hotele',
  },
  {
    keywords: ['bankomat', 'wypłat', 'pko bp', 'santander', 'mbank', 'ing'],
    type: 'atm',
    label: 'Bankomaty',
  },
  {
    keywords: ['warsztat', 'serwis samochodowy', 'mechanik', 'wulkanizacja', 'opony'],
    type: 'car_repair',
    label: 'Warsztaty',
  },
];

export function detectBrand(query: string): { type: PlaceCategory; label: string } | null {
  const q = query.toLowerCase().trim();
  for (const entry of BRAND_KEYWORDS) {
    for (const kw of entry.keywords) {
      if (q.includes(kw)) {
        return { type: entry.type, label: entry.label };
      }
    }
  }
  return null;
}

// Mapowanie kategorii aplikacji → Mapbox Search Box
const MAPBOX_CATEGORY: Record<PlaceCategory, string> = {
  gas_station: 'gas_station',
  restaurant:  'restaurant',
  cafe:        'cafe',
  parking:     'parking_lot',
  car_wash:    'car_wash',
  car_repair:  'auto_repair',
  hotel:       'hotel',
  atm:         'atm',
  supermarket: 'supermarket',
  store:       'convenience_store',
};

function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
    Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function usePlacesNearby() {
  const [places,         setPlaces]         = useState<NearbyPlace[]>([]);
  const [loading,        setLoading]        = useState(false);
  const [activeCategory, setActiveCategory] = useState<PlaceCategory | null>(null);
  const cacheRef = useRef<Map<string, { at: number; items: NearbyPlace[] }>>(new Map());
  const lastReqRef = useRef<{ lat: number; lng: number; at: number; category: PlaceCategory } | null>(null);

  const fetchPlaces = useCallback(async (
    lat:      number,
    lng:      number,
    category: PlaceCategory,
    // Mapbox Search Box używa własnego zasięgu (~5 km); parametr jest ignorowany
    // ale zachowany dla zachowania kompatybilności z dotychczasowym API hooka.
    radiusM = 5000, // eslint-disable-line @typescript-eslint/no-unused-vars
    signal?:  AbortSignal,
  ) => {
    if (signal?.aborted) return;
    const now = Date.now();
    const last = lastReqRef.current;
    if (last && last.category === category) {
      const movedM = haversineM(last.lat, last.lng, lat, lng);
      if (now - last.at < 90_000 && movedM < 800) return;
    }
    const key = `${category}:${Math.round(lat * 100) / 100}:${Math.round(lng * 100) / 100}`;
    const cached = cacheRef.current.get(key);
    if (cached && now - cached.at < 300_000) {
      if (signal?.aborted) return;
      setActiveCategory(category);
      setPlaces(cached.items);
      return;
    }

    setLoading(true);
    setActiveCategory(category);
    setPlaces([]);
    try {
      const mapboxCategory = MAPBOX_CATEGORY[category];
      const data = await fetchSearchCategoryViaProxy<any>({
        category: mapboxCategory,
        proximityLng: lng,
        proximityLat: lat,
        limit: 20,
        language: 'pl',
        signal,
      });
      if (signal?.aborted) return;
      if (data.features) {
        const mapped: NearbyPlace[] = data.features
          .slice(0, 20)
          .map((f: any) => ({
            placeId:  f.properties.mapbox_id ?? f.id,
            name:     f.properties.name,
            address:  f.properties.full_address ?? f.properties.address ?? '',
            lat:      f.geometry.coordinates[1],
            lng:      f.geometry.coordinates[0],
            rating:   f.properties.rating,
            isOpen:   f.properties.metadata?.open_hours?.open_now,
            distance: f.properties.distance != null
              ? f.properties.distance / 1000
              : undefined,
          }))
          .sort((a: NearbyPlace, b: NearbyPlace) => (a.distance ?? 0) - (b.distance ?? 0));
        setPlaces(mapped);
        cacheRef.current.set(key, { at: now, items: mapped });
        lastReqRef.current = { lat, lng, at: now, category };
      }
    } catch (e) {
      if (isMapboxProxyAbortError(e)) return;
      console.warn('usePlacesNearby error:', e);
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  const clear = useCallback(() => {
    setPlaces([]);
    setActiveCategory(null);
  }, []);

  return { places, loading, activeCategory, fetchPlaces, clear };
}