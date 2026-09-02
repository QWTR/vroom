import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { AppText as Text } from '../ui/AppText';
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
import { useEffectivePremium } from '../../hooks/useEffectivePremium';
import { bootstrapAdsWithConsent, getAdMobRequestOptions } from '../../lib/adsConsentBootstrap';

/** Dyskusje — native advanced */
const NATIVE_ID = 'ca-app-pub-1660420496578702/9815615187';

interface AdNativePostProps {
  onFailedToLoad?: () => void;
}

export function AdNativePost({ onFailedToLoad }: AdNativePostProps) {
  const { theme } = useTheme();
  const { isPremium, isLoading: premiumLoading } = useEffectivePremium();
  const [nativeAd, setNativeAd] = useState<NativeAd | null>(null);
  const [failed,   setFailed]   = useState(false);
  const [retryTick, setRetryTick] = useState(0);

  useEffect(() => {
    if (premiumLoading || isPremium) {
      setNativeAd(null);
      setFailed(false);
      return;
    }

    if (process.env.EXPO_PUBLIC_DISABLE_FEED_ADS === '1') {
      setFailed(true);
      return;
    }

    let ad: NativeAd | null = null;
    let cancelled = false;
    const forceTestAds = process.env.EXPO_PUBLIC_FORCE_TEST_ADS === '1';
    const unitId = (__DEV__ || forceTestAds) ? TestIds.NATIVE : NATIVE_ID;

    void (async () => {
      await bootstrapAdsWithConsent();
      const requestOptions = await getAdMobRequestOptions();
      if (cancelled) return;
      NativeAd.createForAdRequest(unitId, requestOptions).then(createdAd => {
        if (cancelled) {
          createdAd.destroy();
          return;
        }
        ad = createdAd;
        setNativeAd(createdAd);
        setFailed(false);
      }).catch((e: any) => {
        if (cancelled) return;
        setFailed(true);
        console.warn('[AdNativePost] failed', { unitId, error: e });
      });
    })();

    return () => {
      cancelled = true;
      ad?.destroy();
    };
  }, [isPremium, premiumLoading, retryTick]);

  useEffect(() => {
    if (!failed || isPremium || premiumLoading) return;
    const t = setTimeout(() => {
      setFailed(false);
      setNativeAd(null);
      setRetryTick((v: number) => v + 1);
    }, 20000);
    return () => clearTimeout(t);
  }, [failed, isPremium, premiumLoading]);

  useEffect(() => {
    if (!failed || isPremium || premiumLoading) return;
    onFailedToLoad?.();
  }, [failed, isPremium, premiumLoading, onFailedToLoad]);

  if (premiumLoading || isPremium) return null;

  if (!nativeAd) {
    if (failed) return null;
    return (
      <View
        style={{
          marginHorizontal: 12,
          marginBottom: 10,
          minHeight: 40,
          borderRadius: 14,
          backgroundColor: theme.surface,
        }}
      />
    );
  }

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
                fontFamily: 'Manrope_600SemiBold',
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
              <Text style={{ fontFamily: 'Manrope_600SemiBold', color: '#e33835', fontSize: 12, letterSpacing: 1 }}>
                REKLAMA
              </Text>
            </View>
          </View>
          <Text style={{ fontFamily: 'Manrope_600SemiBold', color: theme.textDim, fontSize: 12, marginTop: 2, letterSpacing: 1 }}>
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
        <Text style={{ fontFamily: 'Manrope_600SemiBold', fontSize: 12, color: theme.textDim, flex: 1 }}>
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
            fontFamily: 'Manrope_600SemiBold',
            color: '#fff',
            fontSize: 12,
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