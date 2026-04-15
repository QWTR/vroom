import { useState, useCallback } from 'react';
import { GOOGLE_MAPS_APIKEY } from '../constants/mapConfig';

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

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R    = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a    =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
    Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function usePlacesNearby() {
  const [places,         setPlaces]         = useState<NearbyPlace[]>([]);
  const [loading,        setLoading]        = useState(false);
  const [activeCategory, setActiveCategory] = useState<PlaceCategory | null>(null);

  const fetchPlaces = useCallback(async (
    lat:      number,
    lng:      number,
    category: PlaceCategory,
    radiusM = 5000,
  ) => {
    setLoading(true);
    setActiveCategory(category);
    setPlaces([]);
    try {
      const url =
        `https://maps.googleapis.com/maps/api/place/nearbysearch/json?` +
        `location=${lat},${lng}&radius=${radiusM}&type=${category}` +
        `&key=${GOOGLE_MAPS_APIKEY}&language=pl`;
      const res  = await fetch(url);
      const data = await res.json();
      if (data.results) {
        const mapped: NearbyPlace[] = data.results
          .slice(0, 20)
          .map((p: any) => ({
            placeId:  p.place_id,
            name:     p.name,
            address:  p.vicinity ?? '',
            lat:      p.geometry.location.lat,
            lng:      p.geometry.location.lng,
            rating:   p.rating,
            isOpen:   p.opening_hours?.open_now,
            distance: haversineKm(lat, lng, p.geometry.location.lat, p.geometry.location.lng),
          }))
          .sort((a: NearbyPlace, b: NearbyPlace) => (a.distance ?? 0) - (b.distance ?? 0));
        setPlaces(mapped);
      }
    } catch (e) {
      console.warn('usePlacesNearby error:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  const clear = useCallback(() => {
    setPlaces([]);
    setActiveCategory(null);
  }, []);

  return { places, loading, activeCategory, fetchPlaces, clear };
}