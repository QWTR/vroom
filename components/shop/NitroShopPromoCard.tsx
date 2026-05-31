import React, { memo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useTheme } from '../../contexts/ThemeContext';
import { MONETIZATION } from '../../constants/monetization';

type Props = {
  nitroBalance?: number;
  onPress: () => void;
  compact?: boolean;
};

/** Widoczna karta wejścia do sklepu — profil / ustawienia. */
export const NitroShopPromoCard = memo(function NitroShopPromoCard({
  nitroBalance = 0,
  onPress,
  compact = false,
}: Props) {
  const { theme, isDark } = useTheme();

  return (
    <TouchableOpacity activeOpacity={0.88} onPress={onPress} style={styles.wrap}>
      <LinearGradient
        colors={isDark ? ['#2a1f00', '#141008', '#0c0c0c'] : ['#fff8e6', '#fff3cc', '#ffffff']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.card, compact && styles.cardCompact]}
      >
        <View style={styles.glowOrb} />
        <View style={styles.row}>
          <View style={styles.iconBox}>
            <MaterialIcons name="bolt" size={compact ? 22 : 26} color="#FFD700" />
          </View>
          <View style={styles.copy}>
            <Text style={[styles.kicker, { color: isDark ? '#FFD70099' : '#b8860b' }]}>
              SKLEP NITRO
            </Text>
            <Text style={[styles.title, { color: theme.text }]}>
              Ozdoby {MONETIZATION.nitroLabel}
            </Text>
            {!compact && (
              <Text style={[styles.sub, { color: theme.textDim }]}>
                {MONETIZATION.shopSubtitle}
              </Text>
            )}
          </View>
          <View style={styles.right}>
            <View style={styles.balanceChip}>
              <MaterialIcons name="bolt" size={13} color="#FFD700" />
              <Text style={styles.balanceNum}>{nitroBalance}</Text>
            </View>
            <MaterialIcons
              name="chevron-right"
              size={22}
              color={isDark ? '#ffffff55' : '#00000044'}
            />
          </View>
        </View>
      </LinearGradient>
    </TouchableOpacity>
  );
});

const styles = StyleSheet.create({
  wrap: { marginBottom: 16 },
  card: {
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: '#FFD70035',
    overflow: 'hidden',
  },
  cardCompact: { padding: 12 },
  glowOrb: {
    position: 'absolute',
    top: -30,
    right: -20,
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: '#FFD70018',
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  iconBox: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: '#FFD70022',
    borderWidth: 1,
    borderColor: '#FFD70044',
    alignItems: 'center',
    justifyContent: 'center',
  },
  copy: { flex: 1 },
  kicker: {
    fontFamily: 'Orbitron',
    fontSize: 7,
    letterSpacing: 2.5,
    fontWeight: '800',
    marginBottom: 3,
  },
  title: {
    fontFamily: 'Orbitron',
    fontSize: 14,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  sub: { fontSize: 11, marginTop: 4, lineHeight: 15 },
  right: { alignItems: 'flex-end', gap: 6 },
  balanceChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#FFD70020',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#FFD70044',
  },
  balanceNum: { color: '#FFD700', fontWeight: '900', fontSize: 13 },
});
