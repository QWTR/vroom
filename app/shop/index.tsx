import React, { useState, useCallback, useMemo } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  ActivityIndicator, Modal, TextInput, FlatList, Dimensions,
  RefreshControl,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import Toast from 'react-native-toast-message';
import { useTheme } from '../../contexts/ThemeContext';
import { useProfileShop, type CatalogItem } from '../../hooks/useProfileShop';
import { useNitroWallet } from '../../hooks/useNitroWallet';
import {
  SHOP_CATEGORIES,
  SHOP_CATEGORY_META,
  type ShopItemCategory,
} from '../../constants/shopCosmetics';
import { ShopAvatarDecoration } from '../../components/shop/ShopAvatarDecoration';
import { NitroShopItemCard } from '../../components/shop/NitroShopItemCard';
import { normalizeMediaUri } from '../../lib/mediaUri';
import { MONETIZATION } from '../../constants/monetization';

const RED = '#e33835';
const GOLD = '#FFD700';
const PAD = 16;
const GAP = 12;
const SCREEN_W = Dimensions.get('window').width;
const GRID_COLS = 2;
const GRID_CARD_W = (SCREEN_W - PAD * 2 - GAP) / GRID_COLS;
const CAROUSEL_CARD_W = Math.min(168, SCREEN_W * 0.44);

type ShopFilter = 'all' | ShopItemCategory;

