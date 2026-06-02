import React from 'react';
import { View, Text, TouchableOpacity, Linking } from 'react-native';
import { Image } from 'expo-image';
import { useTheme } from '../../contexts/ThemeContext';
import type { SponsoredCampaign } from '../../hooks/useSponsoredAd';

interface Props {
  campaign: SponsoredCampaign;
  onPress?: () => void;
}

export function SponsoredBanner({ campaign, onPress }: Props) {
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
          backgroundColor: theme.surface,
        }}
      >
        <Image
          source={{ uri: campaign.imageUrl }}
          style={{ width: '100%', height: 80 }}
          contentFit="cover"
        />
        <View style={{ padding: 10, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <View style={{ flex: 1 }}>
            <Text numberOfLines={1} style={{ fontFamily: 'Orbitron', fontSize: 11, fontWeight: '700', color: theme.text }}>
              {campaign.title}
            </Text>
            {!!campaign.companyName && (
              <Text style={{ fontSize: 9, color: theme.textDim, marginTop: 2 }}>{campaign.companyName}</Text>
            )}
          </View>
          <View style={{ backgroundColor: '#e3383515', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 }}>
            <Text style={{ fontFamily: 'Orbitron', fontSize: 7, color: '#e33835' }}>PARTNER</Text>
          </View>
        </View>
      </View>
    </TouchableOpacity>
  );
}
