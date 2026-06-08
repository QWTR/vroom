import React from 'react';
import { AdBanner, BANNER_ID_VROOM } from './AdBanner';
import { AdNativePost } from './AdNativePost';
import { SponsoredBanner } from './SponsoredBanner';
import { SponsoredNativePost } from './SponsoredNativePost';
import { AdPlaceholder } from './AdPlaceholder';
import { useSponsoredAd, type AdPlacement } from '../../hooks/useSponsoredAd';
import { useAdRotation } from '../../hooks/useAdRotation';
import { usePremium } from '../../contexts/PremiumContext';

const BANNER_IDS: Partial<Record<AdPlacement, string>> = {
  map_banner: 'ca-app-pub-1660420496578702/3363343740',
  home_banner: BANNER_ID_VROOM,
};

const BANNER_ASPECT: Partial<Record<AdPlacement, number>> = {
  map_banner: 728 / 90,
  home_banner: 320 / 100,
};

interface Props {
  placement: AdPlacement;
  variant: 'banner' | 'native';
  enabled?: boolean;
}

export function AdSlot({ placement, variant, enabled = true }: Props) {
  const { isPremium, isLoading: premiumLoading } = usePremium();
  const adsEnabled = enabled && !premiumLoading && !isPremium;

  const { result, loading, recordClick } = useSponsoredAd(placement, adsEnabled);

  const hasPartner = result?.source === 'sponsored' && !!result?.campaign?.imageUrl;
  const { displaySource, markAdmobFailed, markPartnerFailed } = useAdRotation(hasPartner, adsEnabled);

  if (premiumLoading || isPremium) return null;

  const onPartnerPress = () => {
    if (result?.campaign) recordClick(result.campaign.id);
  };

  if (loading && !result) {
    return <AdPlaceholder variant={variant} />;
  }

  if (displaySource === 'partner' && result?.campaign) {
    if (variant === 'native') {
      return (
        <SponsoredNativePost
          campaign={result.campaign}
          onPress={onPartnerPress}
          onImageError={markPartnerFailed}
        />
      );
    }
    return (
      <SponsoredBanner
        campaign={result.campaign}
        onPress={onPartnerPress}
        aspectRatio={BANNER_ASPECT[placement]}
        onImageError={markPartnerFailed}
      />
    );
  }

  if (displaySource === 'admob') {
    if (variant === 'native') {
      return <AdNativePost onFailedToLoad={markAdmobFailed} />;
    }
    return (
      <AdBanner
        BANNERID={BANNER_IDS[placement] || BANNER_ID_VROOM}
        onFailedToLoad={markAdmobFailed}
      />
    );
  }

  return <AdPlaceholder variant={variant} />;
}
