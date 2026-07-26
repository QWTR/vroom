import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { BannerAd, BannerAdSize, TestIds } from 'react-native-google-mobile-ads';
import { useTheme } from '../../contexts/ThemeContext';
import { useEffectivePremium } from '../../hooks/useEffectivePremium';
import { bootstrapAdsWithConsent, getAdMobRequestOptions } from '../../lib/adsConsentBootstrap';

/** BanerVroom — domyślna jednostka (strona główna). */
export const BANNER_ID_VROOM = 'ca-app-pub-1660420496578702/5609918502';

interface AdBannerProps {
  BANNERID?: string;
  onFailedToLoad?: () => void;
}

export function AdBanner({ BANNERID = BANNER_ID_VROOM, onFailedToLoad }: AdBannerProps) {
  const { theme } = useTheme();
  const { isPremium, isLoading: premiumLoading } = useEffectivePremium();
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [retryTick, setRetryTick] = useState(0);
  const [requestOptions, setRequestOptions] = useState<{ requestNonPersonalizedAdsOnly: boolean }>({
    requestNonPersonalizedAdsOnly: true,
  });
  const [adsReady, setAdsReady] = useState(false);

  const forceTestAds = process.env.EXPO_PUBLIC_FORCE_TEST_ADS === '1';
  const unitId = (__DEV__ || forceTestAds) ? TestIds.ADAPTIVE_BANNER : BANNERID;

  useEffect(() => {
    if (premiumLoading || isPremium) return;
    let cancelled = false;
    void (async () => {
      await bootstrapAdsWithConsent();
      const opts = await getAdMobRequestOptions();
      if (!cancelled) {
        setRequestOptions(opts);
        setAdsReady(true);
      }
    })();
    return () => { cancelled = true; };
  }, [isPremium, premiumLoading]);

  useEffect(() => {
    if (!failed || isPremium || premiumLoading) return;
    const t = setTimeout(() => {
      setFailed(false);
      setLoaded(false);
      setRetryTick((v: number) => v + 1);
    }, 15000);
    return () => clearTimeout(t);
  }, [failed, isPremium, premiumLoading]);

  useEffect(() => {
    if (!failed || isPremium || premiumLoading) return;
    onFailedToLoad?.();
  }, [failed, isPremium, premiumLoading, onFailedToLoad]);

  const shellStyle = {
    marginHorizontal: 20,
    marginVertical: 6,
    borderRadius: 12,
    overflow: 'hidden' as const,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.surface,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    minHeight: 44,
  };

  if (premiumLoading || isPremium) return null;
  if (!adsReady) return <View style={shellStyle} />;

  if (failed) return <View style={shellStyle} />;

  return (
    <View style={shellStyle}>
      <BannerAd
        key={`banner-${retryTick}-${unitId}`}
        unitId={unitId}
        size={BannerAdSize.ANCHORED_ADAPTIVE_BANNER}
        requestOptions={requestOptions}
        onAdLoaded={() => setLoaded(true)}
        onAdFailedToLoad={(err: any) => {
          setLoaded(false);
          setFailed(true);
          onFailedToLoad?.();
          console.warn('[AdBanner] failed', { unitId, error: err });
        }}
      />
      {!loaded && (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: 0,
            bottom: 0,
            justifyContent: 'center',
            alignItems: 'center',
            backgroundColor: theme.surface,
          }}
        />
      )}
    </View>
  );
}
