import React, { useEffect, useState } from 'react';
import { View, TouchableOpacity, FlatList, Image, ActivityIndicator, Linking, StyleSheet } from 'react-native';
import { AppText as Text } from '../ui/AppText';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../contexts/ThemeContext';
import {
  SystemNewsItem,
  systemNewsSourceDomain,
  useSystemNews,
} from '../../hooks/useSystemNews';

type Props = {
  active: boolean;
  onDetailOpenChange?: (open: boolean) => void;
  onRegisterBack?: (handler: (() => boolean) | null) => void;
};

export function SystemNewsPanel({ active, onDetailOpenChange, onRegisterBack }: Props) {
  const { theme: t } = useTheme();
  const insets = useSafeAreaInsets();
  const {
    items, seenIds, pagination, loading, loadingMore, detailLoading,
    loadPage, loadMore, loadDetail, markSeen, markAllSeen, reset,
  } = useSystemNews();
  const [selected, setSelected] = useState<SystemNewsItem | null>(null);

  useEffect(() => {
    if (active) loadPage(1, false);
    else {
      setSelected(null);
      reset();
    }
  }, [active]);

  useEffect(() => {
    if (active && items.length > 0) {
      void markAllSeen(items.map((item) => item.id));
    }
  }, [active, items, markAllSeen]);

  useEffect(() => {
    onDetailOpenChange?.(!!selected);
  }, [selected, onDetailOpenChange]);

  useEffect(() => {
    if (!onRegisterBack) return;
    onRegisterBack(() => {
      if (selected) {
        setSelected(null);
        return true;
      }
      return false;
    });
    return () => onRegisterBack(null);
  }, [selected, onRegisterBack]);

  const openItem = async (item: SystemNewsItem) => {
    void markSeen(item.id);
    setSelected(item);
    const full = await loadDetail(item.id);
    if (full) setSelected(full);
  };

  if (!active) return null;

  if (selected) {
    const domain = systemNewsSourceDomain(selected);
    return (
      <View style={ss.flex}>
        <View style={[ss.header, { borderBottomColor: t.border2, paddingTop: 0 }]}>
          <TouchableOpacity
            style={[ss.iconBtn, { backgroundColor: t.surface2, borderColor: t.border2 }]}
            onPress={() => setSelected(null)}
          >
            <MaterialIcons name="arrow-back" size={22} color={t.textMuted} />
          </TouchableOpacity>
          <View style={{ flex: 1, alignItems: 'center' }}>
            <Text style={[ss.headerTitle, { color: t.text }]}>NEWS</Text>
          </View>
          <View style={{ width: 48 }} />
        </View>

        <FlatList
          data={['detail']}
          keyExtractor={() => 'detail'}
          renderItem={() => null}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={(
            <View>
              {selected.imageUrl ? (
                <Image source={{ uri: selected.imageUrl }} style={ss.detailBanner} resizeMode="cover" />
              ) : null}
              <View style={{ padding: 20 }}>
                <View style={ss.badgeRow}>
                  <View style={[ss.badge, { backgroundColor: '#e3383520', borderColor: '#e3383540' }]}>
                    <Text style={[ss.badgeText, { color: t.primary }]}>VROOM NEWS</Text>
                  </View>
                  <View style={[ss.badge, { backgroundColor: t.surface2, borderColor: t.border2 }]}>
                    <Text style={[ss.badgeText, { color: t.textDim }]}>ZRODLO: {domain}</Text>
                  </View>
                  {selected.status === 'pending' && (
                    <View style={[ss.badge, { backgroundColor: '#ff980020', borderColor: '#ff980040' }]}>
                      <Text style={[ss.badgeText, { color: '#ff9800' }]}>W KOLEJCE</Text>
                    </View>
                  )}
                </View>
                <Text style={[ss.detailTitle, { color: t.text }]}>{selected.title}</Text>
                <Text style={[ss.cardDate, { color: t.textFaint, marginBottom: 14 }]}>
                  {new Date(selected.createdAt).toLocaleDateString('pl-PL', {
                    day: '2-digit', month: 'long', year: 'numeric',
                  })}
                </Text>
                {detailLoading && <ActivityIndicator color={t.primary} style={{ marginBottom: 12 }} />}
                {!!selected.excerpt && (
                  <Text style={[ss.detailExcerpt, { color: t.textMuted }]}>{selected.excerpt}</Text>
                )}
                <View style={[ss.divider, { backgroundColor: t.border2 }]} />
                <Text style={[ss.detailBody, { color: t.text }]}>
                  {selected.body || selected.excerpt || ''}
                </Text>
                {!!selected.sourceUrl && (
                  <TouchableOpacity
                    style={[ss.sourceBtn, { borderColor: t.primary + '55', backgroundColor: t.primary + '12' }]}
                    onPress={() => Linking.openURL(selected.sourceUrl!)}
                  >
                    <MaterialIcons name="open-in-new" size={16} color={t.primary} />
                    <Text style={[ss.sourceBtnText, { color: t.primary }]}>
                      Otworz oryginal na {domain}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          )}
          ListFooterComponent={<View style={{ height: 48 }} />}
        />
      </View>
    );
  }

  return (
    <View style={ss.flex}>
      <FlatList
        data={items}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: insets.bottom + 16 }}
        showsVerticalScrollIndicator={false}
        onEndReached={() => loadMore()}
        onEndReachedThreshold={0.35}
        ListHeaderComponent={(
          <Text style={[ss.listMeta, { color: t.textFaint }]}>
            {pagination.total > 0
              ? `${pagination.total} newsow motoryzacyjnych`
              : 'Newsy motoryzacyjne VROOM'}
          </Text>
        )}
        ListEmptyComponent={loading ? (
          <View style={ss.emptyBox}>
            <ActivityIndicator size="large" color={t.primary} />
          </View>
        ) : (
          <View style={ss.emptyBox}>
            <Text style={{ fontSize: 48 }}>📰</Text>
            <Text style={[ss.emptyTitle, { color: t.textDim }]}>BRAK NEWSOW</Text>
            <Text style={[ss.emptySub, { color: t.textFaint }]}>
              Wkrotce pojawia sie tu kolejka motoryzacyjnych tematow
            </Text>
          </View>
        )}
        ListFooterComponent={loadingMore ? (
          <ActivityIndicator color={t.primary} style={{ marginVertical: 16 }} />
        ) : pagination.totalPages > 1 ? (
          <Text style={[ss.pageMeta, { color: t.textFaint }]}>
            Strona {pagination.page} / {pagination.totalPages}
          </Text>
        ) : null}
        renderItem={({ item }) => (
          <TouchableOpacity onPress={() => openItem(item)} activeOpacity={0.85}>
            <View style={[ss.card, { backgroundColor: t.surface, borderColor: seenIds.includes(item.id) ? t.border2 : t.primary + '70' }]}>
              {item.imageUrl ? (
                <Image source={{ uri: item.imageUrl }} style={ss.cardBanner} resizeMode="cover" />
              ) : (
                <View style={[ss.cardBanner, ss.cardBannerEmpty, { backgroundColor: t.surface2 }]}>
                  <MaterialIcons name="newspaper" size={28} color={t.textFaint} />
                </View>
              )}
              <View style={{ padding: 14 }}>
                <View style={ss.badgeRow}>
                  <View style={[ss.badge, { backgroundColor: '#e3383520', borderColor: '#e3383540' }]}>
                    <Text style={[ss.badgeText, { color: t.primary }]}>VROOM NEWS</Text>
                  </View>
                  <Text style={[ss.sourceMini, { color: t.textFaint }]}>
                    {systemNewsSourceDomain(item)}
                  </Text>
                </View>
                <Text style={[ss.cardTitle, { color: t.text }]} numberOfLines={2}>{item.title}</Text>
                <Text style={[ss.cardBody, { color: t.textDim }]} numberOfLines={3}>
                  {item.excerpt || ''}
                </Text>
                <View style={ss.cardFooter}>
                  <Text style={[ss.cardDate, { color: t.textFaint }]}>
                    {new Date(item.createdAt).toLocaleDateString('pl-PL', {
                      day: '2-digit', month: 'short',
                    })}
                  </Text>
                  <View style={[ss.readMore, { backgroundColor: t.primary + '18', borderColor: t.primary + '30' }]}>
                    <Text style={[ss.readMoreText, { color: t.primary }]}>CZYTAJ WIECEJ</Text>
                    <MaterialIcons name="arrow-forward-ios" size={9} color={t.primary} />
                  </View>
                </View>
              </View>
            </View>
          </TouchableOpacity>
        )}
      />
    </View>
  );
}

