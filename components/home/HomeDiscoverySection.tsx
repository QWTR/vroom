import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  InteractionManager,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { API_URL } from '../../constants/config';
import { useTheme } from '../../contexts/ThemeContext';
import { getThemeChrome, withAlpha } from '../../constants/theme';

type Highlight = {
  id: number;
  caption: string;
  thumbnailUrl: string | null;
  viewsCount: number;
  author: { username: string };
};

let memoryHighlights: Highlight[] = [];
let memoryLoadedAt = 0;
const CACHE_TTL_MS = 60_000;

function compactCount(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1).replace(/\.0$/, '')}k`;
  return String(Math.max(0, value));
}

export function HomeDiscoverySection({ active }: { active: boolean }) {
  const router = useRouter();
  const { theme, isDark } = useTheme();
  const chrome = getThemeChrome(theme, isDark);
  const [items, setItems] = useState<Highlight[]>(memoryHighlights);
  const [loading, setLoading] = useState(memoryHighlights.length === 0);

  const load = useCallback(async (signal?: AbortSignal) => {
    if (memoryHighlights.length && Date.now() - memoryLoadedAt < CACHE_TTL_MS) {
      setItems(memoryHighlights);
      setLoading(false);
      return;
    }
    try {
      const token = (await AsyncStorage.getItem('userToken'))
        ?? (await AsyncStorage.getItem('token'));
      if (!token) return;
      const response = await fetch(`${API_URL}/api/vroomki/highlights?limit=5`, {
        headers: { Authorization: `Bearer ${token}` },
        signal,
      });
      if (!response.ok) return;
      const payload = await response.json();
      const next = Array.isArray(payload?.items) ? payload.items : [];
      memoryHighlights = next;
      memoryLoadedAt = Date.now();
      setItems(next);
    } catch (error) {
      if ((error as Error)?.name !== 'AbortError') {
        // Podgląd nie blokuje Home — przy błędzie zostają skróty.
      }
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    const task = InteractionManager.runAfterInteractions(() => {
      void load(controller.signal);
    });
    return () => {
      task.cancel();
      controller.abort();
    };
  }, [active, load]);

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <View>
          <Text style={[styles.eyebrow, { color: theme.primary }]}>RUSZAJ</Text>
          <Text style={[styles.sectionTitle, { color: theme.text }]}>CO ROBIMY DZISIAJ?</Text>
        </View>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Zgłoś problem"
          activeOpacity={0.78}
          onPress={() => router.push({ pathname: '/profile/settings', params: { openBug: '1' } })}
          style={[styles.reportButton, { backgroundColor: chrome.glassCard, borderColor: chrome.glassBorder }]}
        >
          <MaterialIcons name="bug-report" size={15} color={theme.primary} />
          <Text style={[styles.reportText, { color: theme.textMuted }]}>ZGŁOŚ PROBLEM</Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel="Otwórz mapę VROOM"
        activeOpacity={0.9}
        onPress={() => router.push('/map')}
        style={[styles.mapCard, { borderColor: theme.primaryBorder }]}
      >
        <LinearGradient
          colors={isDark
            ? [withAlpha(theme.primary, '34'), '#190b0b', theme.surface]
            : [withAlpha(theme.primary, '24'), theme.surface2, theme.surface]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFillObject}
        />
        <View style={[styles.mapOrb, { borderColor: withAlpha(theme.primary, '38') }]} />
        <View style={[styles.mapRouteLine, { backgroundColor: withAlpha(theme.primary, '80') }]} />
        <View style={styles.mapPinOne}>
          <View style={[styles.pinDot, { backgroundColor: theme.primary }]} />
        </View>
        <View style={styles.mapPinTwo}>
          <View style={[styles.pinDot, { backgroundColor: theme.text }]} />
        </View>

        <View style={styles.mapCopy}>
          <View style={[styles.mapIcon, { backgroundColor: withAlpha(theme.primary, '24'), borderColor: theme.primaryBorder }]}>
            <MaterialCommunityIcons name="map-marker-path" size={26} color={theme.primary} />
          </View>
          <Text style={[styles.mapKicker, { color: theme.primary }]}>MAPA VROOM</Text>
          <Text style={[styles.mapTitle, { color: theme.text }]}>Droga zaczyna się tutaj.</Text>
          <Text style={[styles.mapSubtitle, { color: theme.textMuted }]}>Nawigacja, trasy, spoty i kierowcy w pobliżu.</Text>
        </View>
        <View style={[styles.mapCta, { backgroundColor: theme.primary }]}>
          <Text style={styles.mapCtaText}>OTWÓRZ MAPĘ</Text>
          <MaterialIcons name="arrow-forward" size={15} color="#fff" />
        </View>
      </TouchableOpacity>

      <View style={styles.vroomkiHeader}>
        <View style={{ flex: 1 }}>
          <View style={styles.vroomkiTitleRow}>
            <View style={[styles.liveDot, { backgroundColor: theme.primary }]} />
            <Text style={[styles.vroomkiTitle, { color: theme.text }]}>VROOMKI TERAZ</Text>
          </View>
          <Text style={[styles.vroomkiSubtitle, { color: theme.textDim }]}>Najświeższe filmy społeczności</Text>
        </View>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Zobacz wszystkie VROOMKI"
          onPress={() => router.push('/Community/vroomki' as any)}
          style={styles.allButton}
        >
          <Text style={[styles.allButtonText, { color: theme.primary }]}>WSZYSTKIE</Text>
          <MaterialIcons name="arrow-forward" size={15} color={theme.primary} />
        </TouchableOpacity>
      </View>

      {loading && items.length === 0 ? (
        <View style={[styles.loadingBox, { backgroundColor: chrome.glassCard, borderColor: chrome.glassBorder }]}>
          <ActivityIndicator color={theme.primary} />
        </View>
      ) : items.length > 0 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.reelsRow}>
          {items.map((item, index) => (
            <TouchableOpacity
              key={item.id}
              activeOpacity={0.9}
              accessibilityRole="button"
              accessibilityLabel={`Otwórz VROOMKĘ użytkownika ${item.author.username}`}
              onPress={() => router.push({
                pathname: '/Community/vroomki',
                params: { vroomkiId: String(item.id) },
              } as any)}
              style={[
                styles.reelCard,
                index === 0 && styles.featuredReel,
                { borderColor: chrome.glassBorder, backgroundColor: theme.surface },
              ]}
            >
              {item.thumbnailUrl ? (
                <Image source={{ uri: item.thumbnailUrl }} style={StyleSheet.absoluteFillObject} resizeMode="cover" />
              ) : (
                <View style={[StyleSheet.absoluteFillObject, styles.reelFallback, { backgroundColor: theme.surface2 }]}>
                  <MaterialIcons name="videocam" size={32} color={theme.textFaint} />
                </View>
              )}
              <LinearGradient
                colors={['rgba(0,0,0,0.04)', 'rgba(0,0,0,0.1)', 'rgba(0,0,0,0.94)']}
                style={StyleSheet.absoluteFillObject}
              />
              {index === 0 && (
                <View style={[styles.featuredPill, { backgroundColor: theme.primary }]}>
                  <Text style={styles.featuredPillText}>WYBRANE</Text>
                </View>
              )}
              <View style={styles.playBadge}>
                <MaterialIcons name="play-arrow" size={18} color="#fff" />
              </View>
              <View style={styles.reelMeta}>
                <Text numberOfLines={1} style={styles.reelAuthor}>@{item.author.username}</Text>
                {!!item.caption && <Text numberOfLines={index === 0 ? 2 : 1} style={styles.reelCaption}>{item.caption}</Text>}
                <View style={styles.viewsRow}>
                  <MaterialIcons name="visibility" size={12} color="#fff" />
                  <Text style={styles.viewsText}>{compactCount(item.viewsCount)}</Text>
                </View>
              </View>
            </TouchableOpacity>
          ))}
        </ScrollView>
      ) : (
        <TouchableOpacity
          activeOpacity={0.84}
          onPress={() => router.push('/Community/vroomki' as any)}
          style={[styles.emptyBox, { backgroundColor: chrome.glassCard, borderColor: chrome.glassBorder }]}
        >
          <MaterialIcons name="smart-display" size={28} color={theme.primary} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.emptyTitle, { color: theme.text }]}>VROOMKI</Text>
            <Text style={[styles.emptySubtitle, { color: theme.textDim }]}>Zobacz, czym żyje społeczność</Text>
          </View>
          <MaterialIcons name="arrow-forward" size={18} color={theme.primary} />
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { paddingHorizontal: 20, marginBottom: 22 },
  sectionHeader: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12, marginBottom: 13 },
  eyebrow: { fontFamily: 'Orbitron', fontSize: 8, fontWeight: '800', letterSpacing: 3.2, marginBottom: 5 },
  sectionTitle: { fontFamily: 'Orbitron', fontSize: 15, fontWeight: '900', letterSpacing: 1 },
  reportButton: { minHeight: 34, borderRadius: 17, borderWidth: 1, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 5 },
  reportText: { fontFamily: 'Orbitron', fontSize: 6.5, fontWeight: '800', letterSpacing: 0.4 },
  mapCard: { height: 196, borderRadius: 27, borderWidth: 1, overflow: 'hidden', padding: 19 },
  mapOrb: { position: 'absolute', width: 210, height: 210, borderRadius: 105, borderWidth: 1, right: -46, top: -68 },
  mapRouteLine: { position: 'absolute', width: 160, height: 2, right: 8, top: 87, transform: [{ rotate: '-28deg' }] },
  mapPinOne: { position: 'absolute', right: 38, top: 39 },
  mapPinTwo: { position: 'absolute', right: 137, top: 106 },
  pinDot: { width: 8, height: 8, borderRadius: 4, borderWidth: 2, borderColor: 'rgba(0,0,0,0.4)' },
  mapCopy: { maxWidth: '72%' },
  mapIcon: { width: 46, height: 46, borderRadius: 15, borderWidth: 1, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  mapKicker: { fontFamily: 'Orbitron', fontSize: 8, fontWeight: '900', letterSpacing: 2 },
  mapTitle: { fontSize: 19, fontWeight: '900', marginTop: 5, letterSpacing: -0.3 },
  mapSubtitle: { fontSize: 10, lineHeight: 15, marginTop: 5 },
  mapCta: { position: 'absolute', right: 16, bottom: 16, minHeight: 36, borderRadius: 18, paddingHorizontal: 13, flexDirection: 'row', alignItems: 'center', gap: 6 },
  mapCtaText: { color: '#fff', fontFamily: 'Orbitron', fontSize: 7, fontWeight: '900', letterSpacing: 0.5 },
  vroomkiHeader: { marginTop: 22, marginBottom: 11, flexDirection: 'row', alignItems: 'flex-end', gap: 10 },
  vroomkiTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  liveDot: { width: 7, height: 7, borderRadius: 4 },
  vroomkiTitle: { fontFamily: 'Orbitron', fontSize: 12, fontWeight: '900', letterSpacing: 1 },
  vroomkiSubtitle: { fontSize: 10, marginTop: 4 },
  allButton: { minHeight: 34, flexDirection: 'row', alignItems: 'center', gap: 4 },
  allButtonText: { fontFamily: 'Orbitron', fontSize: 7, fontWeight: '900', letterSpacing: 0.7 },
  reelsRow: { gap: 10, paddingRight: 4 },
  reelCard: { width: 126, height: 174, borderRadius: 20, borderWidth: 1, overflow: 'hidden' },
  featuredReel: { width: 208 },
  reelFallback: { alignItems: 'center', justifyContent: 'center' },
  playBadge: { position: 'absolute', top: 10, right: 10, width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(227,56,53,0.94)', alignItems: 'center', justifyContent: 'center' },
  featuredPill: { position: 'absolute', top: 12, left: 12, minHeight: 21, borderRadius: 11, paddingHorizontal: 8, alignItems: 'center', justifyContent: 'center' },
  featuredPillText: { color: '#fff', fontFamily: 'Orbitron', fontSize: 6, fontWeight: '900', letterSpacing: 0.8 },
  reelMeta: { position: 'absolute', left: 11, right: 11, bottom: 11 },
  reelAuthor: { color: '#fff', fontSize: 11, fontWeight: '900' },
  reelCaption: { color: 'rgba(255,255,255,0.82)', fontSize: 9, lineHeight: 12, marginTop: 3 },
  viewsRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 7 },
  viewsText: { color: '#fff', fontSize: 9, fontWeight: '800' },
  loadingBox: { height: 92, borderRadius: 21, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  emptyBox: { height: 76, borderRadius: 21, borderWidth: 1, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 11 },
  emptyTitle: { fontFamily: 'Orbitron', fontSize: 10, fontWeight: '900' },
  emptySubtitle: { fontSize: 9, marginTop: 3 },
});
