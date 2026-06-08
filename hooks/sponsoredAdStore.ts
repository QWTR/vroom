import { useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_URL } from '../constants/config';
import { AD_ROTATION_MS } from './useAdRotation';

const SESSION_KEY = 'vroom_ad_session_id';

export type AdPlacement = 'map_banner' | 'feed_native' | 'home_banner';

export interface SponsoredCampaign {
  id: number;
  title: string;
  body?: string | null;
  imageUrl: string;
  linkUrl?: string | null;
  ctaText?: string;
  companyName?: string;
}

export interface SponsoredAdResult {
  source: 'sponsored' | 'admob';
  campaign?: SponsoredCampaign;
}

type PlacementEntry = {
  result: SponsoredAdResult;
  fetchedAt: number;
};

async function getAuthToken(): Promise<string | null> {
  return (await AsyncStorage.getItem('userToken')) ?? (await AsyncStorage.getItem('token'));
}

async function getOrCreateSessionId(): Promise<string> {
  let id = await AsyncStorage.getItem(SESSION_KEY);
  if (!id) {
    id = `s_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
    await AsyncStorage.setItem(SESSION_KEY, id);
  }
  return id;
}

type Snapshot = {
  result: SponsoredAdResult | null;
  loading: boolean;
};

class SponsoredAdStore {
  private cache = new Map<AdPlacement, PlacementEntry>();
  private loading = new Set<AdPlacement>();
  private inflight = new Map<AdPlacement, Promise<void>>();
  private listeners = new Set<() => void>();
  private snapshots = new Map<AdPlacement, Snapshot>();

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (placement: AdPlacement): Snapshot => {
    const next: Snapshot = {
      result: this.cache.get(placement)?.result ?? null,
      loading: this.loading.has(placement),
    };
    const prev = this.snapshots.get(placement);
    if (
      prev
      && prev.loading === next.loading
      && prev.result === next.result
    ) {
      return prev;
    }
    this.snapshots.set(placement, next);
    return next;
  };

  private notify() {
    this.listeners.forEach((listener) => listener());
  }

  private isFresh(entry: PlacementEntry | undefined) {
    return !!entry && Date.now() - entry.fetchedAt < AD_ROTATION_MS - 5_000;
  }

  async fetch(placement: AdPlacement, enabled: boolean, force = false) {
    if (!enabled) {
      this.cache.set(placement, { result: { source: 'admob' }, fetchedAt: Date.now() });
      this.notify();
      return;
    }

    const cached = this.cache.get(placement);
    if (!force && this.isFresh(cached)) return;

    if (this.inflight.has(placement)) {
      return this.inflight.get(placement);
    }

    this.loading.add(placement);
    this.notify();

    const promise = this.loadFromApi(placement)
      .finally(() => {
        this.loading.delete(placement);
        this.inflight.delete(placement);
        this.notify();
      });

    this.inflight.set(placement, promise);
    return promise;
  }

  private async loadFromApi(placement: AdPlacement) {
    try {
      const sessionId = await getOrCreateSessionId();
      const token = await getAuthToken();
      const headers: Record<string, string> = {};
      if (token) headers.Authorization = `Bearer ${token}`;

      const res = await fetch(
        `${API_URL}/api/ads/serve?placement=${encodeURIComponent(placement)}&sessionId=${encodeURIComponent(sessionId)}`,
        { headers },
      );

      const result: SponsoredAdResult = res.ok
        ? await res.json().then((data) =>
            data?.source === 'sponsored' && data.campaign
              ? { source: 'sponsored' as const, campaign: data.campaign }
              : { source: 'admob' as const },
          )
        : { source: 'admob' };

      this.cache.set(placement, { result, fetchedAt: Date.now() });
      this.notify();
    } catch {
      this.cache.set(placement, { result: { source: 'admob' }, fetchedAt: Date.now() });
      this.notify();
    }
  }

  async recordClick(campaignId: number) {
    try {
      const sessionId = await AsyncStorage.getItem(SESSION_KEY);
      const token = await getAuthToken();
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers.Authorization = `Bearer ${token}`;
      await fetch(`${API_URL}/api/ads/click`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ campaignId, sessionId }),
      });
    } catch {
      // ignore
    }
  }
}

export const sponsoredAdStore = new SponsoredAdStore();

export function useSponsoredAd(placement: AdPlacement, enabled = true) {
  const { result, loading } = useSyncExternalStore(
    sponsoredAdStore.subscribe,
    () => sponsoredAdStore.getSnapshot(placement),
    () => sponsoredAdStore.getSnapshot(placement),
  );

  const refetch = () => sponsoredAdStore.fetch(placement, enabled, true);
  const recordClick = (campaignId: number) => sponsoredAdStore.recordClick(campaignId);

  return { result, loading, refetch, recordClick };
}

export function prefetchSponsoredAd(placement: AdPlacement, enabled = true) {
  return sponsoredAdStore.fetch(placement, enabled);
}
