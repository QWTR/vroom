import { useEffect, useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiRequest } from '../lib/api/client';

const SESSION_KEY = 'vroom_ad_session_id';
const CACHE_TTL_MS = 110_000;

export type AdPlacement = 'map_banner' | 'feed_native' | 'home_banner' | 'vroomki';

export interface SponsoredCampaign {
  id: number;
  title: string;
  body?: string | null;
  imageUrl: string;
  videoUrl?: string | null;
  mediaType?: 'image' | 'video' | string;
  placement?: AdPlacement | string;
  linkUrl?: string | null;
  ctaText?: string;
  companyName?: string;
  businessAccountId?: number | null;
}

export interface SponsoredAdResult {
  source: 'sponsored' | 'admob';
  campaign?: SponsoredCampaign;
}

type PlacementEntry = {
  result: SponsoredAdResult;
  fetchedAt: number;
};

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
  private enabledPlacements = new Map<AdPlacement, boolean>();
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
    return !!entry && Date.now() - entry.fetchedAt < CACHE_TTL_MS;
  }

  invalidate(placement?: AdPlacement) {
    if (placement) {
      this.cache.delete(placement);
      this.snapshots.delete(placement);
    } else {
      this.cache.clear();
      this.snapshots.clear();
    }
    this.notify();
  }

  setEnabled(placement: AdPlacement, enabled: boolean) {
    this.enabledPlacements.set(placement, enabled);
    if (!enabled) this.invalidate(placement);
  }

  refreshActivePlacements() {
    for (const [placement, enabled] of this.enabledPlacements) {
      if (enabled) {
        void this.fetch(placement, true, true);
      }
    }
  }

  refreshPlacement(placement: AdPlacement) {
    if (this.enabledPlacements.get(placement)) {
      void this.fetch(placement, true, true);
    }
  }

  async fetch(placement: AdPlacement, enabled: boolean, force = false) {
    if (!enabled) {
      this.invalidate(placement);
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
      const data = await apiRequest<SponsoredAdResult>(
        `/ads/serve?placement=${encodeURIComponent(placement)}&sessionId=${encodeURIComponent(sessionId)}`,
        { auth: 'optional', priority: 'prefetch' },
      );
      if (__DEV__) console.log('[SponsoredAd]', placement, data?.source, data?.campaign?.title ?? '-');
      const result: SponsoredAdResult = data?.source === 'sponsored' && data.campaign
        ? { source: 'sponsored', campaign: data.campaign }
        : { source: 'admob' };

      if (this.enabledPlacements.get(placement) === false) return;
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
      await apiRequest('/ads/click', {
        method: 'POST',
        auth: 'optional',
        body: { campaignId, sessionId },
      });
    } catch {
      // ignore
    }
  }
}

export const sponsoredAdStore = new SponsoredAdStore();

export function useSponsoredAd(placement: AdPlacement, enabled = true) {
  useEffect(() => {
    sponsoredAdStore.setEnabled(placement, enabled);
    prefetchSponsoredAd(placement, enabled);
  }, [placement, enabled]);

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

/** Direct serve call for feed injection — bypasses placement cache so consecutive slots diversify. */
export async function fetchDiversifiedSponsoredAd(
  placement: AdPlacement,
  opts: {
    excludeCampaignIds?: number[];
    excludeBusinessIds?: number[];
  } = {},
): Promise<SponsoredCampaign | null> {
  try {
    const sessionId = await getOrCreateSessionId();
    const params = new URLSearchParams({
      placement,
      sessionId,
    });
    if (opts.excludeCampaignIds?.length) {
      params.set('excludeCampaignIds', opts.excludeCampaignIds.join(','));
    }
    if (opts.excludeBusinessIds?.length) {
      params.set('excludeBusinessIds', opts.excludeBusinessIds.join(','));
    }

    const data = await apiRequest<SponsoredAdResult>(`/ads/serve?${params.toString()}`, { auth: 'optional', priority: 'prefetch' });
    if (data?.source !== 'sponsored' || !data.campaign) return null;
    return data.campaign as SponsoredCampaign;
  } catch {
    return null;
  }
}
