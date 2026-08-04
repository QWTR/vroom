import React, { useEffect } from 'react';
import {
  Animated,
  Dimensions,
  FlatList,
  Linking,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { usePartnerBanners } from '../../hooks/usePartnerBanners';
import { withAlpha } from '../../constants/theme';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CARD_WIDTH = Math.min(SCREEN_WIDTH - 64, 304);
const SNAP_INTERVAL = CARD_WIDTH + 12;
const BANNER_HEIGHT = 156;

interface Props {
  theme: any;
  isDark: boolean;
  fadeAnim: Animated.Value;
}

export function PartnerBannersSection({ theme, isDark, fadeAnim }: Props) {
  const { banners, fetchBanners } = usePartnerBanners();

  useEffect(() => {
    fetchBanners();
  }, [fetchBanners]);

  if (banners.length === 0) return null;

  return (
    <Animated.View style={[styles.section, { opacity: fadeAnim }]}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.eyebrow, { color: theme.primary }]}>PARTNERZY VROOM</Text>
          <Text style={[styles.subtitle, { color: theme.textDim }]}>Marki i miejsca warte sprawdzenia</Text>
        </View>
        <View style={[styles.verified, { backgroundColor: withAlpha(theme.gold, '16'), borderColor: withAlpha(theme.gold, '44') }]}>
          <MaterialIcons name="verified" size={13} color={theme.gold} />
          <Text style={[styles.verifiedText, { color: theme.gold }]}>ZWERYFIKOWANI</Text>
        </View>
      </View>

      <FlatList
        data={banners}
        keyExtractor={(item) => String(item.id)}
        horizontal
        showsHorizontalScrollIndicator={false}
        snapToInterval={SNAP_INTERVAL}
        decelerationRate="fast"
        snapToAlignment="start"
        disableIntervalMomentum
        contentContainerStyle={styles.list}
        renderItem={({ item: banner }) => (
          <TouchableOpacity
            onPress={() => banner.linkUrl && Linking.openURL(banner.linkUrl)}
            activeOpacity={banner.linkUrl ? 0.88 : 1}
            accessibilityRole={banner.linkUrl ? 'link' : undefined}
            accessibilityLabel={banner.title ? `Partner VROOM: ${banner.title}` : 'Partner VROOM'}
            style={[
              styles.card,
              {
                backgroundColor: theme.surface,
                borderColor: isDark ? theme.primaryBorder : theme.border2,
              },
            ]}
          >
            <Image source={{ uri: banner.imageUrl }} style={StyleSheet.absoluteFillObject} contentFit="cover" transition={180} />
            <LinearGradient
              colors={['rgba(0,0,0,0.02)', 'rgba(0,0,0,0.18)', 'rgba(0,0,0,0.92)']}
              style={StyleSheet.absoluteFillObject}
            />
            <View style={styles.partnerPill}>
              <MaterialIcons name="verified" size={12} color={theme.gold} />
              <Text style={styles.partnerPillText}>PARTNER VROOM</Text>
            </View>
            {!!banner.title && (
              <View style={styles.copy}>
                <Text numberOfLines={2} style={styles.title}>{banner.title}</Text>
                {!!banner.linkUrl && (
                  <View style={styles.visitRow}>
                    <Text style={styles.visitText}>ZOBACZ WIĘCEJ</Text>
                    <MaterialIcons name="arrow-forward" size={14} color="#fff" />
                  </View>
                )}
              </View>
            )}
          </TouchableOpacity>
        )}
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  section: { marginBottom: 24 },
  header: { paddingHorizontal: 20, marginBottom: 12, flexDirection: 'row', alignItems: 'flex-end', gap: 10 },
  eyebrow: { fontFamily: 'Orbitron', fontSize: 10, fontWeight: '900', letterSpacing: 2 },
  subtitle: { fontSize: 10, marginTop: 4 },
  verified: { minHeight: 28, borderRadius: 14, borderWidth: 1, paddingHorizontal: 9, flexDirection: 'row', alignItems: 'center', gap: 4 },
  verifiedText: { fontFamily: 'Orbitron', fontSize: 5.5, fontWeight: '900', letterSpacing: 0.4 },
  list: { paddingHorizontal: 20, gap: 12 },
  card: { width: CARD_WIDTH, height: BANNER_HEIGHT, borderRadius: 23, overflow: 'hidden', borderWidth: 1 },
  partnerPill: { position: 'absolute', left: 12, top: 12, minHeight: 26, borderRadius: 13, paddingHorizontal: 9, flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'rgba(0,0,0,0.72)' },
  partnerPillText: { color: '#fff', fontFamily: 'Orbitron', fontSize: 6, fontWeight: '900', letterSpacing: 0.7 },
  copy: { position: 'absolute', left: 15, right: 15, bottom: 13 },
  title: { color: '#fff', fontSize: 15, lineHeight: 19, fontWeight: '900' },
  visitRow: { marginTop: 5, flexDirection: 'row', alignItems: 'center', gap: 4 },
  visitText: { color: 'rgba(255,255,255,0.78)', fontFamily: 'Orbitron', fontSize: 6, fontWeight: '900', letterSpacing: 0.7 },
});
