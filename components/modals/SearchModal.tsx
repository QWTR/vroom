import React, { useState, useEffect, useRef, useCallback, memo, useMemo } from 'react';
import { Modal, View, TouchableOpacity, FlatList, ActivityIndicator, StyleSheet, Platform, StatusBar, ScrollView, BackHandler } from 'react-native';
import { AppText as Text, AppTextInput as TextInput } from '../ui/AppText';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import debounce from 'lodash.debounce';
import Toast from 'react-native-toast-message';
import { User, LocationState } from '../../constants/types';
import { calculateDistance } from '../../scripts/distance';
import { MAX_NEARBY_USERS_DISTANCE } from '../../constants/mapConfig';
import { useTheme } from '../../contexts/ThemeContext';
import {
  usePlacesNearby,
  PLACE_CATEGORIES,
  PlaceCategory,
  NearbyPlace,
} from '../../hooks/usePlacesNearby';
import {
  createMapboxSearchSessionToken,
  fetchGeocodingViaProxy,
  fetchSearchRetrieveViaProxy,
  fetchSearchSuggestViaProxy,
  isMapboxProxyAbortError,
  resetSearchSuggestBudget,
} from '../../scripts/mapboxProxyClient';
import { useKeyboardInset } from '../../hooks/useKeyboardInset';
import { fetchPartnerPoisSearch } from '../../hooks/usePartnerPois';
import {
  filterSearchPlaceHistory,
  loadSearchPlaceHistory,
  saveSearchPlaceHistoryEntry,
  type SearchPlaceHistoryEntry,
} from '../../lib/searchPlaceHistory';

interface GeocodingResult {
  mapboxId:      string;
  mainText:      string;
  secondaryText: string;
  latitude:      number;
  longitude:     number;
  needsRetrieve?: boolean;
  fromHistory?:  boolean;
  historyEntry?: SearchPlaceHistoryEntry;
}

const SEARCH_SESSION_IDLE_MS = 12 * 60 * 1000;
/** Szukaj dopiero gdy użytkownik przestanie pisać. */
const SEARCH_DEBOUNCE_MS = 380;
const SEARCH_MIN_QUERY_LEN = 2;
const SEARCH_CACHE_MAX_AGE_MS = 120_000;
const SEARCH_RESULT_LIMIT = 12;
const SEARCH_TYPES = 'poi,address,street,place,locality,neighborhood';
const SEARCH_TYPES_DETAILED = 'address,street,poi,place,locality';

const STREET_PREFIX_RE = /\bul\.?\b|\bulica\b|\bal\.?\b|\baleja\b|\bos\.?\b|\bpl\.?\b|\bplac\b/i;
const HOUSE_NUMBER_RE = /\b\d+[a-zA-Z]?\b/;

