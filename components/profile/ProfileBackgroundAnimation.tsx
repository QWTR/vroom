import React from 'react';
import { StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import type { ShopCosmeticItem } from '../../constants/shopCosmetics';
import ProfileAnimationLayer, { getAnimationMeta } from './ProfileAnimationLayer';

export default function ProfileBackgroundAnimation({ item }: { item: ShopCosmeticItem | null | undefined }) {
  if (!item) return null;
  const meta = getAnimationMeta(item);
  const dim = Math.min(Math.max(meta.dimOpacity, 0), 0.32);
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <View style={[StyleSheet.absoluteFill, { backgroundColor: `rgba(0,0,0,${dim})` }]} />
      <LinearGradient
        colors={['rgba(255,52,52,0.20)', 'transparent', 'rgba(16,245,255,0.16)']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <LinearGradient
        colors={['rgba(0,0,0,0.05)', 'transparent', 'rgba(0,0,0,0.36)']}
        style={StyleSheet.absoluteFill}
      />
      <ProfileAnimationLayer
        item={item}
        style={{ zIndex: 1, opacity: 0.98 }}
        contentStyle={{ maxWidth: '160%' as any }}
      />
    </View>
  );
}
