import { useMemo } from 'react';
import { useEffectivePremium } from './useEffectivePremium';

export type SubscriptionStatus = {
  isPremium: boolean;
  premiumExpiresAt: string | null;
  isLoading: boolean;
};

/**
 * Jedno źródło prawdy dla premium (RevenueCat + serwer / gift + profil).
 * Mapa i nawigacja są darmowe — ten hook służy do BG GPS, skórek, partnerów itd.
 */
export function useSubscriptionStatus(
  profile?: { isPremium?: boolean; premiumExpiresAt?: string | null } | null,
): SubscriptionStatus {
  const { isPremium, premiumExpiresAt, isLoading } = useEffectivePremium(profile);

  return useMemo(
    () => ({
      isPremium,
      premiumExpiresAt,
      isLoading,
    }),
    [isPremium, premiumExpiresAt, isLoading],
  );
}
