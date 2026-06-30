import React, { useMemo } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons, MaterialIcons } from '@expo/vector-icons';
import type { GeoDropNearby } from '../../lib/gamificationClient';
import { useTheme } from '../../contexts/ThemeContext';

const RARITY_META: Record<string, { label: string; color: string; bg: string }> = {
  common: { label: 'COMMON', color: '#f3f4f6', bg: 'rgba(243,244,246,0.12)' },
  rare: { label: 'RARE', color: '#38bdf8', bg: 'rgba(56,189,248,0.14)' },
  epic: { label: 'EPIC', color: '#c084fc', bg: 'rgba(192,132,252,0.16)' },
  legendary: { label: 'LEGENDARY', color: '#facc15', bg: 'rgba(250,204,21,0.16)' },
};

function formatDistance(meters: number) {
  if (!Number.isFinite(meters)) return '--';
  if (meters >= 1000) return `${(meters / 1000).toFixed(1)} km`;
  return `${Math.max(0, Math.round(meters))} m`;
}

function formatExpires(expiresAt: string) {
  const diffMs = new Date(expiresAt).getTime() - Date.now();
  if (!Number.isFinite(diffMs) || diffMs <= 0) return 'wygasa teraz';
  const minutes = Math.max(1, Math.round(diffMs / 60000));
  if (minutes >= 60) return `${Math.floor(minutes / 60)}h ${minutes % 60}min`;
  return `${minutes} min`;
}

type Props = {
  drop: GeoDropNearby;
  bottomInset?: number;
  onNavigate: () => void;
  onLater: () => void;
  onHide: () => void;
};

export function GeoDropAvailableSheet({ drop, bottomInset = 64, onNavigate, onLater, onHide }: Props) {
  const { theme } = useTheme();
  const rarity = RARITY_META[drop.rarity] ?? RARITY_META.common;
  const expiresLabel = useMemo(() => formatExpires(drop.expiresAt), [drop.expiresAt]);

  return (
    <View pointerEvents="box-none" style={[styles.wrap, { bottom: bottomInset + 8 }]}>
      <LinearGradient
        colors={['rgba(8,8,10,0.96)', 'rgba(23,10,11,0.98)'] as const}
        style={[styles.sheet, { borderColor: (theme as any).primaryBorder || 'rgba(227,56,53,0.42)' }]}
      >
        <View style={styles.headerRow}>
          <View style={[styles.icon, { borderColor: rarity.color, backgroundColor: rarity.bg }]}>
            <MaterialCommunityIcons name="package-variant-closed" size={22} color={rarity.color} />
          </View>

          <View style={styles.infoCol}>
            <View style={styles.titleRow}>
              <Text style={[styles.eyebrow, { color: theme.primary }]}>ZRZUT</Text>
              <View style={[styles.rarityPill, { borderColor: rarity.color, backgroundColor: rarity.bg }]}>
                <Text style={[styles.rarityText, { color: rarity.color }]}>{rarity.label}</Text>
              </View>
            </View>
            <View style={styles.metaRow}>
              <MaterialIcons name="near-me" size={13} color={theme.primary} />
              <Text style={styles.metaText}>{formatDistance(drop.distanceM)}</Text>
              <Text style={styles.metaDot}>·</Text>
              <MaterialIcons name="timer" size={13} color={theme.primary} />
              <Text style={styles.metaText}>{expiresLabel}</Text>
            </View>
          </View>

          <TouchableOpacity style={styles.dismissBtn} onPress={onHide} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <MaterialIcons name="close" size={18} color="rgba(255,255,255,0.55)" />
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          style={[styles.navBtn, { backgroundColor: theme.primary }]}
          onPress={onNavigate}
          activeOpacity={0.88}
        >
          <MaterialIcons name="navigation" size={17} color={theme.onPrimary || '#fff'} />
          <Text style={[styles.navText, { color: theme.onPrimary || '#fff' }]}>NAWIGUJ</Text>
        </TouchableOpacity>

        <View style={styles.linksRow}>
          <TouchableOpacity onPress={onLater} activeOpacity={0.86}>
            <Text style={styles.linkText}>Później</Text>
          </TouchableOpacity>
          <Text style={styles.linkDot}>·</Text>
          <TouchableOpacity onPress={onHide} activeOpacity={0.86}>
            <Text style={styles.linkTextMuted}>Ukryj ten zrzut</Text>
          </TouchableOpacity>
        </View>
      </LinearGradient>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 12,
    right: 88,
    zIndex: 40,
  },
  sheet: {
    borderWidth: 1,
    borderRadius: 18,
    paddingHorizontal: 12,
    paddingTop: 11,
    paddingBottom: 10,
    shadowColor: '#000',
    shadowOpacity: 0.32,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 12,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  icon: {
    width: 40,
    height: 40,
    borderRadius: 13,
    borderWidth: 1.2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  infoCol: {
    flex: 1,
    minWidth: 0,
    paddingTop: 2,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
  },
  eyebrow: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1.6,
  },
  rarityPill: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  rarityText: {
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.8,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 5,
  },
  metaText: {
    color: 'rgba(255,255,255,0.82)',
    fontSize: 11,
    fontWeight: '700',
  },
  metaDot: {
    color: 'rgba(255,255,255,0.35)',
    fontSize: 11,
  },
  dismissBtn: {
    width: 26,
    height: 26,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  navBtn: {
    marginTop: 11,
    height: 42,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  navText: {
    fontWeight: '900',
    fontSize: 12,
    letterSpacing: 1,
  },
  linksRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 8,
  },
  linkText: {
    color: 'rgba(255,255,255,0.72)',
    fontSize: 10,
    fontWeight: '700',
  },
  linkTextMuted: {
    color: 'rgba(255,255,255,0.45)',
    fontSize: 10,
    fontWeight: '700',
  },
  linkDot: {
    color: 'rgba(255,255,255,0.25)',
    fontSize: 10,
  },
});
