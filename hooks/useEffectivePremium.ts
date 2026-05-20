import { useCallback, useMemo } from 'react';
import { usePremium } from '../contexts/PremiumContext';
import { useSettings } from './useSettings';

type PremiumProfileSlice = {
  isPremium?: boolean;
  premiumExpiresAt?: string | null;
} | null | undefined;

/**
 * Subskrypcja Premium — baner, giełda, personalizacja, GPS w tle itd.
 * NIE dotyczy waluty Nitro (sklep ozdób — useProfileShop / useNitroWallet).
 *
 * Źródła: RevenueCat + /api/premium/status + /api/settings + profil (/me).
 */
export function useEffectivePremium(profile?: PremiumProfileSlice) {
  const {
    isPremium: fromPremiumContext,
    isLoading: premiumLoading,
    premiumExpiresAt: contextExpiresAt,
    refreshPremiumStatus,
  } = usePremium();
  const { settings, loading: settingsLoading, fetchSettings } = useSettings();

  /** Backend (status + /me) oraz profil — ta sama logika co baner na serwerze. */
  const isPremium = useMemo(
    () => !!(fromPremiumContext || profile?.isPremium),
    [fromPremiumContext, profile?.isPremium],
  );

  const premiumExpiresAt =
    contextExpiresAt
    ?? settings.premiumExpiresAt
    ?? profile?.premiumExpiresAt
    ?? null;

  const refresh = useCallback(async () => {
    const [active] = await Promise.all([
      refreshPremiumStatus(),
      fetchSettings(),
    ]);
    return !!(active || profile?.isPremium);
  }, [refreshPremiumStatus, fetchSettings, profile?.isPremium]);

  return {
    isPremium,
    premiumExpiresAt,
    isLoading: premiumLoading || settingsLoading,
    refresh,
    refreshPremiumStatus,
    fetchSettings,
  };
}
