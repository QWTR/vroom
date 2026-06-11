import React, { useEffect } from 'react';
import {
  View, TouchableOpacity, Animated, Linking, Text, FlatList, Dimensions,
} from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { usePartnerBanners } from '../../hooks/usePartnerBanners';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
/** Jedna karta ~pełna szerokość z „podglądem” następnej — stabilny snap. */
const CARD_WIDTH = Math.min(SCREEN_WIDTH - 48, 320);
const SNAP_INTERVAL = CARD_WIDTH + 12;
const BANNER_HEIGHT = 180;

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

  const glassCardFill = isDark ? 'rgba(20, 5, 5, 0.4)' : 'rgba(255, 255, 255, 0.8)';
  const glassBorder = isDark ? 'rgba(227, 56, 53, 0.2)' : 'rgba(227, 56, 53, 0.15)';
  const glassShadow = {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 10,
    elevation: 4,
  };

  return (
    <Animated.View style={{ opacity: fadeAnim, marginBottom: 20 }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          marginBottom: 14,
          paddingHorizontal: 20,
        }}
      >
        <View
          style={{
            width: 3,
            height: 12,
            backgroundColor: '#e33835',
            borderRadius: 2,
            marginRight: 8,
          }}
        />
        <Text
          style={{
            fontFamily: 'Orbitron',
            fontSize: 8,
            color: t.textDim,
            letterSpacing: 4,
          }}
        >
          PARTNERZY & AKTUALNOŚCI
        </Text>
      </View>

      <FlatList
        data={banners}
        keyExtractor={(item) => item.id}
        horizontal
        showsHorizontalScrollIndicator={false}
        snapToInterval={SNAP_INTERVAL}
        decelerationRate="fast"
        snapToAlignment="start"
        disableIntervalMomentum
        contentContainerStyle={{ paddingHorizontal: 20, gap: 12 }}
        renderItem={({ item: banner }) => (
          <TouchableOpacity
            onPress={() => banner.linkUrl && Linking.openURL(banner.linkUrl)}
            activeOpacity={0.85}
          >
            <View
              style={{
                width: CARD_WIDTH,
                borderRadius: 20,
                overflow: 'hidden',
                borderWidth: 1,
                borderColor: glassBorder,
                backgroundColor: glassCardFill,
                ...glassShadow,
              }}
            >
              <View style={{ width: '100%', height: BANNER_HEIGHT, position: 'relative' }}>
                <Image
                  source={{ uri: banner.imageUrl }}
                  style={{ width: '100%', height: BANNER_HEIGHT }}
                  contentFit="cover"
                />
                {!!banner.title && (
                  <>
                    <LinearGradient
                      colors={['transparent', 'rgba(0,0,0,0.9)']}
                      style={{
                        position: 'absolute',
                        bottom: 0,
                        left: 0,
                        right: 0,
                        height: '50%',
                      }}
                    />
                    <View
                      style={{
                        position: 'absolute',
                        bottom: 0,
                        left: 0,
                        right: 0,
                        padding: 16,
                      }}
                    >
                      <Text
                        numberOfLines={2}
                        style={{
                          fontFamily: 'Orbitron',
                          fontSize: 12,
                          color: '#fff',
                          fontWeight: 'bold',
                        }}
                      >
                        {banner.title}
                      </Text>
                    </View>
                  </>
                )}
              </View>
            </View>
          </TouchableOpacity>
        )}
      />
    </Animated.View>
  );
}
