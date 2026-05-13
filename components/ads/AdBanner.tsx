import React, { useState } from 'react';
import { View, Text } from 'react-native';
import { BannerAd, BannerAdSize, TestIds } from 'react-native-google-mobile-ads';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useTheme } from '../../contexts/ThemeContext';

const BANNER_ID = 'ca-app-pub-1660420496578702/5609918502';

function BannerPlaceholder({ variant }: { variant: 'loading' | 'failed' }) {
  const { theme } = useTheme();
  return (
    <View
      style={{
        marginHorizontal: 20,
        marginVertical: 8,
        minHeight: 72,
        paddingVertical: 14,
        paddingHorizontal: 16,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: '#e3383530',
        borderStyle: 'dashed',
        backgroundColor: theme.surface,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
      }}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          backgroundColor: '#e3383510',
          borderRadius: 10,
          paddingHorizontal: 12,
          paddingVertical: 6,
        }}
      >
        <MaterialIcons name="campaign" size={14} color="#e33835" />
        <Text style={{ fontFamily: 'Orbitron', color: '#e33835', fontSize: 8, letterSpacing: 2 }}>
          REKLAMA
        </Text>
      </View>
      <Text
        style={{
          fontFamily: 'Orbitron',
          color: theme.textDim,
          fontSize: 10,
          textAlign: 'center',
          letterSpacing: 1,
        }}
      >
        TU POWINNA BYĆ REKLAMA
      </Text>
      <Text
        style={{
          fontFamily: 'Orbitron',
          color: theme.textDim,
          fontSize: 8,
          textAlign: 'center',
          opacity: 0.55,
        }}
      >
        {variant === 'loading'
          ? 'Ładowanie…'
          : 'Nie udało się załadować albo brak reklam w tym regionie / na emulatorze'}
      </Text>
    </View>
  );
}

export function AdBanner({ BANNERID = BANNER_ID }) {
  const { theme } = useTheme();
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  const unitId = __DEV__ ? TestIds.ADAPTIVE_BANNER : BANNERID;

  if (failed) {
    return <BannerPlaceholder variant="failed" />;
  }

  return (
    <View
      style={{
        marginHorizontal: 20,
        marginVertical: 8,
        borderRadius: 16,
        overflow: 'hidden',
        borderWidth: 1,
        borderColor: theme.border,
        backgroundColor: theme.surface,
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: loaded ? undefined : 72,
      }}
    >
      <BannerAd
        unitId={unitId}
        size={BannerAdSize.ANCHORED_ADAPTIVE_BANNER}
        requestOptions={{ requestNonPersonalizedAdsOnly: false }}
        onAdLoaded={() => setLoaded(true)}
        onAdFailedToLoad={() => {
          setLoaded(false);
          setFailed(true);
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
            gap: 6,
            paddingHorizontal: 12,
          }}
        >
          <MaterialIcons name="campaign" size={18} color="#e33835" />
          <Text
            style={{
              fontFamily: 'Orbitron',
              color: theme.textDim,
              fontSize: 9,
              textAlign: 'center',
              letterSpacing: 1,
            }}
          >
            TU POWINNA BYĆ REKLAMA
          </Text>
          <Text style={{ fontFamily: 'Orbitron', color: theme.textDim, fontSize: 7, opacity: 0.6 }}>
            Ładowanie…
          </Text>
        </View>
      )}
    </View>
  );
}
