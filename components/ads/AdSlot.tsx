import React from 'react';
import { View } from 'react-native';
import { AdBanner, BANNER_ID_VROOM } from './AdBanner';
import { AdNativePost } from './AdNativePost';
import { SponsoredBanner } from './SponsoredBanner';
import { SponsoredNativePost } from './SponsoredNativePost';
import { useSponsoredAd, type AdPlacement } from '../../hooks/useSponsoredAd';
import { usePremium } from '../../contexts/PremiumContext';

const BANNER_IDS: Partial<Record<AdPlacement, string>> = {
  map_banner: 'ca-app-pub-1660420496578702/3363343740',
  home_banner: BANNER_ID_VROOM,
};

interface Props {
  placement: AdPlacement;
  variant: 'banner' | 'native';
  enabled?: boolean;
}

export function AdSlot({ placement, variant, enabled = true }: Props) {
  const { isPremium, isLoading: premiumLoading } = usePremium();
  const { result, loading, recordClick } = useSponsoredAd(placement, enabled && !premiumLoading && !isPremium);

  if (premiumLoading || isPremium) return null;

  if (!loading && result?.source === 'sponsored' && result.campaign) {
    const onPress = () => recordClick(result.campaign!.id);
    if (variant === 'native') {
      return <SponsoredNativePost campaign={result.campaign} onPress={onPress} />;
    }
    return <SponsoredBanner campaign={result.campaign} onPress={onPress} />;
  }

  if (loading) {
    return <View style={{ minHeight: variant === 'banner' ? 44 : 80 }} />;
  }

  if (variant === 'native') {
    return <AdNativePost />;
  }

  return <AdBanner BANNERID={BANNER_IDS[placement] || BANNER_ID_VROOM} />;
}
