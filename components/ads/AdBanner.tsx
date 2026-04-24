import React, { useState } from 'react';
import { View } from 'react-native';
import { BannerAd, BannerAdSize, TestIds } from 'react-native-google-mobile-ads';
import { useTheme } from '../../contexts/ThemeContext';



const BANNER_ID = "ca-app-pub-1660420496578702/5609918502"



export function AdBanner({
  unitId = BANNER_ID,
  size = BannerAdSize.ANCHORED_ADAPTIVE_BANNER,
  marginHorizontal = 20,
}: {
  unitId?: string;
  size?: BannerAdSize;
  marginHorizontal?: number;
} = {}) {
  const { theme } = useTheme();
  const [loaded, setLoaded] = useState(false);

  return (
    <View style={{
      marginHorizontal,
      marginVertical: 8,
      borderRadius: 16,
      overflow: 'hidden',
      borderWidth: loaded ? 1 : 0,
      borderColor: theme.border,
      backgroundColor: loaded ? theme.surface : 'transparent',
      alignItems: 'center',
    }}>
      <BannerAd
        unitId={unitId}
        size={size}
        requestOptions={{ requestNonPersonalizedAdsOnly: false }}
        onAdLoaded={() => setLoaded(true)}
        onAdFailedToLoad={() => setLoaded(false)}
      />
    </View>
  );
}
