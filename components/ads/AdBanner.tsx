import React, { useState } from 'react';
import { View } from 'react-native';
import { BannerAd, BannerAdSize, TestIds } from 'react-native-google-mobile-ads';
import { useTheme } from '../../contexts/ThemeContext';

const BANNER_ID = __DEV__
  ? TestIds.ADAPTIVE_BANNER
  : 'ca-app-pub-1660420496578702/9230988370';

export function AdBanner() {
  const { theme } = useTheme();
  const [loaded, setLoaded] = useState(false);

  return (
    <View style={{
      marginHorizontal: 20,
      marginVertical: 8,
      borderRadius: 16,
      overflow: 'hidden',
      borderWidth: loaded ? 1 : 0,
      borderColor: theme.border,
      backgroundColor: loaded ? theme.surface : 'transparent',
      alignItems: 'center',
    }}>
      <BannerAd
        unitId={BANNER_ID}
        size={BannerAdSize.ANCHORED_ADAPTIVE_BANNER}
        requestOptions={{ requestNonPersonalizedAdsOnly: false }}
        onAdLoaded={() => setLoaded(true)}
        onAdFailedToLoad={() => setLoaded(false)}
      />
    </View>
  );
}
