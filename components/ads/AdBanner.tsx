import React, { useEffect, useState } from 'react';
import { View, Text } from 'react-native';
import { BannerAd, BannerAdSize, TestIds } from 'react-native-google-mobile-ads';
import { useTheme } from '../../contexts/ThemeContext';
import { usePremium } from '../../contexts/PremiumContext';
import { AdPlaceholder } from './AdPlaceholder';

/** BanerVroom — domyślna jednostka (strona główna). */
export const BANNER_ID_VROOM = 'ca-app-pub-1660420496578702/5609918502';

interface AdBannerProps {
  BANNERID?: string;
  onFailedToLoad?: () => void;
}

export function AdBanner({ BANNERID = BANNER_ID_VROOM, onFailedToLoad }: AdBannerProps) {
  const { theme } = useTheme();
  const { isPremium, isLoading: premiumLoading } = usePremium();
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [retryTick, setRetryTick] = useState(0);

  const forceTestAds = process.env.EXPO_PUBLIC_FORCE_TEST_ADS === '1';
  const unitId = (__DEV__ || forceTestAds) ? TestIds.ADAPTIVE_BANNER : BANNERID;

  useEffect(() => {
    if (!failed || isPremium || premiumLoading) return;
    const t = setTimeout(() => {
      setFailed(false);
      setLoaded(false);
      setRetryTick((v: number) => v + 1);
    }, 15000);
    return () => clearTimeout(t);
  }, [failed, isPremium, premiumLoading]);

  if (premiumLoading || isPremium) return null;
  if (failed) {
    if (onFailedToLoad) return null;
    return <AdPlaceholder variant="banner" />;
  }

  return (
    <View
      style={{
        marginHorizontal: 20,
        marginVertical: 6,
        borderRadius: 12,
        overflow: 'hidden',
        borderWidth: 1,
        borderColor: theme.border,
        backgroundColor: theme.surface,
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: loaded ? undefined : 44,
      }}
    >
      <BannerAd
        key={`banner-${retryTick}-${unitId}`}
        unitId={unitId}
        size={BannerAdSize.ANCHORED_ADAPTIVE_BANNER}
        requestOptions={{ requestNonPersonalizedAdsOnly: false }}
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
            paddingHorizontal: 8,
          }}
        >
          <Text
            style={{
              fontFamily: 'Orbitron',
              color: theme.textDim,
              fontSize: 8,
              textAlign: 'center',
              letterSpacing: 1,
            }}
          >
            TU POWINNA BYĆ REKLAMA
          </Text>
        </View>
      )}
    </View>
  );
}
