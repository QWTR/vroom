import React, { useState } from 'react';
import { View, TouchableOpacity, Linking } from 'react-native';
import { AppText as Text } from '../ui/AppText';
import { Image } from 'expo-image';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useTheme } from '../../contexts/ThemeContext';
import type { SponsoredCampaign } from '../../hooks/useSponsoredAd';

interface Props {
  campaign: SponsoredCampaign;
  onPress?: () => void;
  onImageError?: () => void;
}

export function SponsoredNativePost({ campaign, onPress }: Props) {
  const { theme } = useTheme();
  const [heroFailed, setHeroFailed] = useState(false);

  const open = () => {
    onPress?.();
    if (campaign.linkUrl) Linking.openURL(campaign.linkUrl);
  };

  return (
    <TouchableOpacity onPress={open} activeOpacity={0.9}>
      <View
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
        <View style={{ flexDirection: 'row', alignItems: 'center', padding: 14, paddingBottom: 10 }}>
          <View
            style={{
              width: 42,
              height: 42,
              borderRadius: 21,
              backgroundColor: '#FFD70018',
              borderWidth: 1.5,
              borderColor: '#FFD70050',
              overflow: 'hidden',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {!!campaign.imageUrl ? (
              <Image source={{ uri: campaign.imageUrl }} style={{ width: 42, height: 42 }} contentFit="cover" />
            ) : (
              <MaterialIcons name="campaign" size={20} color="#FFD700" />
            )}
          </View>
          <View style={{ flex: 1, marginLeft: 10 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Text style={{ fontFamily: 'Manrope_600SemiBold', color: theme.text, fontSize: 12, fontWeight: '700' }}>
                {campaign.companyName || campaign.title}
              </Text>
              <View style={{ backgroundColor: '#e3383515', borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2, borderWidth: 1, borderColor: '#e3383530' }}>
                <Text style={{ fontFamily: 'Manrope_600SemiBold', color: '#e33835', fontSize: 12 }}>REKLAMA PARTNERA</Text>
              </View>
            </View>
            <Text style={{ fontFamily: 'Manrope_600SemiBold', color: theme.textDim, fontSize: 12, marginTop: 2 }}>Treść sponsorowana</Text>
          </View>
        </View>

        <View style={{ paddingHorizontal: 14, paddingBottom: 10 }}>
          <Text style={{ color: theme.text, fontSize: 14, fontWeight: '700', marginBottom: 4 }}>{campaign.title}</Text>
          {!!campaign.body && (
            <Text style={{ color: theme.textDim, fontSize: 13, lineHeight: 20 }}>{campaign.body}</Text>
          )}
        </View>

        {!!campaign.imageUrl && !heroFailed && (
          <Image
            source={{ uri: campaign.imageUrl }}
            style={{ width: '100%', height: 180 }}
            contentFit="cover"
            onError={() => setHeroFailed(true)}
          />
        )}

        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 14, borderTopWidth: 1, borderTopColor: theme.border, gap: 8 }}>
          <MaterialIcons name="campaign" size={14} color={theme.textDim} />
          <Text style={{ fontFamily: 'Manrope_600SemiBold', fontSize: 12, color: theme.textDim, flex: 1 }}>Sponsorowane</Text>
          <View style={{ backgroundColor: '#e33835', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8 }}>
            <Text style={{ fontFamily: 'Manrope_600SemiBold', color: '#fff', fontSize: 12, fontWeight: '700' }}>
              {(campaign.ctaText || 'DOWIEDZ SIĘ').toUpperCase()}
            </Text>
          </View>
        </View>
      </View>
    </TouchableOpacity>
  );
}
