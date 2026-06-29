import React, { memo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import type { UserShopCosmetics } from '../../constants/shopCosmetics';
import { ShopAvatarDecoration } from './ShopAvatarDecoration';
import { normalizeMediaUri } from '../../lib/mediaUri';
import { useTheme } from '../../contexts/ThemeContext';
import { useMemo } from 'react';

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
  const { theme, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const bannerUri = normalizeMediaUri(cosmetics?.profileBanner?.assetUrl);
  const avatarSize = compact ? 56 : 72;

  return (
    <View style={[styles.card, compact && { padding: 10 }]}>
      <View style={[styles.banner, compact && { height: 72 }]}>
        {bannerUri ? (
          <Image source={{ uri: bannerUri }} style={StyleSheet.absoluteFill} contentFit="cover" />
        ) : (
          <LinearGradient colors={isDark ? ['#1a1a1a', theme.primary + '44'] : [theme.surface2, theme.primaryBg]} style={StyleSheet.absoluteFill} />
        )}
        <LinearGradient colors={['transparent', 'rgba(0,0,0,0.85)']} style={StyleSheet.absoluteFill} />
      </View>
      <View style={styles.row}>
        <View style={{ width: avatarSize, height: avatarSize, alignItems: 'center', justifyContent: 'center' }}>
          <View style={[styles.avatar, { width: avatarSize - 6, height: avatarSize - 6, borderRadius: (avatarSize - 6) / 2 }]}>
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

const makeStyles = (t: typeof import('../../constants/theme').darkTheme) => StyleSheet.create({
  card: {
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: t.surface,
    borderWidth: 1,
    borderColor: t.border2,
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
    borderColor: t.primary,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: t.bg,
  },
  initials: { color: t.primary, fontFamily: 'Orbitron', fontWeight: '900', fontSize: 18 },
  name: { flex: 1, color: t.text, fontFamily: 'Orbitron', fontSize: 14, fontWeight: '800', marginTop: 24 },
});