function normalizePolishSearchText(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function queryHasHousenumber(query: string): boolean {
  return HOUSE_NUMBER_RE.test(query);
}

function isLocalityOnlyResult(r: GeocodingResult): boolean {
  const main = normalizePolishSearchText(r.mainText);
  const secondary = normalizePolishSearchText(r.secondaryText);
  if (HOUSE_NUMBER_RE.test(main)) return false;
  if (secondary.includes('gmina') || secondary.includes('wojewodztwo') || secondary.includes('powiat')) {
    return true;
  }
  return main.length > 0 && !HOUSE_NUMBER_RE.test(`${main} ${secondary}`)
    && (secondary.includes('gmina') || secondary.split(',').length >= 2);
}

function filterWeakAddressResults(results: GeocodingResult[], query: string): GeocodingResult[] {
  if (!queryHasHousenumber(query)) return results;
  const strong = results.filter((r) => {
    if (HOUSE_NUMBER_RE.test(r.mainText)) return true;
    return !isLocalityOnlyResult(r);
  });
  return strong.length > 0 ? strong : results;
}

function shouldSkipSearchCache(query: string, results: GeocodingResult[]): boolean {
  if (!queryHasHousenumber(query)) return false;
  if (results.length !== 1) return false;
  return isLocalityOnlyResult(results[0]);
}

function isDetailedPlaceQuery(query: string): boolean {
  const q = query.trim();
  if (q.length < SEARCH_MIN_QUERY_LEN) return false;
  if (/\d/.test(q)) return true;
  if (/,/.test(q)) return true;
  if (STREET_PREFIX_RE.test(q)) return true;
  const parts = q.split(/\s+/).filter(Boolean);
  return parts.length >= 2;
}

function suggestResultsLookGeneric(results: GeocodingResult[], query: string): boolean {
  if (results.length === 0) return true;
  const q = normalizePolishSearchText(query);
  if (!q) return false;
  const tokens = q.split(/\s+/).filter((t) => t.length >= 2);
  if (tokens.length === 0) return false;
  const strongMatches = results.filter((r) => {
    const hay = normalizePolishSearchText(`${r.mainText} ${r.secondaryText}`);
    return tokens.some((token) => hay.includes(token));
  });
  return strongMatches.length < Math.min(2, results.length);
}

function filterByRelevance(results: GeocodingResult[], query: string): GeocodingResult[] {
  if (results.length <= 1) return results;
  if (isDetailedPlaceQuery(query)) return results.slice(0, SEARCH_RESULT_LIMIT);
  const scored = results.map((r) => ({ r, s: relevanceScore(r, query) }));
  const best = Math.max(...scored.map((x) => x.s));
  if (best < 30) return results;
  const cutoff = Math.max(18, best * 0.22);
  const kept = scored.filter((x) => x.s >= cutoff).map((x) => x.r);
  return kept.length > 0 ? kept : results.slice(0, SEARCH_RESULT_LIMIT);
}

function searchResultKey(r: GeocodingResult): string {
  if (r.mapboxId && !r.mapboxId.startsWith('history_')) return r.mapboxId;
  if (Number.isFinite(r.latitude) && Number.isFinite(r.longitude)) {
    return `${r.latitude.toFixed(4)}_${r.longitude.toFixed(4)}`;
  }
  return `${r.mainText}_${r.secondaryText}`.toLowerCase();
}

function relevanceScore(r: GeocodingResult, query: string): number {
  const q = normalizePolishSearchText(query);
  const main = normalizePolishSearchText(r.mainText);
  const secondary = normalizePolishSearchText(r.secondaryText);
  const hay = `${main} ${secondary}`;
  let score = 0;

  if (!q) return score;
  if (hay.includes(q)) score += 120;
  if (main === q) score += 200;
  if (main.replace(/\s+/g, '') === q.replace(/\s+/g, '')) score += 160;
  if (main.includes(q)) score += 80;
  if (main.startsWith(q)) score += 40;

  const tokens = q.split(/\s+/).filter(Boolean);
  for (const token of tokens) {
    if (token.length < 2) continue;
    if (main.includes(token)) score += 18;
    if (secondary.includes(token)) score += 10;
  }

  const queryHouse = q.match(HOUSE_NUMBER_RE)?.[0];
  const mainHouse = main.match(HOUSE_NUMBER_RE)?.[0];
  if (queryHouse && mainHouse && queryHouse === mainHouse) score += 90;
  if (queryHouse && mainHouse) {
    const qBase = queryHouse.match(/^(\d+)/)?.[1];
    const mBase = mainHouse.match(/^(\d+)/)?.[1];
    if (qBase && mBase && qBase === mBase) score += 70;
  }
  if (queryHasHousenumber(query) && isLocalityOnlyResult(r)) score -= 220;
  if (/\d/.test(q)) {
    if (/\d/.test(main)) score += 35;
    if (/\d/.test(secondary)) score += 20;
  }

  if (STREET_PREFIX_RE.test(query) && (STREET_PREFIX_RE.test(hay) || /\d/.test(main))) {
    score += 30;
  }

  if (r.secondaryText && (r.secondaryText.includes(',') || /\d/.test(r.secondaryText))) {
    score += 12;
  }

  if (!r.needsRetrieve) score += 4;
  return score;
}

function mergeAndRankSearchResults(
  primary: GeocodingResult[],
  secondary: GeocodingResult[],
  query: string,
  preferSecondaryFirst: boolean,
): GeocodingResult[] {
  const ordered = preferSecondaryFirst ? [...secondary, ...primary] : [...primary, ...secondary];
  const seen = new Set<string>();
  const merged: GeocodingResult[] = [];

  for (const item of ordered) {
    const key = searchResultKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(item);
  }

  return merged
    .sort((a, b) => relevanceScore(b, query) - relevanceScore(a, query))
    .slice(0, SEARCH_RESULT_LIMIT);
}

function mapGeocodeFeatures(features: any[]): GeocodingResult[] {
  return features.map((f: any) => {
    const fullName = String(f.place_name ?? '').trim();
    const placeTypes: string[] = Array.isArray(f.place_type) ? f.place_type : [];
    const placeType = placeTypes[0] ?? '';
    const street = f.text ? String(f.text) : '';
    const addressNum = f.address != null ? String(f.address) : '';

    let mainText = street || fullName;
    let secondaryText = fullName;

    if (placeType === 'address' && street) {
      mainText = addressNum ? `${street} ${addressNum}` : street;
      secondaryText = fullName.replace(mainText, '').replace(/^[,\s]+/, '').trim() || fullName;
    } else if (placeType === 'poi') {
      mainText = street || fullName.split(',')[0]?.trim() || fullName;
      secondaryText = fullName.replace(mainText, '').replace(/^[,\s]+/, '').trim() || fullName;
    } else if (placeType === 'street') {
      mainText = street || fullName.split(',')[0]?.trim() || fullName;
      secondaryText = fullName;
    } else {
      mainText = street || fullName;
      const idx = mainText && fullName.includes(mainText)
        ? fullName.indexOf(mainText) + mainText.length
        : -1;
      secondaryText = idx > 0
        ? fullName.substring(idx).replace(/^[,\s]+/, '')
        : fullName;
    }

    return {
      mapboxId:      String(f.id ?? ''),
      mainText,
      secondaryText: secondaryText || fullName,
      latitude:      f.geometry.coordinates[1] as number,
      longitude:     f.geometry.coordinates[0] as number,
      needsRetrieve: false,
    };
  });
}

function mapSuggestResults(suggestions: any[]): GeocodingResult[] {
  return suggestions
    .filter((s) => s?.mapbox_id)
    .map((s) => {
      const fullAddress = String(s.full_address ?? s.place_formatted ?? s.address ?? '');
      const name = String(s.name_preferred ?? s.name ?? '');
      const secondaryText = fullAddress || String(s.place_formatted ?? s.address ?? '');
      const hasCoords = Number.isFinite(Number(s.latitude)) && Number.isFinite(Number(s.longitude));

      return {
        mapboxId:      String(s.mapbox_id),
        mainText:      name,
        secondaryText,
        latitude:      hasCoords ? Number(s.latitude) : NaN,
        longitude:     hasCoords ? Number(s.longitude) : NaN,
        needsRetrieve: !hasCoords,
      };
    })
    .filter((r) => r.mainText.length > 0);
}

function findPrefixCachedResults(
  normalized: string,
  cache: Map<string, { at: number; results: GeocodingResult[] }>,
  maxAgeMs: number,
): GeocodingResult[] | null {
  const now = Date.now();
  let bestKey = '';
  let bestEntry: { at: number; results: GeocodingResult[] } | null = null;
  for (const [key, entry] of cache) {
    if (now - entry.at > maxAgeMs) continue;
    if (normalized.startsWith(key) && key.length >= 3 && key.length > bestKey.length) {
      bestKey = key;
      bestEntry = entry;
    }
  }
  if (!bestEntry || !bestKey) return null;
  const filtered = bestEntry.results.filter((r) => {
    const hay = `${r.mainText} ${r.secondaryText}`.toLowerCase();
    return hay.includes(normalized) || normalized.includes(bestKey);
  });
  return filtered.length >= 2 ? filtered : null;
}

interface SearchModalProps {
  visible:       boolean;
  onClose:       () => void;
  onSelectStart: (location: LocationState) => void;
  onSelectEnd:   (location: LocationState) => void;
  userLocation:  LocationState | null;
  nearbyUsers:   User[];
  homeLocation?: LocationState | null;
  onPressSetHome?: () => void;
}

export const SearchModal = memo(({
  visible, onClose, onSelectStart, onSelectEnd, userLocation, nearbyUsers, homeLocation, onPressSetHome,
}: SearchModalProps) => {
  const { theme: t } = useTheme();
  const keyboardInset = useKeyboardInset(visible);
  const listPadBottom = 32 + keyboardInset;
  const {
    places, loading: placesLoading,
    activeCategory, fetchPlaces, clear: clearPlaces,
  } = usePlacesNearby();

  const [activeTab,      setActiveTab]      = useState<'start' | 'end'>('end');
  const [searchQuery,    setSearchQuery]    = useState('');
  const [filteredPlaces, setFilteredPlaces] = useState<GeocodingResult[]>([]);
  const [filteredUsers,  setFilteredUsers]  = useState<User[]>([]);
  const [isSearching,    setIsSearching]    = useState(false);
  const [searchMode,     setSearchMode]     = useState<
    'initial' | 'users' | 'friends' | 'results' | 'nearby'
  >('initial');
  const [placeHistory,   setPlaceHistory]   = useState<SearchPlaceHistoryEntry[]>([]);

  // ── Refs żeby BackHandler zawsze miał świeże wartości ──
  const searchModeRef       = useRef(searchMode);
  const resetToInitialRef   = useRef<() => void>(() => {});
  const onCloseRef          = useRef(onClose);
  const searchSessionRef    = useRef('');
  const searchSessionLastUsedAtRef = useRef(0);
  const searchCacheRef      = useRef<Map<string, { at: number; results: GeocodingResult[] }>>(new Map());
  const lastApiQueryRef     = useRef('');
  const searchReqSeqRef     = useRef(0);
  const searchAbortRef      = useRef<AbortController | null>(null);
  const visibleRef          = useRef(visible);
  const userLocationRef     = useRef(userLocation);
  const clearPlacesRef      = useRef(clearPlaces);
  const ensureSearchSessionRef = useRef<() => string>(() => '');
  const searchQueryRef           = useRef(searchQuery);
  const runSearchQueryRef        = useRef<(query: string) => void>(() => {});

  useEffect(() => { visibleRef.current = visible; }, [visible]);
  useEffect(() => { searchModeRef.current = searchMode; }, [searchMode]);
  useEffect(() => { onCloseRef.current    = onClose; },       [onClose]);
  useEffect(() => { userLocationRef.current = userLocation; }, [userLocation]);
  useEffect(() => { clearPlacesRef.current = clearPlaces; }, [clearPlaces]);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    void loadSearchPlaceHistory().then((entries) => {
      if (!cancelled) setPlaceHistory(entries);
    });
    return () => { cancelled = true; };
  }, [visible]);

  // ─────────────────────────────────────────────────────
  const resetToInitial = useCallback(() => {
    setSearchMode('initial');
    setSearchQuery('');
    searchQueryRef.current = '';
    setFilteredUsers([]);
    setFilteredPlaces([]);
    lastApiQueryRef.current = '';
    clearPlaces();
  }, [clearPlaces]);

  useEffect(() => { resetToInitialRef.current = resetToInitial; }, [resetToInitial]);

  const ensureSearchSession = useCallback((): string => {
    const now = Date.now();
    const shouldRotate =
      !searchSessionRef.current
      || (searchSessionLastUsedAtRef.current > 0 && now - searchSessionLastUsedAtRef.current > SEARCH_SESSION_IDLE_MS);
    if (shouldRotate) {
      if (searchSessionRef.current) {
        resetSearchSuggestBudget(searchSessionRef.current);
      }
      searchSessionRef.current = createMapboxSearchSessionToken();
    }
    searchSessionLastUsedAtRef.current = now;
    return searchSessionRef.current;
  }, []);

  useEffect(() => {
    ensureSearchSessionRef.current = ensureSearchSession;
  }, [ensureSearchSession]);

  // ── BackHandler ───────────────────────────────────────
  useEffect(() => {
    if (!visible) return;

    const onBack = () => {
      if (searchModeRef.current !== 'initial') {
        resetToInitialRef.current();
      } else {
        onCloseRef.current();
      }
      return true;
    };

    const sub = BackHandler.addEventListener('hardwareBackPress', onBack);
    return () => sub.remove();
  }, [visible]); // tylko visible — reszta przez ref

  // ─────────────────────────────────────────────────────
  const handleSelectUserCategory = useCallback((category: 'users' | 'friends') => {
    setSearchMode(category);
    setSearchQuery('');
    setFilteredPlaces([]);
    clearPlaces();
    const mapped = nearbyUsers
      .filter(u => {
        if (category === 'friends') return u.isFriend;
        if (!userLocation) return false;
        return (
          !u.isFriend &&
          calculateDistance(
            userLocation.latitude, userLocation.longitude,
            u.latitude, u.longitude,
          ) <= MAX_NEARBY_USERS_DISTANCE
        );
      })
      .map(u => ({
        ...u,
        distance: userLocation
          ? calculateDistance(userLocation.latitude, userLocation.longitude, u.latitude, u.longitude)
          : 0,
      }))
      .sort((a, b) => (a.distance || 0) - (b.distance || 0));
    setFilteredUsers(mapped);
  }, [nearbyUsers, userLocation, clearPlaces]);

  // ──────────────────────────���──────────────────────────
  const handleSelectPlaceCategory = useCallback((category: PlaceCategory) => {
    if (!userLocation) { Toast.show({ type: 'error', text1: 'Brak lokalizacji GPS' }); return; }
    setSearchMode('nearby');
    setSearchQuery('');
    fetchPlaces(userLocation.latitude, userLocation.longitude, category);
  }, [userLocation, fetchPlaces]);

  const runSearchQuery = useCallback(async (query: string) => {
    if (!visibleRef.current) return;
    const trimmed = query.trim();
    const normalized = trimmed.toLowerCase();
    if (trimmed.length < SEARCH_MIN_QUERY_LEN) {
      setSearchMode('initial');
      setFilteredPlaces([]);
      setFilteredUsers([]);
      clearPlacesRef.current();
      setIsSearching(false);
      return;
    }

    searchAbortRef.current?.abort();
    const ac = new AbortController();
    searchAbortRef.current = ac;
    const { signal } = ac;

    const loc = userLocationRef.current;
    const reqSeq = ++searchReqSeqRef.current;
    const detailedQuery = isDetailedPlaceQuery(trimmed);

    setSearchMode('results');
    setIsSearching(true);
    setFilteredUsers([]);
    clearPlacesRef.current();

    try {
      const cached = searchCacheRef.current.get(normalized);
      const now = Date.now();
      if (cached && now - cached.at < SEARCH_CACHE_MAX_AGE_MS && !shouldSkipSearchCache(trimmed, cached.results)) {
        if (reqSeq === searchReqSeqRef.current) {
          setFilteredPlaces(cached.results);
        }
        return;
      }

      const prefixLocal = findPrefixCachedResults(
        normalized,
        searchCacheRef.current,
        SEARCH_CACHE_MAX_AGE_MS,
      );
      if (prefixLocal && reqSeq === searchReqSeqRef.current) {
        setFilteredPlaces(prefixLocal);
      }

      const sessionToken = ensureSearchSessionRef.current();
      const suggestTypes = detailedQuery ? SEARCH_TYPES_DETAILED : SEARCH_TYPES;
      const geocodeTypes = detailedQuery
        ? 'address,street,poi,place,locality'
        : SEARCH_TYPES;

      const suggestPromise = fetchSearchSuggestViaProxy<any>({
        query: trimmed,
        sessionToken,
        language: 'pl',
        country: 'pl',
        limit: SEARCH_RESULT_LIMIT,
        types: suggestTypes,
        proximityLng: loc?.longitude,
        proximityLat: loc?.latitude,
        signal,
      }).then((data) => mapSuggestResults(data?.suggestions ?? []))
        .catch((e) => {
          if (isMapboxProxyAbortError(e)) throw e;
          return [] as GeocodingResult[];
        });

      const geocodePromise = fetchGeocodingViaProxy<any>({
        query: trimmed,
        language: 'pl',
        country: 'pl',
        types: geocodeTypes,
        limit: SEARCH_RESULT_LIMIT,
        proximityLng: loc?.longitude,
        proximityLat: loc?.latitude,
        signal,
      }).then((data) => mapGeocodeFeatures(data.features ?? []))
        .catch((e) => {
          if (isMapboxProxyAbortError(e)) throw e;
          return [] as GeocodingResult[];
        });

      const partnersPromise = fetchPartnerPoisSearch(trimmed, signal)
        .catch((e) => {
          if (isMapboxProxyAbortError(e)) throw e;
          return [];
        });

      const [suggestResults, geocodeResults, partners] = await Promise.all([
        suggestPromise,
        geocodePromise,
        partnersPromise,
      ]);

      if (signal.aborted || reqSeq !== searchReqSeqRef.current) return;

      lastApiQueryRef.current = normalized;

      let results = mergeAndRankSearchResults(
        suggestResults,
        geocodeResults,
        trimmed,
        detailedQuery || geocodeResults.length >= suggestResults.length,
      );
      results = filterByRelevance(results, trimmed);
      results = filterWeakAddressResults(results, trimmed);

      if (partners.length > 0) {
        const partnerRows: GeocodingResult[] = partners
          .sort((a, b) => (b.priorityRank ?? 0) - (a.priorityRank ?? 0))
          .map((p) => ({
            mapboxId: `partner_${p.id}`,
            mainText: p.name,
            secondaryText: p.brandSlug ? `Partner · ${p.brandSlug}` : 'Partner VROOM',
            latitude: p.lat,
            longitude: p.lng,
          }));
        const seen = new Set<string>();
        results = [...partnerRows, ...results].filter((r) => {
          const key = searchResultKey(r);
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
        results = filterByRelevance(results, trimmed).slice(0, SEARCH_RESULT_LIMIT);
      }

      if (
        results.length < 3
        && suggestResultsLookGeneric(results, trimmed)
      ) {
        const asciiQuery = trimmed
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '');
        if (asciiQuery !== trimmed && asciiQuery.length >= SEARCH_MIN_QUERY_LEN) {
          const [asciiSuggest, asciiGeocode] = await Promise.all([
            fetchSearchSuggestViaProxy<any>({
              query: asciiQuery,
              sessionToken,
              language: 'pl',
              country: 'pl',
              limit: SEARCH_RESULT_LIMIT,
              types: suggestTypes,
              proximityLng: loc?.longitude,
              proximityLat: loc?.latitude,
              signal,
            }).then((data) => mapSuggestResults(data?.suggestions ?? [])).catch(() => [] as GeocodingResult[]),
            fetchGeocodingViaProxy<any>({
              query: asciiQuery,
              language: 'pl',
              country: 'pl',
              types: geocodeTypes,
              limit: SEARCH_RESULT_LIMIT,
              proximityLng: loc?.longitude,
              proximityLat: loc?.latitude,
              signal,
            }).then((data) => mapGeocodeFeatures(data.features ?? [])).catch(() => [] as GeocodingResult[]),
          ]);
          if (!signal.aborted && reqSeq === searchReqSeqRef.current) {
            results = mergeAndRankSearchResults(
              [...suggestResults, ...asciiSuggest],
              [...geocodeResults, ...asciiGeocode],
              trimmed,
              true,
            );
            results = filterByRelevance(results, trimmed);
            results = filterWeakAddressResults(results, trimmed);
          }
        }
      }

      if (
        results.length === 0
        && suggestResultsLookGeneric(suggestResults, trimmed)
        && prefixLocal?.length
      ) {
        results = prefixLocal;
      }

      searchCacheRef.current.set(normalized, { at: now, results });
      if (reqSeq === searchReqSeqRef.current) setFilteredPlaces(results);
    } catch (e) {
      if (isMapboxProxyAbortError(e)) return;
      if (reqSeq === searchReqSeqRef.current) {
        Toast.show({ type: 'error', text1: 'BŁĄD WYSZUKIWANIA' });
      }
    } finally {
      if (!signal.aborted && reqSeq === searchReqSeqRef.current) {
        setIsSearching(false);
      }
    }
  }, []);

  useEffect(() => {
    runSearchQueryRef.current = (query: string) => { void runSearchQuery(query); };
  }, [runSearchQuery]);

  const debouncedSearchRef = useRef(
    debounce((query: string) => { runSearchQueryRef.current(query); }, SEARCH_DEBOUNCE_MS),
  );

  useEffect(() => {
    debouncedSearchRef.current.cancel();
    debouncedSearchRef.current = debounce(
      (query: string) => { runSearchQueryRef.current(query); },
      SEARCH_DEBOUNCE_MS,
    );
  }, []);

  const flushSearchNow = useCallback(() => {
    debouncedSearchRef.current.cancel();
    runSearchQueryRef.current(searchQueryRef.current);
  }, []);

  const handleSearchInputChange = useCallback((text: string) => {
    debouncedSearchRef.current.cancel();
    setSearchQuery(text);
    searchQueryRef.current = text;

    const trimmed = text.trim();
    if (trimmed.length >= SEARCH_MIN_QUERY_LEN) {
      setSearchMode('results');
      setIsSearching(true);
    } else {
      searchAbortRef.current?.abort();
      setSearchMode('initial');
      setIsSearching(false);
      setFilteredPlaces([]);
      setFilteredUsers([]);
      clearPlacesRef.current();
    }

    debouncedSearchRef.current(text);
  }, []);

  useEffect(() => {
    if (visible) {
      ensureSearchSession();
    } else {
      searchAbortRef.current?.abort();
      searchAbortRef.current = null;
      debouncedSearchRef.current.cancel();
    }
  }, [visible, ensureSearchSession]);

  useEffect(() => () => {
    searchAbortRef.current?.abort();
    debouncedSearchRef.current.cancel();
  }, []);

  // ─────────────────────────────────────────────────────
  const selectLocation = useCallback((
    location: LocationState,
    label: string,
    secondaryText?: string,
  ) => {
    void saveSearchPlaceHistoryEntry(location, secondaryText).then(setPlaceHistory);

    if (activeTab === 'start') {
      onSelectStart(location);
      Toast.show({ type: 'success', text1: '📍 POCZĄTEK USTAWIONY', text2: label });
      setActiveTab('end');
      resetToInitial();
    } else {
      onSelectEnd(location);
      Toast.show({ type: 'success', text1: '🏁 CEL USTAWIONY', text2: label });
      onClose();
    }
  }, [activeTab, onSelectStart, onSelectEnd, onClose, resetToInitial]);

  const handleSelectAutocomplete = useCallback(async (item: GeocodingResult) => {
    let lat = item.latitude;
    let lng = item.longitude;

    if (item.needsRetrieve || !Number.isFinite(lat) || !Number.isFinite(lng)) {
      setIsSearching(true);
      try {
        const data = await fetchSearchRetrieveViaProxy<any>({
          mapboxId: item.mapboxId,
          sessionToken: ensureSearchSession(),
          language: 'pl',
        });
        const feature = data?.features?.[0];
        const coords = feature?.geometry?.coordinates;
        if (!Array.isArray(coords) || coords.length < 2) {
          Toast.show({ type: 'error', text1: 'BŁĄD', text2: 'Nie udało się ustalić lokalizacji' });
          return;
        }
        lng = Number(coords[0]);
        lat = Number(coords[1]);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
          Toast.show({ type: 'error', text1: 'BŁĄD', text2: 'Nie udało się ustalić lokalizacji' });
          return;
        }
      } catch {
        Toast.show({ type: 'error', text1: 'BŁĄD WYSZUKIWANIA', text2: 'Spróbuj ponownie' });
        return;
      } finally {
        setIsSearching(false);
      }
    }

    selectLocation(
      { latitude: lat, longitude: lng, name: item.mainText, placeId: item.mapboxId },
      item.mainText,
      item.secondaryText,
    );
  }, [selectLocation, ensureSearchSession]);

  const handleSelectNearby = useCallback((place: NearbyPlace) => {
    selectLocation(
      { latitude: place.lat, longitude: place.lng, name: place.name, placeId: place.placeId },
      place.name,
      place.address,
    );
  }, [selectLocation]);

  const handleSelectHistory = useCallback((item: SearchPlaceHistoryEntry) => {
    selectLocation(
      {
        latitude: item.latitude,
        longitude: item.longitude,
        name: item.name,
        placeId: item.placeId,
      },
      item.name ?? 'Miejsce',
      item.secondaryText,
    );
  }, [selectLocation]);

  const handleSelectUser = useCallback((user: User) => {
    selectLocation({ latitude: user.latitude, longitude: user.longitude, name: user.name }, user.name);
  }, [selectLocation]);

  const handleSelectCurrent = useCallback(() => {
    if (userLocation) selectLocation({ ...userLocation, name: 'Moja pozycja' }, 'Moja pozycja');
  }, [userLocation, selectLocation]);

  const handleSelectHome = useCallback(() => {
    if (homeLocation && Number.isFinite(homeLocation.latitude) && Number.isFinite(homeLocation.longitude)) {
      selectLocation(
        {
          latitude: homeLocation.latitude,
          longitude: homeLocation.longitude,
          name: homeLocation.name || 'Dom',
          placeId: homeLocation.placeId,
        },
        homeLocation.name || 'Dom',
      );
      return;
    }
    Toast.show({ type: 'info', text1: 'Brak adresu Dom', text2: 'Ustaw go w Profil → Ustawienia' });
    onPressSetHome?.();
  }, [homeLocation, onPressSetHome, selectLocation]);

  // ─────────────────────────────────────────────────────
  const friendCount    = nearbyUsers.filter(u => u.isFriend).length;
  const otherUserCount = nearbyUsers.filter(u =>
    !u.isFriend && userLocation &&
    calculateDistance(userLocation.latitude, userLocation.longitude, u.latitude, u.longitude) <= MAX_NEARBY_USERS_DISTANCE,
  ).length;

  const showUsers   = searchMode === 'users' || searchMode === 'friends';
  const showResults = searchMode === 'results';
  const showNearby  = searchMode === 'nearby';

  const displayedHistory = useMemo(
    () => filterSearchPlaceHistory(placeHistory, searchQuery),
    [placeHistory, searchQuery],
  );
  const showHistoryPanel = displayedHistory.length > 0
    && (searchMode === 'initial' || searchQuery.trim().length < SEARCH_MIN_QUERY_LEN);

  const historyAsResults = useMemo((): GeocodingResult[] => (
    displayedHistory.map((item) => ({
      mapboxId:      item.placeId ? `history_${item.placeId}` : `history_${item.latitude}_${item.longitude}`,
      mainText:      item.name ?? 'Miejsce',
      secondaryText: item.secondaryText ?? '',
      latitude:      item.latitude,
      longitude:     item.longitude,
      needsRetrieve: false,
      fromHistory:   true,
      historyEntry:  item,
    }))
  ), [displayedHistory]);

  const mergedSearchResults = useMemo(() => {
    if (!showResults || historyAsResults.length === 0) return filteredPlaces;
    const seen = new Set<string>();
    const merged: GeocodingResult[] = [];
    for (const item of [...historyAsResults, ...filteredPlaces]) {
      const key = searchResultKey(item);
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(item);
    }
    return merged;
  }, [showResults, historyAsResults, filteredPlaces]);

  const activeCatData = PLACE_CATEGORIES.find(c => c.key === activeCategory);

  // ─────────────────────────────────────────────────────
  return (
    <Modal 
      visible={visible} 
      animationType="fade" 
      transparent={false} 
      statusBarTranslucent
      presentationStyle="fullScreen"
      onRequestClose={() => {           // ← DODAJ TO
        if (searchMode !== 'initial') {
          resetToInitial();
        } else {
          onClose();
        }
      }}
      >
      <StatusBar barStyle="light-content" backgroundColor={t.bg} />
      <SafeAreaProvider>
      <SafeAreaView
        edges={['top', 'right', 'bottom', 'left']}
        style={[ss.root, { backgroundColor: t.bg }]}
      >

        {/* ── HEADER ────────────────────────────────────── */}
        <View style={[ss.header, { borderBottomColor: t.border2 }]}>
          <TouchableOpacity
            style={[ss.iconBtn, { backgroundColor: t.surface2, borderColor: t.border2 }]}
            onPress={searchMode !== 'initial' ? resetToInitial : onClose}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <MaterialIcons
              name={searchMode !== 'initial' ? 'arrow-back' : 'close'}
              size={18}
              color={t.textMuted}
            />
          </TouchableOpacity>

          <View style={{ flex: 1, marginHorizontal: 12 }}>
            <View style={[ss.tabsRow, { backgroundColor: t.surface2, borderColor: t.border2 }]}>
              {(['start', 'end'] as const).map(tab => (
                <TouchableOpacity
                  key={tab}
                  style={[ss.tab, activeTab === tab && { backgroundColor: t.surface3 }]}
                  onPress={() => { setActiveTab(tab); resetToInitial(); }}
                  activeOpacity={0.8}
                >
                  {activeTab === tab && (
                    <View style={[ss.tabLine, { backgroundColor: t.primary }]} />
                  )}
                  <MaterialIcons
                    name={tab === 'start' ? 'radio-button-on' : 'flag'}
                    size={12}
                    color={activeTab === tab ? t.primary : t.textDim}
                  />
                  <Text style={[ss.tabText, { color: activeTab === tab ? t.primary : t.textDim }]}>
                    {tab === 'start' ? 'POCZĄTEK' : 'CEL'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <View style={{ width: 36 }} />
        </View>

        {/* ── INPUT ─────────────────────────────────────── */}
        <View style={[ss.inputWrap, { backgroundColor: t.surface, borderColor: t.border2 }]}>
          <MaterialIcons name="search" size={20} color={t.primary} />
          <TextInput
            style={[ss.input, { color: t.text }]}
            placeholder={activeTab === 'start' ? 'Skąd jedziesz? (adres lub miejsce)' : 'Dokąd jedziesz? (adres lub miejsce)'}
            placeholderTextColor={t.textDim}
            value={searchQuery}
            onChangeText={handleSearchInputChange}
            onSubmitEditing={flushSearchNow}
            autoFocus
            autoCorrect={false}
            autoCapitalize="none"
            returnKeyType="search"
            selectionColor={t.primary}
            blurOnSubmit={false}
          />
          {isSearching || placesLoading
            ? <ActivityIndicator size="small" color={t.primary} />
            : searchQuery.length > 0
              ? (
                <TouchableOpacity
                  onPress={() => { setSearchQuery(''); resetToInitial(); }}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <View style={[ss.clearBtn, { backgroundColor: t.surface3 }]}>
                    <MaterialIcons name="close" size={11} color={t.textMuted} />
                  </View>
                </TouchableOpacity>
              ) : null
          }
        </View>

        <View style={[ss.divider, { backgroundColor: t.border }]} />

        {/* ══════════════════════════════════════════════ */}
        {/* INITIAL / LOCAL HISTORY                        */}
        {/* ══════════════════════════════════════════════ */}
        {searchMode === 'initial' && (
          <ScrollView
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: listPadBottom }}
          >
            {searchQuery.length === 0 && (
              <>
            <TouchableOpacity onPress={activeTab === 'end' ? handleSelectHome : handleSelectCurrent} activeOpacity={0.85} style={{ marginBottom: 12 }}>
              <LinearGradient
                colors={['#e33835', '#b01e1b']}
                start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                style={ss.myLocCard}
              >
                <View style={{ position: 'absolute', right: -20, top: -20, width: 110, height: 110, borderRadius: 55, backgroundColor: '#ffffff12' }} />
                <View style={ss.myLocIcon}>
                  <MaterialIcons name={activeTab === 'end' ? 'home' : 'my-location'} size={22} color="#fff" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={ss.myLocTitle}>{activeTab === 'end' ? 'Dom' : 'Moja pozycja'}</Text>
                  <Text style={ss.myLocSub}>
                    {activeTab === 'end'
                      ? (homeLocation ? 'Jeden klik ustawia cel na Dom' : 'Brak ustawionego Domu')
                      : 'Ustaw jako punkt startowy'}
                  </Text>
                </View>
                <View style={ss.myLocArrow}>
                  <MaterialIcons name="arrow-forward" size={15} color="#fff" />
                </View>
              </LinearGradient>
            </TouchableOpacity>

            {activeTab === 'end' && (
              <TouchableOpacity onPress={handleSelectCurrent} activeOpacity={0.85} style={{ marginBottom: 20 }}>
                <View style={[ss.homeSecondaryCard, { backgroundColor: t.surface, borderColor: t.border2 }]}>
                  <View style={[ss.homeSecondaryIcon, { backgroundColor: t.surface3, borderColor: t.border2 }]}>
                    <MaterialIcons name="my-location" size={18} color={t.textDim} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[ss.homeSecondaryTitle, { color: t.text }]}>Moja pozycja</Text>
                    <Text style={[ss.homeSecondarySub, { color: t.textDim }]}>Ustaw bieżące położenie jako cel</Text>
                  </View>
                  <MaterialIcons name="arrow-forward-ios" size={12} color={t.textDim} />
                </View>
              </TouchableOpacity>
            )}
              </>
            )}

            {showHistoryPanel && (
              <>
                <Text style={[ss.sectionLabel, { color: t.textDim, marginTop: searchQuery.length === 0 ? 0 : 4 }]}>
                  {searchQuery.length > 0 ? 'Z HISTORII' : 'OSTATNIE MIEJSCA'}
                </Text>
                {displayedHistory.map((item, index) => (
                  <TouchableOpacity
                    key={`${item.placeId ?? item.latitude}_${item.longitude}_${index}`}
                    style={[ss.row, { borderBottomColor: t.border }]}
                    onPress={() => handleSelectHistory(item)}
                    activeOpacity={0.7}
                  >
                    <View style={[ss.placeBox, { backgroundColor: t.surface3, borderColor: t.border2 }]}>
                      <MaterialIcons name="history" size={18} color={t.textDim} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[ss.rowTitle, { color: t.text }]} numberOfLines={1}>
                        {item.name}
                      </Text>
                      {item.secondaryText ? (
                        <Text style={[ss.rowSub, { color: t.textDim }]} numberOfLines={1}>
                          {item.secondaryText}
                        </Text>
                      ) : null}
                    </View>
                    <View style={[ss.arrowBox, { backgroundColor: t.surface3 }]}>
                      <MaterialIcons name="arrow-forward-ios" size={11} color={t.textMuted} />
                    </View>
                  </TouchableOpacity>
                ))}
              </>
            )}

            {searchQuery.length === 0 && (
              <>
            <Text style={[ss.sectionLabel, { color: t.textDim }]}>W POBLIŻU</Text>
            <View style={ss.nearbyGrid}>
              {PLACE_CATEGORIES.map(cat => (
                <TouchableOpacity
                  key={cat.key}
                  style={[ss.nearbyCard, { backgroundColor: t.surface, borderColor: t.border2 }]}
                  onPress={() => handleSelectPlaceCategory(cat.key)}
                  activeOpacity={0.8}
                >
                  <View style={{
                    position: 'absolute', top: -12, right: -12,
                    width: 56, height: 56, borderRadius: 28,
                    backgroundColor: cat.color + '0c',
                  }} />
                  <Text style={ss.nearbyEmoji}>{cat.emoji}</Text>
                  <Text style={[ss.nearbyLabel, { color: t.text }]}>{cat.label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={[ss.sectionLabel, { color: t.textDim, marginTop: 20 }]}>UŻYTKOWNICY</Text>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              {[
                { key: 'users'   as const, icon: 'people',   label: 'UŻYTKOWNICY', sub: `${otherUserCount} w pobliżu`, count: otherUserCount, color: '#268bff' },
                { key: 'friends' as const, icon: 'favorite', label: 'ZNAJOMI',     sub: `${friendCount} aktywnych`,   count: friendCount,    color: t.online  },
              ].map(item => (
                <TouchableOpacity
                  key={item.key}
                  style={[ss.catCard, { flex: 1, backgroundColor: t.surface, borderColor: t.border2 }]}
                  onPress={() => handleSelectUserCategory(item.key)}
                  activeOpacity={0.8}
                >
                  <View style={{
                    position: 'absolute', top: -14, right: -14,
                    width: 64, height: 64, borderRadius: 32,
                    backgroundColor: item.color + '0e',
                  }} />
                  <View style={[ss.catIcon, { backgroundColor: item.color + '18', borderColor: item.color + '30' }]}>
                    <MaterialIcons name={item.icon as any} size={20} color={item.color} />
                  </View>
                  <Text style={[ss.catLabel, { color: t.text }]}>{item.label}</Text>
                  <Text style={[ss.catSub, { color: t.textDim }]}>{item.sub}</Text>
                  <View style={[ss.catBadge, { backgroundColor: item.color + '18', borderColor: item.color + '30' }]}>
                    <Text style={[ss.catBadgeNum, { color: item.color }]}>{item.count}</Text>
                  </View>
                </TouchableOpacity>
              ))}
            </View>

            <View style={[ss.hintRow, { marginTop: 20 }]}>
              <MaterialIcons name="keyboard" size={12} color={t.textFaint} />
              <Text style={[ss.hintText, { color: t.textFaint }]}>
                wpisz pełny adres (ulica, numer, miasto) lub nazwę miejsca
              </Text>
            </View>
              </>
            )}

            {searchQuery.length > 0 && searchQuery.length < SEARCH_MIN_QUERY_LEN && displayedHistory.length === 0 && (
              <View style={ss.emptyBox}>
                <MaterialIcons name="history" size={44} color={t.textFaint} />
                <Text style={[ss.emptyTitle, { color: t.textDim }]}>BRAK W HISTORII</Text>
                <Text style={[ss.emptySub, { color: t.textFaint }]}>
                  Wpisz co najmniej {SEARCH_MIN_QUERY_LEN} znaki, aby wyszukać nowe miejsce
                </Text>
              </View>
            )}
          </ScrollView>
        )}

        {/* ══════════════════════════════════════════════ */}
        {/* NEARBY PLACES                                  */}
        {/* ══════════════════════════════════════════════ */}
        {showNearby && (
          <View style={{ flex: 1 }}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: 8, paddingHorizontal: 16, paddingVertical: 10 }}
              style={[ss.chipsScroll, { borderBottomColor: t.border2 }]}
            >
              {PLACE_CATEGORIES.map(cat => (
                <TouchableOpacity
                  key={cat.key}
                  onPress={() => handleSelectPlaceCategory(cat.key)}
                  style={[
                    ss.chip,
                    {
                      backgroundColor: activeCategory === cat.key ? cat.color + '25' : t.surface2,
                      borderColor:     activeCategory === cat.key ? cat.color         : t.border2,
                    },
                  ]}
                  activeOpacity={0.8}
                >
                  <Text style={{ fontSize: 14 }}>{cat.emoji}</Text>
                  <Text style={[ss.chipText, {
                    color: activeCategory === cat.key ? cat.color : t.textDim,
                  }]}>
                    {cat.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            {placesLoading ? (
              <View style={ss.emptyBox}>
                <ActivityIndicator size="large" color={activeCatData?.color ?? t.primary} />
                <Text style={[ss.emptyTitle, { color: t.textDim, marginTop: 12 }]}>
                  SZUKAM {activeCatData?.label}...
                </Text>
              </View>
            ) : (
              <FlatList
                data={places}
                keyExtractor={item => item.placeId}
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24 + keyboardInset, paddingTop: 8 }}
                ListHeaderComponent={
                  places.length > 0
                    ? (
                      <Text style={[ss.sectionLabel, { color: t.textDim }]}>
                        {places.length} WYNIKÓW · {activeCatData?.label}
                      </Text>
                    ) : null
                }
                ListEmptyComponent={
                  <View style={ss.emptyBox}>
                    <Text style={{ fontSize: 44 }}>{activeCatData?.emoji ?? '📍'}</Text>
                    <Text style={[ss.emptyTitle, { color: t.textDim }]}>BRAK W POBLIŻU</Text>
                    <Text style={[ss.emptySub, { color: t.textFaint }]}>
                      Nie znaleziono w promieniu 5 km
                    </Text>
                  </View>
                }
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={[ss.row, { borderBottomColor: t.border }]}
                    onPress={() => handleSelectNearby(item)}
                    activeOpacity={0.7}
                  >
                    <View style={[ss.placeBox, {
                      backgroundColor: (activeCatData?.color ?? t.primary) + '18',
                      borderColor:     (activeCatData?.color ?? t.primary) + '35',
                    }]}>
                      <Text style={{ fontSize: 18 }}>{activeCatData?.emoji ?? '📍'}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[ss.rowTitle, { color: t.text }]} numberOfLines={1}>
                        {item.name}
                      </Text>
                      <Text style={[ss.rowSub, { color: t.textDim }]} numberOfLines={1}>
                        {item.address}
                      </Text>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4 }}>
                        {item.distance !== undefined && (
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                            <MaterialIcons name="near-me" size={9} color={t.textFaint} />
                            <Text style={[ss.rowMeta, { color: t.textFaint }]}>
                              {item.distance < 1
                                ? `${Math.round(item.distance * 1000)} m`
                                : `${item.distance.toFixed(1)} km`}
                            </Text>
                          </View>
                        )}
                        {item.rating !== undefined && (
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                            <MaterialIcons name="star" size={9} color={t.gold} />
                            <Text style={[ss.rowMeta, { color: t.gold }]}>
                              {item.rating.toFixed(1)}
                            </Text>
                          </View>
                        )}
                        {item.isOpen !== undefined && (
                          <View style={[ss.openBadge, {
                            backgroundColor: item.isOpen ? t.success + '20' : t.danger + '20',
                            borderColor:     item.isOpen ? t.success + '40' : t.danger + '40',
                          }]}>
                            <Text style={[ss.openText, {
                              color: item.isOpen ? t.success : t.danger,
                            }]}>
                              {item.isOpen ? 'OTWARTE' : 'ZAMKNIĘTE'}
                            </Text>
                          </View>
                        )}
                      </View>
                    </View>
                    <View style={[ss.arrowBox, { backgroundColor: t.surface3 }]}>
                      <MaterialIcons name="arrow-forward-ios" size={11} color={t.textMuted} />
                    </View>
                  </TouchableOpacity>
                )}
              />
            )}
          </View>
        )}

        {/* ══════════════════════════════════════════════ */}
        {/* USERS / FRIENDS                                */}
        {/* ══════════════════════════════════════════════ */}
        {showUsers && (
          <FlatList
            data={filteredUsers}
            keyExtractor={item => item.id}
            keyboardShouldPersistTaps="handled"
            style={{ flex: 1 }}
            contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24 + keyboardInset, paddingTop: 8 }}
            ListHeaderComponent={
              <Text style={[ss.sectionLabel, { color: t.textDim }]}>
                {searchMode === 'friends' ? 'TWOI ZNAJOMI' : 'UŻYTKOWNICY W POBLIŻU'}
              </Text>
            }
            ListEmptyComponent={
              <View style={ss.emptyBox}>
                <MaterialIcons name="person-off" size={44} color={t.textFaint} />
                <Text style={[ss.emptyTitle, { color: t.textDim }]}>BRAK WYNIKÓW</Text>
                <Text style={[ss.emptySub, { color: t.textFaint }]}>
                  {searchMode === 'friends'
                    ? 'Brak aktywnych znajomych'
                    : 'Brak użytkowników w zasięgu 25 km'}
                </Text>
              </View>
            }
            renderItem={({ item }) => (
              <TouchableOpacity
                style={[ss.row, { borderBottomColor: t.border }]}
                onPress={() => handleSelectUser(item)}
                activeOpacity={0.7}
              >
                <View style={[ss.avatarBox, { backgroundColor: t.surface2, borderColor: t.border2 }]}>
                  <Text style={{ fontSize: 18 }}>{item.avatar || '👤'}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[ss.rowTitle, { color: t.text }]}>{item.name}</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 }}>
                    <View style={[ss.dot, {
                      backgroundColor: item.status === 'Online' ? t.online : t.textFaint,
                    }]} />
                    <Text style={[ss.rowSub, { color: t.textDim }]}>
                      {item.status?.toUpperCase()} · {item.distance?.toFixed(1)} km
                    </Text>
                  </View>
                </View>
                <View style={[ss.arrowBox, { backgroundColor: t.surface3 }]}>
                  <MaterialIcons name="arrow-forward-ios" size={11} color={t.textMuted} />
                </View>
              </TouchableOpacity>
            )}
          />
        )}

        {/* ══════════════════════════════════════════════ */}
        {/* AUTOCOMPLETE RESULTS                           */}
        {/* ══════════════════════════════════════════════ */}
        {showResults && (
          isSearching && mergedSearchResults.length === 0
            ? (
              <View style={ss.emptyBox}>
                <ActivityIndicator size="large" color={t.primary} />
                <Text style={[ss.emptyTitle, { color: t.textDim, marginTop: 10 }]}>SZUKAM...</Text>
              </View>
            )
            : (
              <FlatList
                data={mergedSearchResults.map((p, i) => ({ ...p, _k: `${i}` }))}
                keyExtractor={item => item._k}
                keyboardShouldPersistTaps="handled"
                style={{ flex: 1 }}
                contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24 + keyboardInset, paddingTop: 8 }}
                ListHeaderComponent={
                  mergedSearchResults.length > 0
                    ? <Text style={[ss.sectionLabel, { color: t.textDim }]}>
                        {mergedSearchResults.length} WYNIKÓW
                      </Text>
                    : null
                }
                ListEmptyComponent={
                  <View style={ss.emptyBox}>
                    <MaterialIcons name="search-off" size={44} color={t.textFaint} />
                    <Text style={[ss.emptyTitle, { color: t.textDim }]}>BRAK WYNIKÓW</Text>
                    <Text style={[ss.emptySub, { color: t.textFaint }]}>
                      Sprawdź pisownię lub wpisz inną nazwę
                    </Text>
                  </View>
                }
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={[ss.row, { borderBottomColor: t.border }]}
                    onPress={() => {
                      if (item.fromHistory && item.historyEntry) {
                        handleSelectHistory(item.historyEntry);
                        return;
                      }
                      handleSelectAutocomplete(item);
                    }}
                    activeOpacity={0.7}
                  >
                    <View style={[ss.placeBox, {
                      backgroundColor: item.fromHistory ? t.surface3 : t.primaryBg,
                      borderColor: item.fromHistory ? t.border2 : t.primaryBorder,
                    }]}>
                      <MaterialIcons
                        name={item.fromHistory ? 'history' : 'location-on'}
                        size={18}
                        color={item.fromHistory ? t.textDim : t.primary}
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[ss.rowTitle, { color: t.text }]} numberOfLines={1}>
                        {item.mainText}
                      </Text>
                      {item.secondaryText ? (
                        <Text style={[ss.rowSub, { color: t.textDim }]} numberOfLines={1}>
                          {item.secondaryText}
                        </Text>
                      ) : null}
                    </View>
                    <View style={[ss.arrowBox, { backgroundColor: t.surface3 }]}>
                      <MaterialIcons name="arrow-forward-ios" size={11} color={t.textMuted} />
                    </View>
                  </TouchableOpacity>
                )}
              />
            )
        )}

      </SafeAreaView>
      </SafeAreaProvider>
    </Modal>
  );
});