const ss = StyleSheet.create({
  flex: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: 1,
  },
  iconBtn: { width: 48, height: 48, borderRadius: 15, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontFamily: 'Manrope_600SemiBold', fontSize: 12, fontWeight: '900', letterSpacing: 1 },
  listMeta: { fontFamily: 'Satoshi', fontSize: 12, marginBottom: 8 },
  pageMeta: { fontFamily: 'Manrope_600SemiBold', fontSize: 12, textAlign: 'center', marginTop: 8, letterSpacing: 1 },
  card: { borderRadius: 18, borderWidth: 1, overflow: 'hidden' },
  cardBanner: { width: '100%', height: 160 },
  cardBannerEmpty: { alignItems: 'center', justifyContent: 'center' },
  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 },
  badge: { borderRadius: 8, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 4 },
  badgeText: { fontFamily: 'Manrope_600SemiBold', fontSize: 12, fontWeight: '700', letterSpacing: 0.8 },
  sourceMini: { fontFamily: 'Satoshi', fontSize: 12 },
  cardTitle: { fontFamily: 'Manrope_600SemiBold', fontSize: 13, fontWeight: '900', marginBottom: 6 },
  cardBody: { fontFamily: 'Satoshi', fontSize: 13, lineHeight: 20 },
  cardFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 },
  cardDate: { fontFamily: 'Manrope_600SemiBold', fontSize: 12, letterSpacing: 1 },
  readMore: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, borderWidth: 1 },
  readMoreText: { fontFamily: 'Manrope_600SemiBold', fontSize: 12, fontWeight: '700', letterSpacing: 1 },
  detailBanner: { width: '100%', height: 220 },
  detailTitle: { fontFamily: 'Manrope_600SemiBold', fontSize: 20, fontWeight: '900', lineHeight: 28, marginBottom: 8 },
  detailExcerpt: { fontFamily: 'Satoshi', fontSize: 14, lineHeight: 22, marginBottom: 12 },
  detailBody: { fontFamily: 'Satoshi', fontSize: 15, lineHeight: 24 },
  divider: { height: 1, marginVertical: 16 },
  sourceBtn: {
    marginTop: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    borderWidth: 1, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 14,
  },
  sourceBtnText: { fontFamily: 'Manrope_600SemiBold', fontSize: 12, fontWeight: '800', letterSpacing: 0.5 },
  emptyBox: { alignItems: 'center', paddingVertical: 48, gap: 10 },
  emptyTitle: { fontFamily: 'Manrope_600SemiBold', fontSize: 12, letterSpacing: 1 },
  emptySub: { fontFamily: 'Satoshi', fontSize: 12, textAlign: 'center', paddingHorizontal: 32 },
});
