import React from 'react';
import { StyleSheet, View } from 'react-native';
import type { ShopCosmeticItem } from '../../constants/shopCosmetics';
import ProfileAnimationLayer, { getAnimationMeta } from './ProfileAnimationLayer';

export default function ProfileBackgroundAnimation({ item }: { item: ShopCosmeticItem | null | undefined }) {
  if (!item) return null;
  const meta = getAnimationMeta(item);
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <View style={[StyleSheet.absoluteFill, { backgroundColor: `rgba(0,0,0,${Math.min(meta.dimOpacity, 0.45)})` }]} />
      <ProfileAnimationLayer
        item={item}
        style={{ zIndex: 1, opacity: 0.95 }}
        contentStyle={{ maxWidth: '100%' as any }}
      />
    </View>
  );
}
