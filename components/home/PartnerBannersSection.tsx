import React, { useEffect, useRef } from 'react';
import { View, TouchableOpacity, Animated, Linking, Text, FlatList, Dimensions } from 'react-native';
import { Image } from 'expo-image';
import { usePartnerBanners } from '../../hooks/usePartnerBanners';

// Definiujemy szerokość karty, aby karuzela wiedziała, gdzie "snapować"
const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CARD_WIDTH = 280; // Szerokość Twojego banera + marginesy
const SNAP_INTERVAL = CARD_WIDTH + 12; // Szerokość karty + gap (odstęp)

interface Props {
  theme: any;
  isDark: boolean;
  fadeAnim: Animated.Value;
}

export function PartnerBannersSection({ theme: t, isDark, fadeAnim }: Props) {
  const { banners, fetchBanners } = usePartnerBanners();

  useEffect(() => {
    fetchBanners();
  }, [fetchBanners]);

  if (banners.length === 0) return null;

  return (
    <Animated.View style={{ opacity: fadeAnim, marginBottom: 20 }}>
      <Text 
        style={{ 
          fontFamily: 'Orbitron', 
          fontSize: 8, 
          color: t.textDim, 
          letterSpacing: 4, 
          marginBottom: 14, 
          paddingHorizontal: 20 
        }}
      >
        PARTNERZY & AKTUALNOŚCI
      </Text>

      <FlatList
        data={banners}
        keyExtractor={(item) => item.id}
        horizontal
        showsHorizontalScrollIndicator={false}
        // KLUCZOWE WŁAŚCIWOŚCI DLA KARUZELI:
        snapToInterval={SNAP_INTERVAL} // Co ile ma "przyciągać" (szerokość karty + przerwa)
        decelerationRate="fast" // Szybsze zatrzymywanie się
        contentContainerStyle={{ paddingHorizontal: 20, gap: 12 }} // Odstęp na początku i między kartami
        
        renderItem={({ item: banner }) => (
          <TouchableOpacity
            onPress={() => banner.linkUrl && Linking.openURL(banner.linkUrl)}
            activeOpacity={0.85}
          >
            <View style={{
              width: CARD_WIDTH,
              borderRadius: 18,
              overflow: 'hidden',
              borderWidth: 1,
              borderColor: t.border,
              backgroundColor: t.surface,
            }}>
              <Image
                source={{ uri: banner.imageUrl }}
                style={{ width: '100%', height: 140 }}
                contentFit="cover"
              />
              {!!banner.title && (
                <View style={{ padding: 12 }}>
                  <Text 
                    numberOfLines={1}
                    style={{
                      fontFamily: 'Orbitron',
                      fontSize: 11,
                      color: t.text,
                      fontWeight: '700',
                    }}
                  >
                    {banner.title}
                  </Text>
                </View>
              )}
            </View>
          </TouchableOpacity>
        )}
      />
    </Animated.View>
  );
}