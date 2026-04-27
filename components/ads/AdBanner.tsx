import React, { useState } from 'react';
import { View } from 'react-native';
import { BannerAd, BannerAdSize, TestIds } from 'react-native-google-mobile-ads';
import { useTheme } from '../../contexts/ThemeContext';



const BANNER_ID = "ca-app-pub-1660420496578702/5609918502"

// const BANNER_ID = __DEV__
//   ? TestIds.ADAPTIVE_BANNER
//   : 'ca-app-pub-1660420496578702/5609918502';

export function AdBanner({BANNERID = BANNER_ID}) {
  const { theme } = useTheme();
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  if (failed) return null;

  return (
    <View style={{
      marginHorizontal: 20,
      marginVertical: 3,
      borderRadius: 16,
      overflow: 'hidden',
      borderWidth: loaded ? 1 : 0,
      borderColor: theme.border,
      backgroundColor: loaded ? theme.surface : 'transparent',
      alignItems: 'center',
      minHeight: 50,
    }}>
      <BannerAd
        unitId={BANNERID}
        size={BannerAdSize.ANCHORED_ADAPTIVE_BANNER}
        requestOptions={{ requestNonPersonalizedAdsOnly: false }}
        onAdLoaded={() => setLoaded(true)}
        onAdFailedToLoad={() => { setLoaded(false); setFailed(true); }}
      />
    </View>
  );
}
