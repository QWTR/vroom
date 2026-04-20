import React, { useEffect, useState } from 'react';
import { View, Text } from 'react-native';
import {
  NativeAd,
  NativeAdView,
  HeadlineView,
  TaglineView,
  AdvertiserView,
  CallToActionView,
  ImageView,
  TestIds,
  NativeMediaView,
} from 'react-native-google-mobile-ads';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useTheme } from '../../contexts/ThemeContext';

const NATIVE_ID = __DEV__
  ? TestIds.NATIVE
  : 'ca-app-pub-1660420496578702/9615191240';

export function AdNativePost() {
  const { theme } = useTheme();
  const [nativeAd, setNativeAd] = useState<NativeAd | null>(null);

  useEffect(() => {
    let ad: NativeAd | null = null;
    let unsubscribe: (() => void) | undefined;

    NativeAd.createForAdRequest(NATIVE_ID, {
      requestNonPersonalizedAdsOnly: false,
    }).then(createdAd => {
      ad = createdAd;
      unsubscribe = createdAd.addAdEventListener('loaded', () => {
        setNativeAd(createdAd);
      });
      createdAd.load();
    });

    return () => {
      unsubscribe?.();
      ad?.destroy();
    };
  }, []);

  if (!nativeAd) return null;

  return (
    <NativeAdView
      nativeAd={nativeAd}
      style={{
        marginHorizontal: 12,
        marginBottom: 12,
        backgroundColor: theme.surface,
        borderRadius: 20,
        borderWidth: 1,
        borderColor: theme.border2,
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <View style={{ flexDirection: 'row', alignItems: 'center', padding: 14, paddingBottom: 10 }}>
        {/* Icon */}
        <View style={{
          width: 42, height: 42, borderRadius: 21,
          backgroundColor: '#e3383518',
          borderWidth: 1.5, borderColor: '#e3383530',
          justifyContent: 'center', alignItems: 'center',
          overflow: 'hidden',
        }}>
          <ImageView style={{ width: 42, height: 42 }} />
        </View>

        <View style={{ flex: 1, marginLeft: 10 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <AdvertiserView
              style={{
                fontFamily: 'Orbitron',
                color: theme.text,
                fontSize: 12,
                fontWeight: '700',
              }}
            />
            {/* REKLAMA badge */}
            <View style={{
              backgroundColor: '#e3383515',
              borderRadius: 8,
              paddingHorizontal: 6,
              paddingVertical: 2,
              borderWidth: 1,
              borderColor: '#e3383530',
            }}>
              <Text style={{ fontFamily: 'Orbitron', color: '#e33835', fontSize: 8, letterSpacing: 1 }}>
                REKLAMA
              </Text>
            </View>
          </View>
          <Text style={{ fontFamily: 'Orbitron', color: theme.textDim, fontSize: 8, marginTop: 2, letterSpacing: 1 }}>
            Treść sponsorowana
          </Text>
        </View>
      </View>

      {/* Treść */}
      <View style={{ paddingHorizontal: 14, paddingBottom: 10 }}>
        <HeadlineView
          style={{
            color: theme.text,
            fontSize: 14,
            fontWeight: '700',
            lineHeight: 20,
            marginBottom: 4,
          }}
        />
        <TaglineView
          style={{
            color: theme.textDim,
            fontSize: 13,
            lineHeight: 20,
          }}
        />
      </View>

      {/* Media */}
      <NativeMediaView
        style={{
          width: '100%',
          height: 180,
          marginBottom: 10,
        }}
      />

      {/* Footer z CTA */}
      <View style={{
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 14,
        paddingBottom: 14,
        paddingTop: 6,
        borderTopWidth: 1,
        borderTopColor: theme.border,
        gap: 8,
      }}>
        <MaterialIcons name="campaign" size={14} color={theme.textDim} />
        <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: theme.textDim, flex: 1 }}>
          Sponsorowane
        </Text>
        <CallToActionView
          style={{
            backgroundColor: '#e33835',
            borderRadius: 10,
            paddingHorizontal: 14,
            paddingVertical: 8,
          }}
          textStyle={{
            fontFamily: 'Orbitron',
            color: '#fff',
            fontSize: 10,
            fontWeight: '700',
          }}
          buttonAndroidStyle={{
            backgroundColor: '#e33835',
            borderRadius: 10,
          }}
          allCaps
        />
      </View>
    </NativeAdView>
  );
}