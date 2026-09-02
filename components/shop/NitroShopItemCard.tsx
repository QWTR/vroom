import React, { memo } from 'react';
import { View, TouchableOpacity, StyleSheet } from 'react-native';
import { AppText as Text } from '../ui/AppText';
import { Image } from 'expo-image';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import type { CatalogItem } from '../../hooks/useProfileShop';
import {
  SHOP_CATEGORY_META,
  type ShopItemCategory,
} from '../../constants/shopCosmetics';
import { ShopAvatarDecoration } from './ShopAvatarDecoration';
import { normalizeMediaUri } from '../../lib/mediaUri';
import { useTheme } from '../../contexts/ThemeContext';

type Props = {
  item: CatalogItem;
  width: number;
  equipped: boolean;
  isDark: boolean;
  onPress: () => void;
};

export const NitroShopItemCard = memo(function NitroShopItemCard({
  item,
  width,
  equipped,
  isDark,
  onPress,
}: Props) {
  const { theme } = useTheme();
  const preview = normalizeMediaUri(item.previewUrl ?? item.assetUrl);
  const meta = SHOP_CATEGORY_META[item.category as ShopItemCategory];
  const accent = meta?.accent ?? '#e33835';

  return (
    <TouchableOpacity
      activeOpacity={0.86}
      onPress={onPress}
      style={[
        styles.card,
        {
          width,
          backgroundColor: isDark ? theme.surface2 : theme.surface,
          borderColor: equipped ? accent : theme.border2,
          shadowColor: equipped ? accent : '#000',
        },
      ]}
    >
      {item.isFeatured ? (
        <View style={styles.featuredBadge}>
          <MaterialIcons name="star" size={9} color="#fff" />
          <Text style={styles.featuredText}>POLECANE</Text>
        </View>
      ) : null}
      {item.tagLine ? (
        <View style={[styles.tagBadge, { backgroundColor: accent }]}>
          <Text style={styles.tagText}>{item.tagLine}</Text>
        </View>
      ) : null}
      {item.maxSupply && !item.owned ? (
        <View style={[styles.tagBadge, { backgroundColor: '#e33835', right: 8, top: (item.isFeatured || item.tagLine) ? 28 : 8 }]}>
          <Text style={styles.tagText}>LIMIT {item.maxSupply}</Text>
        </View>
      ) : null}
      {item.category === 'limited_vehicle_slot' && !item.tagLine ? (
        <View style={[styles.tagBadge, { backgroundColor: '#FFD700' }]}>
          <Text style={[styles.tagText, { color: '#111' }]}>CUSTOM</Text>
        </View>
      ) : null}

      <View style={[styles.preview, { backgroundColor: isDark ? theme.bg : theme.surface2 }]}>
        {item.category === 'avatar_frame' ? (
          <View style={styles.framePreview}>
            <View style={[styles.fakeAvatar, { backgroundColor: isDark ? theme.surface4 : theme.surface3 }]} />
            <ShopAvatarDecoration item={item} size={72} />
          </View>
        ) : item.category === 'map_vehicle_3d' || item.category === 'limited_vehicle_slot' ? (
          preview ? (
            <Image source={{ uri: preview }} style={styles.previewImg} contentFit="cover" />
          ) : (
            <MaterialIcons name="directions-car" size={36} color={`${accent}88`} />
          )
        ) : preview ? (
          <Image source={{ uri: preview }} style={styles.previewImg} contentFit="cover" />
        ) : (
          <MaterialIcons name={meta?.icon ?? 'image'} size={32} color={`${accent}88`} />
        )}
      </View>

      <View style={styles.body}>
        <Text
          style={[styles.name, { color: theme.text }]}
          numberOfLines={2}
        >
          {item.name}
        </Text>
        <View style={styles.footer}>
          {item.owned ? (
            <View style={[styles.statusPill, equipped ? styles.equippedPill : styles.ownedPill]}>
              <MaterialIcons
                name={equipped ? 'check-circle' : 'inventory-2'}
                size={11}
                color={equipped ? '#4ade80' : '#94a3b8'}
              />
              <Text style={[styles.statusText, equipped && styles.equippedText]}>
                {equipped ? 'ZAŁOŻONE' : 'POSIADASZ'}
              </Text>
            </View>
          ) : (
            <View style={styles.pricePill}>
              <MaterialIcons name="bolt" size={13} color="#FFD700" />
              <Text style={styles.price}>{item.nitroCost}</Text>
              <Text style={styles.priceUnit}>Nitro</Text>
            </View>
          )}
        </View>
      </View>
    </TouchableOpacity>
  );
});

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    borderWidth: 1.5,
    overflow: 'hidden',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 10,
    elevation: 4,
  },
  featuredBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    zIndex: 3,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: '#e33835',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 8,
  },
  featuredText: { color: '#fff', fontSize: 12, fontWeight: '900', letterSpacing: 0.5 },
  tagBadge: {
    position: 'absolute',
    top: 8,
    left: 8,
    zIndex: 3,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 8,
  },
  tagText: { color: '#fff', fontSize: 12, fontWeight: '800' },
  preview: {
    height: 128,
    alignItems: 'center',
    justifyContent: 'center',
  },
  framePreview: {
    width: 72,
    height: 72,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fakeAvatar: { width: 48, height: 48, borderRadius: 24 },
  previewImg: { width: '100%', height: '100%' },
  body: { paddingHorizontal: 10, paddingTop: 10, paddingBottom: 12, gap: 8 },
  name: { fontSize: 12, fontWeight: '800', lineHeight: 16, minHeight: 32 },
  footer: { flexDirection: 'row', alignItems: 'center' },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: '#ffffff08',
  },
  ownedPill: { backgroundColor: '#64748b18' },
  equippedPill: { backgroundColor: '#4ade8018' },
  statusText: { fontSize: 12, fontWeight: '800', color: '#94a3b8', letterSpacing: 0.3 },
  equippedText: { color: '#4ade80' },
  pricePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#FFD70018',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#FFD70033',
  },
  price: { color: '#FFD700', fontWeight: '900', fontSize: 14 },
  priceUnit: { color: '#FFD70099', fontSize: 12, fontWeight: '700' },
});
