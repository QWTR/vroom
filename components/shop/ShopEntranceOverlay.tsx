import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View, Dimensions } from 'react-native';
import { Image } from 'expo-image';
import type { ShopCosmeticItem } from '../../constants/shopCosmetics';
import { normalizeMediaUri } from '../../lib/mediaUri';
import VisitEntranceFx from '../profile/VisitEntranceFx';

const { width: SW, height: SH } = Dimensions.get('window');

type Props = {
  item: ShopCosmeticItem | null | undefined;
  onDone: () => void;
};

/**
 * Efekt wejścia na profil / podgląd użytkownika — asset z sklepu (GIF) lub fallback preset.
 */
export default function ShopEntranceOverlay({ item, onDone }: Props) {
  const fade = useRef(new Animated.Value(1)).current;
  const uri = normalizeMediaUri(item?.assetUrl);

  useEffect(() => {
    if (!uri) return;
    const t = setTimeout(() => {
      Animated.timing(fade, { toValue: 0, duration: 900, useNativeDriver: true }).start(() => onDone());
    }, item?.assetKind === 'gif' ? 2200 : 1600);
    return () => clearTimeout(t);
  }, [uri, item?.assetKind, fade, onDone]);

  if (!item) return null;

  if (item.assetKind === 'preset' && item.id.startsWith('fx_')) {
    const kind = item.id.replace(/^fx_/, '');
    return <VisitEntranceFx kind={kind} onDone={onDone} />;
  }

  if (!uri) return null;

  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFillObject, { zIndex: 600, opacity: fade }]}>
      <View style={styles.backdrop} />
      <Image
        source={{ uri }}
        style={{ width: SW, height: SH * 0.55, alignSelf: 'center', marginTop: SH * 0.18 }}
        contentFit="contain"
        cachePolicy="memory-disk"
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
});
