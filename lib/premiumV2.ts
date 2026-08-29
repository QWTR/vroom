import { apiRequest } from './api/client';

export type PremiumFeatureFlags = {
  premiumOfferV2: boolean; premiumIdentityV1: boolean; driveReplayV1: boolean; smartStartV1: boolean;
  garageProV1: boolean; marketWatchV1: boolean; convoyLiveV1: boolean; routeStudioV1: boolean;
  scenicBetaV1: boolean; offlineCorridorsV1: boolean;
};

export type PremiumCatalog = {
  version: number;
  flags: PremiumFeatureFlags;
  groups: Array<{ key: string; title: string; benefits: Array<{ key: string; title: string; description: string; feature?: keyof PremiumFeatureFlags | null; enabled: boolean }> }>;
  limits: Record<string, { free: number | null; premium: number | null }>;
  market: { availablePromoGrants: number; monthlyPromoDurationDays: number };
};

let cache: PremiumCatalog | null = null;
export async function getPremiumCatalog(force = false): Promise<PremiumCatalog> {
  if (cache && !force) return cache;
  cache = await apiRequest<PremiumCatalog>('/premium/catalog', { priority: 'visible' });
  return cache;
}

export function clearPremiumCatalogCache(): void { cache = null; }
