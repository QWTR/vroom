import React, { memo } from 'react';
import { View, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import type { ShopCosmeticItem } from '../../constants/shopCosmetics';
import { normalizeMediaUri } from '../../lib/mediaUri';
import { centeredAvatarDecorationMetrics } from '../../lib/avatarDecorationUi';

type Props = {
  item: ShopCosmeticItem | null | undefined;
  size?: number;
};

/** Animowana obramówka avatara (GIF/PNG) — nakładka jak na Discordzie. */
export const ShopAvatarDecoration = memo(function ShopAvatarDecoration({ item, size = 80 }: Props) {
  const uri = normalizeMediaUri(item?.assetUrl);
  if (!uri) return null;

  const { outer, margin } = centeredAvatarDecorationMetrics(size);
  return (
    <View pointerEvents="none" style={[styles.wrap, {
      width: outer,
      height: outer,
      left: '50%',
      top: '50%',
      marginLeft: margin,
      marginTop: margin,
    }]}>
      <Image
        source={{ uri }}
        style={{ width: outer, height: outer }}
        contentFit="contain"
        cachePolicy="memory-disk"
        transition={0}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    overflow: 'visible',
    zIndex: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
