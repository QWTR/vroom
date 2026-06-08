import React from 'react';
import { View } from 'react-native';
import { AdBanner, BANNER_ID_VROOM } from './AdBanner';
import { AdNativePost } from './AdNativePost';
import { SponsoredBanner } from './SponsoredBanner';
import { SponsoredNativePost } from './SponsoredNativePost';
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

  const partnerCampaign = result?.source === 'sponsored' ? result.campaign : undefined;
  const hasPartner = !!partnerCampaign?.title;

  const { displaySource, markAdmobFailed } = useAdRotation(placement, hasPartner, adsEnabled);

  if (premiumLoading || isPremium) return null;

  const onPartnerPress = () => {
    if (partnerCampaign) recordClick(partnerCampaign.id);
  };

  const renderPartner = () => {
    if (!partnerCampaign) return null;
    if (variant === 'native') {
      return (
        <SponsoredNativePost
          campaign={partnerCampaign}
          onPress={onPartnerPress}
        />
      );
    }
    return (
      <SponsoredBanner
        campaign={partnerCampaign}
        onPress={onPartnerPress}
        aspectRatio={BANNER_ASPECT[placement]}
      />
    );
  };

  const renderAdmob = () => {
    if (variant === 'native') {
      return <AdNativePost onFailedToLoad={markAdmobFailed} />;
    }
    return (
      <AdBanner
        BANNERID={BANNER_IDS[placement] || BANNER_ID_VROOM}
        onFailedToLoad={markAdmobFailed}
      />
    );
  };

  const renderLoadingShell = () => (
    <View
      style={{
        marginHorizontal: variant === 'native' ? 12 : 20,
        marginVertical: variant === 'native' ? 0 : 6,
        marginBottom: variant === 'native' ? 10 : undefined,
        minHeight: variant === 'native' ? 40 : 44,
        borderRadius: variant === 'native' ? 14 : 12,
      }}
    />
  );

  if (loading && !partnerCampaign) {
    return displaySource === 'partner' ? renderLoadingShell() : renderAdmob();
  }

  if (displaySource === 'partner') {
    return renderPartner() ?? renderAdmob();
  }

  return renderAdmob();
}
