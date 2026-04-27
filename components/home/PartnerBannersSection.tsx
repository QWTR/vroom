import React, { useEffect } from 'react';
import { View, ScrollView, TouchableOpacity, Animated, Linking, Text } from 'react-native';
import { Image } from 'expo-image';
import { usePartnerBanners } from '../../hooks/usePartnerBanners';

interface Props {
  theme: any;
  isDark: boolean;
  fadeAnim: Animated.Value;
}

export function PartnerBannersSection({ theme: t, isDark, fadeAnim }: Props) {
  const { banners, fetchBanners } = usePartnerBanners();

  useEffect(() => { fetchBanners(); }, [fetchBanners]);

  if (banners.length === 0) return null;

  return (
    <Animated.View style={{ opacity: fadeAnim, marginBottom: 20 }}>
      <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: t.textDim, letterSpacing: 4, marginBottom: 14, paddingHorizontal: 20 }}>
        PARTNERZY & AKTUALNOŚCI
      </Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 20, gap: 12 }}
      >
        {banners.map(banner => (
          <TouchableOpacity
            key={banner.id}
            onPress={() => banner.linkUrl && Linking.openURL(banner.linkUrl)}
            activeOpacity={0.85}
          >
            <View style={{
              width: 260,
              borderRadius: 18,
              overflow: 'hidden',
              borderWidth: 1,
              borderColor: t.border,
              backgroundColor: t.surface,
            }}>
              <Image
                source={{ uri: banner.imageUrl }}
                style={{ width: 260, height: 140 }}
                contentFit="cover"
              />
              {!!banner.title && (
                <View style={{ padding: 12 }}>
                  <Text style={{
                    fontFamily: 'Orbitron',
                    fontSize: 11,
                    color: t.text,
                    fontWeight: '700',
                  }}>
                    {banner.title}
                  </Text>
                </View>
              )}
            </View>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </Animated.View>
  );
}
