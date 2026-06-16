import { useEffect, useRef } from 'react';
import { bootstrapAdsWithConsent } from '../../lib/adsConsentBootstrap';

/**
 * Uruchamia UMP (requestInfoUpdate → showForm) i dopiero potem mobileAds().initialize().
 * Komponent renderuje null — nie blokuje wejścia do aplikacji; formularz CMP to natywny popup.
 */
export function AdsConsentBootstrap() {
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void bootstrapAdsWithConsent();
  }, []);

  return null;
}