SearchModal.displayName = 'SearchModal';

// ── Statyczne style ───────────────────────────────────────
const ss = StyleSheet.create({
  root:   { flex: 1 },
  header: {
    flexDirection:     'row',
    alignItems:        'center',
    paddingHorizontal: 16,
    paddingTop:        8,
    paddingBottom:     10,
    borderBottomWidth: 1,
  },
  iconBtn: {
    width: 36, height: 36, borderRadius: 11,
    borderWidth: 1, alignItems: 'center', justifyContent: 'center',
  },
  tabsRow: {
    flexDirection: 'row', borderRadius: 12, borderWidth: 1,
    overflow: 'hidden', padding: 3, gap: 3,
  },
  tab: {
    flex: 1, flexDirection: 'row', alignItems: 'center',
    justifyContent: 'center', gap: 5, paddingVertical: 7,
    borderRadius: 9, overflow: 'hidden',
  },
  tabLine: { position: 'absolute', bottom: 0, left: '15%', right: '15%', height: 2, borderRadius: 1 },
  tabText: { fontFamily: 'Manrope_600SemiBold', fontSize: 12, fontWeight: '700', letterSpacing: 1 },
  inputWrap: {
    flexDirection: 'row', alignItems: 'center',
    marginHorizontal: 16, marginVertical: 12,
    paddingHorizontal: 14,
    paddingVertical: Platform.OS === 'ios' ? 13 : 10,
    borderRadius: 14, borderWidth: 1, gap: 10,
  },
  input:    { flex: 1, fontFamily: 'Manrope_600SemiBold', fontSize: 12, letterSpacing: 0.3 },
  clearBtn: { width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  divider:  { height: 1 },
  sectionLabel: { fontFamily: 'Manrope_600SemiBold', fontSize: 12, letterSpacing: 1, marginBottom: 12 },
  myLocCard:  { borderRadius: 16, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 12, overflow: 'hidden' },
  myLocIcon:  { width: 44, height: 44, borderRadius: 13, backgroundColor: '#ffffff20', alignItems: 'center', justifyContent: 'center' },
  myLocTitle: { fontFamily: 'Manrope_600SemiBold', fontSize: 14, color: '#fff', fontWeight: '900' },
  myLocSub:   { fontFamily: 'Manrope_600SemiBold', fontSize: 12, color: '#ffffff70', marginTop: 3 },
  myLocArrow: { width: 30, height: 30, borderRadius: 9, backgroundColor: '#ffffff20', alignItems: 'center', justifyContent: 'center' },
  homeSecondaryCard: {
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  homeSecondaryIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  homeSecondaryTitle: { fontFamily: 'Manrope_600SemiBold', fontSize: 12, fontWeight: '700' },
  homeSecondarySub: { fontFamily: 'Manrope_600SemiBold', fontSize: 12, marginTop: 2 },
  nearbyGrid:  { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 6 },
  nearbyCard:  { width: '22.5%', aspectRatio: 1, borderRadius: 14, borderWidth: 1, alignItems: 'center', justifyContent: 'center', gap: 5, overflow: 'hidden' },
  nearbyEmoji: { fontSize: 24 },
  nearbyLabel: { fontFamily: 'Manrope_600SemiBold', fontSize: 12, fontWeight: '700', letterSpacing: 0.5, textAlign: 'center' },
  brandBanner:     { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 16, marginTop: 8, marginBottom: 2, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderWidth: 1 },
  brandBannerText: { fontFamily: 'Manrope_600SemiBold', fontSize: 12, fontWeight: '700', letterSpacing: 0.5, flex: 1 },
  chipsScroll: { borderBottomWidth: 1, flexGrow: 0 },
  chip:        { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, borderWidth: 1 },
  chipText:    { fontFamily: 'Manrope_600SemiBold', fontSize: 12, fontWeight: '700', letterSpacing: 1 },
  catCard:     { borderRadius: 14, borderWidth: 1, padding: 14, alignItems: 'center', gap: 6, overflow: 'hidden' },
  catIcon:     { width: 42, height: 42, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  catLabel:    { fontFamily: 'Manrope_600SemiBold', fontSize: 12, fontWeight: '700', letterSpacing: 1 },
  catSub:      { fontFamily: 'Manrope_600SemiBold', fontSize: 12 },
  catBadge:    { borderRadius: 9, paddingHorizontal: 10, paddingVertical: 3, borderWidth: 1, marginTop: 2 },
  catBadgeNum: { fontFamily: 'Manrope_600SemiBold', fontSize: 13, fontWeight: '900' },
  hintRow:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  hintText: { fontFamily: 'Manrope_600SemiBold', fontSize: 12, letterSpacing: 1 },
  row:       { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: 1 },
  avatarBox: { width: 42, height: 42, borderRadius: 21, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  placeBox:  { width: 42, height: 42, borderRadius: 13, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  rowTitle:  { fontFamily: 'Manrope_600SemiBold', fontSize: 12, fontWeight: '700' },
  rowSub:    { fontFamily: 'Manrope_600SemiBold', fontSize: 12, letterSpacing: 0.3 },
  rowMeta:   { fontFamily: 'Manrope_600SemiBold', fontSize: 12 },
  arrowBox:  { width: 26, height: 26, borderRadius: 7, alignItems: 'center', justifyContent: 'center' },
  dot:       { width: 5, height: 5, borderRadius: 2.5 },
  openBadge: { borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, borderWidth: 1 },
  openText:  { fontFamily: 'Manrope_600SemiBold', fontSize: 12, fontWeight: '700', letterSpacing: 0.5 },
  emptyBox:   { alignItems: 'center', paddingVertical: 48, gap: 8 },
  emptyTitle: { fontFamily: 'Manrope_600SemiBold', fontSize: 12, letterSpacing: 1 },
  emptySub:   { fontFamily: 'Manrope_600SemiBold', fontSize: 12, letterSpacing: 0.5, textAlign: 'center', paddingHorizontal: 30, lineHeight: 16 },
});
