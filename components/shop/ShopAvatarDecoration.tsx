import React, { memo } from 'react';
import { View, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import type { ShopCosmeticItem } from '../../constants/shopCosmetics';
import { normalizeMediaUri } from '../../lib/mediaUri';

type Props = {
  item: ShopCosmeticItem | null | undefined;
  size?: number;
};

/** Animowana obramówka avatara (GIF/PNG) — nakładka jak na Discordzie. */
export const ShopAvatarDecoration = memo(function ShopAvatarDecoration({ item, size = 80 }: Props) {
  const uri = normalizeMediaUri(item?.assetUrl);
  if (!uri) return null;

  const outer = size * 1.28;
  const offset = (size - outer) / 2;
  return (
    <View pointerEvents="none" style={[styles.wrap, { width: outer, height: outer, left: offset, top: offset }]}>
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
    zIndex: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
