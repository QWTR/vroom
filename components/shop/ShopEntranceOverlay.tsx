import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import type { ShopCosmeticItem } from '../../constants/shopCosmetics';
import VisitEntranceFx from '../profile/VisitEntranceFx';
import ProfileAnimationLayer, { getAnimationMeta } from '../profile/ProfileAnimationLayer';

type Props = {
  item: ShopCosmeticItem | null | undefined;
  onDone: () => void;
};

/**
 * Efekt wejścia na profil / podgląd użytkownika — asset z sklepu (GIF) lub fallback preset.
 */
export default function ShopEntranceOverlay({ item, onDone }: Props) {
  const fade = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!item?.assetUrl) return;
    const meta = getAnimationMeta(item);
    const t = setTimeout(() => {
      Animated.timing(fade, { toValue: 0, duration: 900, useNativeDriver: true }).start(() => onDone());
    }, meta.durationMs);
    return () => clearTimeout(t);
  }, [item, fade, onDone]);

  if (!item) return null;

  if (item.assetKind === 'preset' && item.id.startsWith('fx_')) {
    const kind = item.id.replace(/^fx_/, '');
    return <VisitEntranceFx kind={kind} onDone={onDone} />;
  }

  const meta = getAnimationMeta(item);
  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFillObject, { zIndex: 600, opacity: fade }]}>
      <View style={[styles.backdrop, { backgroundColor: `rgba(0,0,0,${meta.dimOpacity})` }]} />
      <ProfileAnimationLayer item={item} style={{ zIndex: 2 }} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
});
