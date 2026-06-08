import React from 'react';
import { View, TouchableOpacity, Linking } from 'react-native';
import { Image } from 'expo-image';
import { useTheme } from '../../contexts/ThemeContext';
import type { SponsoredCampaign } from '../../hooks/useSponsoredAd';

interface Props {
  campaign: SponsoredCampaign;
  onPress?: () => void;
  aspectRatio?: number;
  onImageError?: () => void;
}

export function SponsoredBanner({ campaign, onPress, aspectRatio = 728 / 90, onImageError }: Props) {
  const { theme } = useTheme();

  const open = () => {
    onPress?.();
    if (campaign.linkUrl) Linking.openURL(campaign.linkUrl);
  };

  return (
    <TouchableOpacity onPress={open} activeOpacity={0.9}>
      <View
        style={{
          marginHorizontal: 20,
          marginVertical: 6,
          borderRadius: 12,
          overflow: 'hidden',
          borderWidth: 1,
          borderColor: theme.border,
        }}
      >
        <Image
          source={{ uri: campaign.imageUrl }}
          style={{ width: '100%', aspectRatio }}
          contentFit="cover"
          onError={() => onImageError?.()}
        />
      </View>
    </TouchableOpacity>
  );
}
