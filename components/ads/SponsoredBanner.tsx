import React, { useState } from 'react';
import { View, TouchableOpacity, Linking, Text } from 'react-native';
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
  const [imageFailed, setImageFailed] = useState(false);

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
          backgroundColor: theme.surface,
        }}
      >
        {!imageFailed && !!campaign.imageUrl ? (
          <Image
            source={{ uri: campaign.imageUrl }}
            style={{ width: '100%', aspectRatio }}
            contentFit="cover"
            onError={() => {
              setImageFailed(true);
              if (!campaign.title) onImageError?.();
            }}
          />
        ) : (
          <View style={{ padding: 16, minHeight: 72, justifyContent: 'center' }}>
            <Text style={{ fontFamily: 'Orbitron', color: theme.text, fontSize: 13, fontWeight: '700' }}>
              {campaign.title}
            </Text>
            {!!campaign.body && (
              <Text style={{ color: theme.textDim, fontSize: 12, marginTop: 4 }}>{campaign.body}</Text>
            )}
            <Text style={{ fontFamily: 'Orbitron', color: '#e33835', fontSize: 9, marginTop: 8 }}>
              {(campaign.ctaText || 'Dowiedz się więcej').toUpperCase()}
            </Text>
          </View>
        )}
      </View>
    </TouchableOpacity>
  );
}
