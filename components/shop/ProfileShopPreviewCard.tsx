import React, { memo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import type { UserShopCosmetics } from '../../constants/shopCosmetics';
import { ShopAvatarDecoration } from './ShopAvatarDecoration';
import { normalizeMediaUri } from '../../lib/mediaUri';

type Props = {
  username: string;
  avatarUrl?: string | null;
  cosmetics?: UserShopCosmetics | null;
  compact?: boolean;
};

/** Mini-podgląd profilu ze sklepem — mapa / lista społeczności. */
export const ProfileShopPreviewCard = memo(function ProfileShopPreviewCard({
  username,
  avatarUrl,
  cosmetics,
  compact = false,
}: Props) {
  const bannerUri = normalizeMediaUri(cosmetics?.profileBanner?.assetUrl);
  const avatarSize = compact ? 56 : 72;

  return (
    <View style={[styles.card, compact && { padding: 10 }]}>
      <View style={[styles.banner, compact && { height: 72 }]}>
        {bannerUri ? (
          <Image source={{ uri: bannerUri }} style={StyleSheet.absoluteFill} contentFit="cover" />
        ) : (
          <LinearGradient colors={['#1a1a1a', '#e3383544']} style={StyleSheet.absoluteFill} />
        )}
        <LinearGradient colors={['transparent', 'rgba(0,0,0,0.85)']} style={StyleSheet.absoluteFill} />
      </View>
      <View style={styles.row}>
        <View style={{ width: avatarSize, height: avatarSize }}>
          <View style={[styles.avatar, { width: avatarSize, height: avatarSize, borderRadius: avatarSize / 2 }]}>
            {avatarUrl ? (
              <Image source={{ uri: normalizeMediaUri(avatarUrl)! }} style={{ width: avatarSize - 6, height: avatarSize - 6, borderRadius: (avatarSize - 6) / 2 }} contentFit="cover" />
            ) : (
              <Text style={styles.initials}>{username.slice(0, 2).toUpperCase()}</Text>
            )}
          </View>
          <ShopAvatarDecoration item={cosmetics?.avatarFrame} size={avatarSize} />
        </View>
        <Text style={styles.name} numberOfLines={1}>{username}</Text>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  card: {
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: '#111',
    borderWidth: 1,
    borderColor: '#ffffff18',
  },
  banner: { height: 88, width: '100%' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
    paddingBottom: 12,
    marginTop: -28,
  },
  avatar: {
    borderWidth: 2,
    borderColor: '#e33835',
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0a0a0a',
    margin: 3,
  },
  initials: { color: '#e33835', fontFamily: 'Orbitron', fontWeight: '900', fontSize: 18 },
  name: { flex: 1, color: '#fff', fontFamily: 'Orbitron', fontSize: 14, fontWeight: '800', marginTop: 24 },
});
