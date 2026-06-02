import AsyncStorage from '@react-native-async-storage/async-storage';
import type { LocationState } from '../constants/types';

export interface SearchPlaceHistoryEntry extends LocationState {
  secondaryText?: string;
  usedAt: number;
}

const STORAGE_KEY = '@vroom/search_place_history_v1';
const MAX_ENTRIES = 5;
const DEDUPE_RADIUS_M = 80;

const EXCLUDED_NAMES = new Set(['moja pozycja']);

let cache: SearchPlaceHistoryEntry[] | null = null;

function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2
    + Math.cos((lat1 * Math.PI) / 180)
    * Math.cos((lat2 * Math.PI) / 180)
    * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function isSamePlace(a: SearchPlaceHistoryEntry, b: LocationState): boolean {
  if (
    a.placeId
    && b.placeId
    && a.placeId === b.placeId
  ) {
    return true;
  }
  if (
    !Number.isFinite(a.latitude)
    || !Number.isFinite(a.longitude)
    || !Number.isFinite(b.latitude)
    || !Number.isFinite(b.longitude)
  ) {
    return false;
  }
  return haversineM(a.latitude, a.longitude, b.latitude, b.longitude) <= DEDUPE_RADIUS_M;
}

function parseStored(raw: string | null): SearchPlaceHistoryEntry[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((e) =>
        e
        && Number.isFinite(e.latitude)
        && Number.isFinite(e.longitude)
        && typeof e.usedAt === 'number',
      )
      .slice(0, MAX_ENTRIES);
  } catch {
    return [];
  }
}

export async function loadSearchPlaceHistory(): Promise<SearchPlaceHistoryEntry[]> {
  if (cache) return cache;
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  cache = parseStored(raw);
  return cache;
}

export async function saveSearchPlaceHistoryEntry(
  location: LocationState,
  secondaryText?: string,
): Promise<SearchPlaceHistoryEntry[]> {
  const name = (location.name ?? '').trim();
  if (!name || EXCLUDED_NAMES.has(name.toLowerCase())) {
    return cache ?? [];
  }
  if (!Number.isFinite(location.latitude) || !Number.isFinite(location.longitude)) {
    return cache ?? [];
  }

  const current = cache ?? parseStored(await AsyncStorage.getItem(STORAGE_KEY));
  const entry: SearchPlaceHistoryEntry = {
    latitude: location.latitude,
    longitude: location.longitude,
    name,
    placeId: location.placeId,
    secondaryText: secondaryText?.trim() || undefined,
    usedAt: Date.now(),
  };

  const withoutDupes = current.filter((item) => !isSamePlace(item, entry));
  const next = [entry, ...withoutDupes].slice(0, MAX_ENTRIES);
  cache = next;
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  return next;
}

export function filterSearchPlaceHistory(
  history: SearchPlaceHistoryEntry[],
  query: string,
): SearchPlaceHistoryEntry[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return history;
  return history.filter((item) => {
    const hay = `${item.name ?? ''} ${item.secondaryText ?? ''}`.toLowerCase();
    return hay.includes(normalized);
  });
}