export default function NitroShopScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { theme, isDark } = useTheme();
  const [filter, setFilter] = useState<ShopFilter>('all');
  const [detail, setDetail] = useState<CatalogItem | null>(null);
  const [exchangeOpen, setExchangeOpen] = useState(false);
  const [exchangePts, setExchangePts] = useState('50');
  const [refreshing, setRefreshing] = useState(false);

  const {
    catalog, nitroBalance, rankingPoints, equippedIds, loading, reload, purchase, equip,
  } = useProfileShop();
  const { wallet, exchangeRankingPoints } = useNitroWallet();

  const balance = nitroBalance || wallet?.nitroBalance || 0;
  const points = rankingPoints || wallet?.rankingPoints || 0;

  const grouped = useMemo(() => {
    const map: Record<ShopItemCategory, CatalogItem[]> = {
      avatar_frame: [],
      profile_banner: [],
      entrance_effect: [],
    };
    for (const item of catalog) {
      if (map[item.category]) map[item.category].push(item);
    }
    return map;
  }, [catalog]);

  const featured = useMemo(
    () => catalog.filter((i) => i.isFeatured).slice(0, 8),
    [catalog],
  );

  const filteredGrid = useMemo(
    () => (filter === 'all' ? catalog : grouped[filter] ?? []),
    [catalog, filter, grouped],
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await reload(filter === 'all' ? undefined : filter);
    setRefreshing(false);
  }, [reload, filter]);

  const onBuy = useCallback(async (item: CatalogItem) => {
    if (item.owned) {
      const isEquipped = equippedIds[item.category] === item.id;
      const eq = await equip(item.category, isEquipped ? null : item.id);
      if (eq.ok) {
        Toast.show({
          type: 'success',
          text1: isEquipped ? 'Zdjęto' : 'Założono',
          text2: item.name,
        });
      } else Toast.show({ type: 'error', text1: eq.error ?? 'Błąd' });
      setDetail(null);
      return;
    }
    const res = await purchase(item.id);
    if (!res.ok) {
      Toast.show({ type: 'error', text1: res.error ?? 'Nie udało się kupić' });
      return;
    }
    Toast.show({ type: 'success', text1: 'Kupiono!', text2: item.name });
    await equip(item.category, item.id);
    setDetail(null);
    reload();
  }, [purchase, equip, reload, equippedIds]);

  const onExchange = useCallback(async () => {
    const pts = Number(exchangePts);
    const res = await exchangeRankingPoints(pts);
    if (!res.ok) {
      Toast.show({ type: 'error', text1: res.error ?? 'Błąd wymiany' });
      return;
    }
    Toast.show({
      type: 'success',
      text1: `+${res.nitroGained} Nitro`,
      text2: `Wymieniono ${res.rankingPointsSpent} pkt rankingu`,
    });
    setExchangeOpen(false);
    reload();
  }, [exchangePts, exchangeRankingPoints, reload]);

  const renderCarouselItem = (item: CatalogItem) => (
    <NitroShopItemCard
      key={item.id}
      item={item}
      width={CAROUSEL_CARD_W}
      equipped={equippedIds[item.category] === item.id}
      isDark={isDark}
      onPress={() => setDetail(item)}
    />
  );

  const renderGridItem = ({ item }: { item: CatalogItem }) => (
    <NitroShopItemCard
      item={item}
      width={GRID_CARD_W}
      equipped={equippedIds[item.category] === item.id}
      isDark={isDark}
      onPress={() => setDetail(item)}
    />
  );

  const detailPreview = detail
    ? normalizeMediaUri(detail.previewUrl ?? detail.assetUrl)
    : null;
  const detailEquipped = detail ? equippedIds[detail.category] === detail.id : false;

  return (
    <View style={[styles.root, { backgroundColor: theme.bg }]}>
      <ScrollView
        stickyHeaderIndices={[1]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={RED} />
        }
        contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}
      >
        {/* Hero */}
        <LinearGradient
          colors={isDark ? ['#1f1600', '#121212', theme.bg] : ['#fff9e8', '#fff', theme.bg]}
          style={[styles.hero, { paddingTop: insets.top + 8 }]}
        >
          <View style={styles.heroTop}>
            <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
              <MaterialIcons name="arrow-back" size={22} color={theme.text} />
            </TouchableOpacity>
            <View style={styles.heroTitleWrap}>
              <Text style={[styles.heroKicker, { color: GOLD }]}>VROOM STORE</Text>
              <Text style={[styles.heroTitle, { color: theme.text }]}>Sklep {MONETIZATION.nitroLabel}</Text>
            </View>
            <View style={styles.heroBalance}>
              <MaterialIcons name="bolt" size={18} color={GOLD} />
              <Text style={styles.heroBalanceNum}>{balance}</Text>
            </View>
          </View>
          <Text style={[styles.heroSub, { color: theme.textDim }]}>
            {MONETIZATION.shopSubtitle}. Funkcje {MONETIZATION.premiumLabel} (baner, giełda, motywy) — w subskrypcji.
          </Text>

          <View style={[styles.walletCard, { backgroundColor: isDark ? '#ffffff08' : '#00000006' }]}>
            <View style={styles.walletRow}>
              <View>
                <Text style={[styles.walletLabel, { color: theme.textDim }]}>Twoje Nitro</Text>
                <Text style={styles.walletValue}>{balance}</Text>
              </View>
              <View style={styles.walletDivider} />
              <View>
                <Text style={[styles.walletLabel, { color: theme.textDim }]}>Pkt rankingu</Text>
                <Text style={[styles.walletValueSm, { color: theme.text }]}>{points}</Text>
              </View>
            </View>
            <TouchableOpacity
              style={styles.exchangeChip}
              activeOpacity={0.85}
              onPress={() => setExchangeOpen(true)}
            >
              <MaterialIcons name="swap-horiz" size={16} color={GOLD} />
              <Text style={styles.exchangeChipText}>Wymień 10:1 · max 300/dzień</Text>
            </TouchableOpacity>
          </View>
        </LinearGradient>

        {/* Category chips — sticky */}
        <View style={[styles.chipsBar, { backgroundColor: theme.bg, borderBottomColor: theme.border }]}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsScroll}>
            <TouchableOpacity
              onPress={() => setFilter('all')}
              style={[
                styles.chip,
                filter === 'all' && styles.chipActive,
                filter !== 'all' && { backgroundColor: isDark ? '#ffffff0c' : '#00000008' },
              ]}
            >
              <MaterialIcons name="apps" size={15} color={filter === 'all' ? '#fff' : theme.textDim} />
              <Text style={[styles.chipText, filter === 'all' && styles.chipTextActive]}>Wszystkie</Text>
              <View style={[styles.chipCount, filter === 'all' && styles.chipCountActive]}>
                <Text style={[styles.chipCountText, filter === 'all' && { color: '#fff' }]}>
                  {catalog.length}
                </Text>
              </View>
            </TouchableOpacity>
            {SHOP_CATEGORIES.map((cat) => {
              const meta = SHOP_CATEGORY_META[cat];
              const count = grouped[cat].length;
              const active = filter === cat;
              return (
                <TouchableOpacity
                  key={cat}
                  onPress={() => { setFilter(cat); reload(cat); }}
                  style={[
                    styles.chip,
                    active && { backgroundColor: meta.accent, borderColor: meta.accent },
                    !active && { backgroundColor: isDark ? '#ffffff0c' : '#00000008' },
                  ]}
                >
                  <MaterialIcons name={meta.icon} size={15} color={active ? '#fff' : meta.accent} />
                  <Text style={[styles.chipText, active && styles.chipTextActive, !active && { color: theme.text }]}>
                    {meta.label.split(' ')[0]}
                  </Text>
                  <View style={[styles.chipCount, active && styles.chipCountActive]}>
                    <Text style={[styles.chipCountText, active && { color: '#fff' }]}>{count}</Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>

        {loading && catalog.length === 0 ? (
          <ActivityIndicator color={RED} style={{ marginTop: 48 }} />
        ) : filter === 'all' ? (
          <View style={styles.sections}>
            {featured.length > 0 && (
              <View style={styles.section}>
                <View style={styles.sectionHead}>
                  <MaterialIcons name="star" size={18} color={RED} />
                  <View style={styles.sectionHeadText}>
                    <Text style={[styles.sectionTitle, { color: theme.text }]}>Polecane</Text>
                    <Text style={[styles.sectionSub, { color: theme.textDim }]}>Wybrane ozdoby</Text>
                  </View>
                </View>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.carousel}
                >
                  {featured.map(renderCarouselItem)}
                </ScrollView>
              </View>
            )}

            {SHOP_CATEGORIES.map((cat) => {
              const items = grouped[cat];
              if (items.length === 0) return null;
              const meta = SHOP_CATEGORY_META[cat];
              return (
                <View key={cat} style={styles.section}>
                  <TouchableOpacity
                    style={styles.sectionHead}
                    activeOpacity={0.8}
                    onPress={() => setFilter(cat)}
                  >
                    <View style={[styles.sectionIcon, { backgroundColor: `${meta.accent}22` }]}>
                      <MaterialIcons name={meta.icon} size={20} color={meta.accent} />
                    </View>
                    <View style={styles.sectionHeadText}>
                      <Text style={[styles.sectionTitle, { color: theme.text }]}>{meta.label}</Text>
                      <Text style={[styles.sectionSub, { color: theme.textDim }]}>{meta.subtitle}</Text>
                    </View>
                    <View style={styles.seeAll}>
                      <Text style={[styles.seeAllText, { color: meta.accent }]}>{items.length}</Text>
                      <MaterialIcons name="chevron-right" size={20} color={meta.accent} />
                    </View>
                  </TouchableOpacity>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.carousel}
                  >
                    {items.map(renderCarouselItem)}
                  </ScrollView>
                </View>
              );
            })}

            {catalog.length === 0 && (
              <View style={styles.empty}>
                <MaterialIcons name="inventory-2" size={40} color={theme.textDim} />
                <Text style={[styles.emptyTitle, { color: theme.text }]}>Pusto na razie</Text>
                <Text style={[styles.emptySub, { color: theme.textDim }]}>
                  Dodaj produkty w panelu admina Nitro Shop
                </Text>
              </View>
            )}
          </View>
        ) : (
          <View style={styles.gridWrap}>
            <View style={styles.gridHead}>
              <Text style={[styles.gridHeadTitle, { color: theme.text }]}>
                {SHOP_CATEGORY_META[filter].label}
              </Text>
              <Text style={[styles.gridHeadSub, { color: theme.textDim }]}>
                {SHOP_CATEGORY_META[filter].subtitle}
              </Text>
            </View>
            {filteredGrid.length === 0 ? (
              <View style={styles.empty}>
                <Text style={{ color: theme.textDim, textAlign: 'center' }}>
                  Brak produktów w tej kategorii
                </Text>
              </View>
            ) : (
              <FlatList
                data={filteredGrid}
                keyExtractor={(i) => i.id}
                numColumns={GRID_COLS}
                scrollEnabled={false}
                columnWrapperStyle={{ gap: GAP }}
                contentContainerStyle={{ gap: GAP, paddingHorizontal: PAD }}
                renderItem={renderGridItem}
              />
            )}
          </View>
        )}
      </ScrollView>

      {/* Detail sheet */}
      <Modal visible={!!detail} transparent animationType="slide" onRequestClose={() => setDetail(null)}>
        <View style={styles.sheetBg}>
          <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setDetail(null)} />
          <View style={[styles.sheet, { backgroundColor: isDark ? '#161616' : '#fff', paddingBottom: insets.bottom + 16 }]}>
            <View style={styles.sheetHandle} />
            {detail ? (
              <>
                <View style={[styles.sheetPreview, { backgroundColor: isDark ? '#0a0a0a' : '#f0f0f2' }]}>
                  {detail.category === 'avatar_frame' ? (
                    <View style={styles.sheetFrame}>
                      <View style={[styles.sheetFakeAvatar, { backgroundColor: isDark ? '#333' : '#ccc' }]} />
                      <ShopAvatarDecoration item={detail} size={100} />
                    </View>
                  ) : detailPreview ? (
                    <Image source={{ uri: detailPreview }} style={styles.sheetPreviewImg} contentFit="cover" />
                  ) : null}
                </View>
                <Text style={[styles.sheetCat, { color: SHOP_CATEGORY_META[detail.category].accent }]}>
                  {SHOP_CATEGORY_META[detail.category].label.toUpperCase()}
                </Text>
                <Text style={[styles.sheetName, { color: theme.text }]}>{detail.name}</Text>
                {!!detail.description && (
                  <Text style={[styles.sheetDesc, { color: theme.textDim }]}>{detail.description}</Text>
                )}
                <TouchableOpacity style={styles.sheetBtn} activeOpacity={0.88} onPress={() => onBuy(detail)}>
                  <LinearGradient
                    colors={detail.owned
                      ? (detailEquipped ? ['#64748b', '#475569'] : [SHOP_CATEGORY_META[detail.category].accent, '#e33835'])
                      : ['#FFD700', '#f59e0b']}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={styles.sheetBtnGrad}
                  >
                    <MaterialIcons
                      name={detail.owned ? (detailEquipped ? 'remove-circle-outline' : 'check-circle') : 'bolt'}
                      size={20}
                      color="#fff"
                    />
                    <Text style={styles.sheetBtnText}>
                      {detail.owned
                        ? (detailEquipped ? 'Zdejmij ozdobę' : 'Załóż teraz')
                        : `Kup za ${detail.nitroCost} Nitro`}
                    </Text>
                  </LinearGradient>
                </TouchableOpacity>
                {!detail.owned && balance < detail.nitroCost && (
                  <TouchableOpacity onPress={() => { setDetail(null); setExchangeOpen(true); }} style={styles.sheetHint}>
                    <Text style={{ color: GOLD, fontSize: 12, fontWeight: '700' }}>
                      Brakuje Nitro? Wymień punkty rankingu →
                    </Text>
                  </TouchableOpacity>
                )}
              </>
            ) : null}
          </View>
        </View>
      </Modal>

      {/* Exchange modal */}
      <Modal visible={exchangeOpen} transparent animationType="fade" onRequestClose={() => setExchangeOpen(false)}>
        <View style={styles.modalBg}>
          <View style={[styles.modalCard, { backgroundColor: isDark ? '#161616' : '#fff' }]}>
            <View style={styles.modalIconWrap}>
              <MaterialIcons name="bolt" size={28} color={GOLD} />
            </View>
            <Text style={[styles.modalTitle, { color: theme.text }]}>Wymiana na Nitro</Text>
            <Text style={[styles.modalSub, { color: theme.textDim }]}>
              10 pkt rankingu = 1 Nitro · maks. 300 pkt dziennie
            </Text>
            <Text style={[styles.modalPts, { color: theme.textDim }]}>
              Masz: {points} pkt rankingu
            </Text>
            <TextInput
              value={exchangePts}
              onChangeText={setExchangePts}
              keyboardType="number-pad"
              style={[styles.input, { color: theme.text, borderColor: theme.border, backgroundColor: isDark ? '#0a0a0a' : '#f5f5f5' }]}
              placeholder="50"
              placeholderTextColor={theme.textDim}
            />
            <Text style={[styles.previewExchange, { color: theme.textDim }]}>
              Otrzymasz ~{Math.floor(Number(exchangePts || 0) / 10)} Nitro
            </Text>
            <TouchableOpacity style={styles.modalBtn} onPress={onExchange}>
              <Text style={styles.modalBtnText}>Wymień</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setExchangeOpen(false)} style={styles.modalCancel}>
              <Text style={{ color: theme.textDim }}>Anuluj</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  hero: { paddingHorizontal: PAD, paddingBottom: 20 },
  heroTop: { flexDirection: 'row', alignItems: 'center', marginBottom: 16, gap: 10 },
  backBtn: { padding: 8, marginLeft: -8 },
  heroTitleWrap: { flex: 1 },
  heroKicker: { fontFamily: 'Orbitron', fontSize: 8, letterSpacing: 3, fontWeight: '800' },
  heroTitle: { fontFamily: 'Orbitron', fontSize: 22, fontWeight: '900', marginTop: 2 },
  heroSub: { fontSize: 11, lineHeight: 16, marginBottom: 14, paddingHorizontal: 2 },
  heroBalance: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#FFD70022',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#FFD70044',
  },
  heroBalanceNum: { color: GOLD, fontWeight: '900', fontSize: 16 },
  walletCard: {
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#FFD70028',
  },
  walletRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 14 },
  walletLabel: { fontSize: 10, fontWeight: '600', marginBottom: 4 },
  walletValue: { color: GOLD, fontFamily: 'Orbitron', fontSize: 28, fontWeight: '900' },
  walletValueSm: { fontFamily: 'Orbitron', fontSize: 20, fontWeight: '800' },
  walletDivider: { width: 1, height: 36, backgroundColor: '#ffffff18', marginHorizontal: 20 },
  exchangeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#FFD70018',
    paddingVertical: 11,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#FFD70033',
  },
  exchangeChipText: { color: GOLD, fontSize: 12, fontWeight: '800' },
  chipsBar: {
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  chipsScroll: { paddingHorizontal: PAD, gap: 8 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  chipActive: { backgroundColor: RED },
  chipText: { fontSize: 12, fontWeight: '700', color: '#888' },
  chipTextActive: { color: '#fff' },
  chipCount: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#ffffff15',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
  },
  chipCountActive: { backgroundColor: '#ffffff30' },
  chipCountText: { fontSize: 10, fontWeight: '800', color: '#aaa' },
  sections: { paddingTop: 8 },
  section: { marginBottom: 24 },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: PAD,
    marginBottom: 12,
    gap: 12,
  },
  sectionIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionHeadText: { flex: 1 },
  sectionTitle: { fontFamily: 'Orbitron', fontSize: 14, fontWeight: '900' },
  sectionSub: { fontSize: 11, marginTop: 3, lineHeight: 15 },
  seeAll: { flexDirection: 'row', alignItems: 'center' },
  seeAllText: { fontFamily: 'Orbitron', fontSize: 13, fontWeight: '900' },
  carousel: { paddingHorizontal: PAD, gap: GAP },
  gridWrap: { paddingTop: 16 },
  gridHead: { paddingHorizontal: PAD, marginBottom: 14 },
  gridHeadTitle: { fontFamily: 'Orbitron', fontSize: 16, fontWeight: '900' },
  gridHeadSub: { fontSize: 12, marginTop: 4, lineHeight: 17 },
  empty: { alignItems: 'center', paddingVertical: 48, paddingHorizontal: 32, gap: 8 },
  emptyTitle: { fontFamily: 'Orbitron', fontSize: 14, fontWeight: '800' },
  emptySub: { textAlign: 'center', fontSize: 12, lineHeight: 18 },
  sheetBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingHorizontal: 20, paddingTop: 10 },
  sheetHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#ffffff30',
    alignSelf: 'center',
    marginBottom: 16,
  },
  sheetPreview: {
    height: 180,
    borderRadius: 16,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  sheetFrame: { width: 100, height: 100, alignItems: 'center', justifyContent: 'center' },
  sheetFakeAvatar: { width: 64, height: 64, borderRadius: 32 },
  sheetPreviewImg: { width: '100%', height: '100%' },
  sheetCat: { fontFamily: 'Orbitron', fontSize: 8, letterSpacing: 2, fontWeight: '800', marginBottom: 6 },
  sheetName: { fontFamily: 'Orbitron', fontSize: 18, fontWeight: '900', marginBottom: 8 },
  sheetDesc: { fontSize: 13, lineHeight: 19, marginBottom: 16 },
  sheetBtn: { borderRadius: 14, overflow: 'hidden' },
  sheetBtnGrad: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 16,
  },
  sheetBtnText: { color: '#fff', fontWeight: '900', fontSize: 14 },
  sheetHint: { marginTop: 14, alignItems: 'center' },
  modalBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', justifyContent: 'center', padding: 24 },
  modalCard: { borderRadius: 20, padding: 24, alignItems: 'center' },
  modalIconWrap: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#FFD70022',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  modalTitle: { fontFamily: 'Orbitron', fontSize: 17, fontWeight: '900', marginBottom: 6 },
  modalSub: { fontSize: 11, textAlign: 'center', marginBottom: 8 },
  modalPts: { fontSize: 12, marginBottom: 14 },
  input: {
    width: '100%',
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    fontSize: 18,
    textAlign: 'center',
    marginBottom: 8,
  },
  previewExchange: { fontSize: 11, marginBottom: 16 },
  modalBtn: {
    width: '100%',
    backgroundColor: RED,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  modalBtnText: { color: '#fff', fontWeight: '900', fontSize: 14 },
  modalCancel: { marginTop: 14, padding: 8 },
});
