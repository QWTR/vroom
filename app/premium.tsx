import React, { useEffect, useState, useMemo } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, Dimensions, ActivityIndicator, Modal, Share, Linking, Platform,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView }   from 'react-native-safe-area-context';
import { useRouter }      from 'expo-router';
import MaterialIcons      from '@expo/vector-icons/MaterialIcons';
import Toast              from 'react-native-toast-message';
import { usePremium }     from '../contexts/PremiumContext';
import { useSettings }    from '../hooks/useSettings';
import type { PremiumProduct } from '../types/premiumProduct';
import { isIosPremiumStoreReady } from '../lib/iosStoreKitPremium';
import { useTheme } from '../contexts/ThemeContext';
import type { AppTheme } from '../constants/theme';

const { width } = Dimensions.get('window');
const isTabletLayout = width >= 900;
const R   = '#e33835';
const GOLD = '#FFD700';
const TERMS_URL   = 'https://v-room.app/terms';
const PRIVACY_URL = 'https://v-room.app/privacy';

/** Etykieta okresu rozliczenia — wymagane przez Google Play przy ofercie subskrypcji. */
function billingPeriodLabel(product: PremiumProduct): string {
  if (product.billingPeriod === 'month') return 'miesiąc';
  if (product.billingPeriod === 'year') return 'rok';
  if (product.billingPeriod === 'week') return 'tydzień';
  const priceStr = product.priceString ?? '';
  if (/\/\s*mies|month|mies\./i.test(priceStr)) return 'miesiąc';
  if (/\/\s*rok|year|rocznie/i.test(priceStr)) return 'rok';
  return 'okres rozliczeniowy';
}

function billingFrequencyAdverb(product: PremiumProduct): string {
  const period = billingPeriodLabel(product);
  if (period === 'miesiąc') return 'co miesiąc';
  if (period === 'rok') return 'co rok';
  if (period === 'tydzień') return 'co tydzień';
  return `co ${period}`;
}

// ─── Benefity ─────────────────────────────────────────────────────────────────
const BENEFITS = [
  { icon: '🚗', text: 'Nieograniczony garaż',           sub: 'Free: max 3 auta' },
  { icon: '🛣️', text: 'Nieograniczone prywatne trasy',  sub: 'Free: max 5' },
  { icon: '🏠', text: 'Wiele klubów',                   sub: 'Free: 1 klub' },
  { icon: '📊', text: 'Pełna historia aktywności',      sub: '' },
  { icon: '🛒', text: '5 darmowych ogłoszeń/mies + tydzień promowania gratis', sub: '' },
  { icon: '🏁', text: 'Tor VROOM Premium',              sub: '8 zadań/tydzień i +25% punktów' },
  { icon: '🗺️', text: 'Tryb prywatny na mapie',         sub: '' },
  { icon: '📤', text: 'Eksport GPX/CSV',                sub: '' },
  { icon: '🚫', text: 'Zero reklam',                    sub: '' },
];

// ─── Ekran ────────────────────────────────────────────────────────────────────
export default function PremiumScreen() {
  const router = useRouter();
  const { theme, isDark } = useTheme();
  const s = useMemo(() => makePremiumStyles(theme), [theme]);
  const { fetchSettings } = useSettings();
  const {
    getPremiumProducts,
    getRevenueCatDebugSnapshot,
    purchasePremium,
    restorePurchases,
    refreshPremiumStatus,
    isPremium,
    isLoading,
    premiumStatus,
  } = usePremium();

  const [products, setProducts]     = useState<PremiumProduct[]>([]);
  const [loadingOff, setLoadingOff] = useState(true);
  const [loadError, setLoadError]   = useState<string | null>(null);
  const [buying, setBuying]         = useState<string | null>(null);
  const [restoring, setRestoring]   = useState(false);
  const [rcDebugVisible, setRcDebugVisible] = useState(false);
  const [rcDebugLoading, setRcDebugLoading] = useState(false);
  const [rcDebugText, setRcDebugText] = useState('');
  const [justActivated, setJustActivated] = useState(false);

  const loadErrorText = (code: string | null): string => {
    if (!code) return '';
    if (code === 'rc_module_missing') {
      return 'Brak natywnego modułu RevenueCat w tym buildzie iOS. Zrób nowy build aplikacji (Expo Go nie obsługuje zakupów natywnych).';
    }
    if (code === 'rc_not_configured') {
      return 'RevenueCat nie został skonfigurowany (brak klucza iOS lub błąd configure). Sprawdź EXPO_PUBLIC_REVENUECAT_IOS_KEY.';
    }
    if (code === 'rc_offerings_fetch_failed') {
      return 'RevenueCat nie zsynchronizował produktu z App Store (offeringsError). Plan może iść bezpośrednio z App Store — zrób OTA i sprawdź StoreKit w debugu.';
    }
    if (code === 'storekit_empty') {
      return 'App Store nie zwraca vroom_premium. Approved w ASC to za mało — na produkcji app musi być wydana w sklepie z tą subskrypcją w buildzie.';
    }
    if (code === 'rc_no_offerings') {
      return 'RevenueCat nie zwraca żadnych offerings dla tego projektu/aplikacji.';
    }
    if (code === 'rc_no_packages') {
      return 'RevenueCat zwraca offering bez pakietów. Ustaw Current Offering i dodaj package z produktem App Store.';
    }
    if (code === 'fetch_failed') {
      return 'Błąd pobierania planów. Sprawdź połączenie i spróbuj ponownie.';
    }
    return 'Brak planów premium.';
  };

  const loadProducts = async () => {
    setLoadingOff(true);
    setLoadError(null);
    try {
      const list = await getPremiumProducts();
      setProducts(list);
      if (list.length === 0) {
        if (Platform.OS === 'ios') {
          try {
            const snap = await getRevenueCatDebugSnapshot();
            if (!snap?.hasPurchasesModule) {
              setLoadError('rc_module_missing');
            } else if (!snap?.sdkReadyAfter) {
              setLoadError('rc_not_configured');
            } else if ((snap?.storeKitPlanCount ?? 0) === 0 && (snap?.rcDirectProductCount ?? 0) === 0) {
              if (snap?.storeKit?.error || (snap?.storeKit?.productCount ?? 0) === 0) {
                setLoadError('storekit_empty');
              } else if (typeof snap?.offeringsError === 'string' && snap.offeringsError.length > 0) {
                setLoadError('rc_offerings_fetch_failed');
              } else if (!Array.isArray(snap?.offeringsAllIds) || snap.offeringsAllIds.length === 0) {
                setLoadError('rc_no_offerings');
              } else {
                setLoadError('rc_no_packages');
              }
            } else {
              setLoadError('no_products');
            }
          } catch {
            setLoadError('no_products');
          }
        } else {
          setLoadError('no_products');
        }
      }
    } catch {
      setProducts([]);
      setLoadError('fetch_failed');
    } finally {
      setLoadingOff(false);
    }
  };

  const handleRetryPurchase = async () => {
    await loadProducts();
    const refreshed = await getPremiumProducts().catch(() => []);
    if (refreshed.length > 0) {
      await handlePurchase(refreshed[0]);
      return;
    }
    Toast.show({
      type: 'error',
      text1: 'Nie udało się rozpocząć zakupu',
      text2: 'Sprawdź App Store / połączenie i spróbuj ponownie.',
    });
  };

  useEffect(() => {
    if (isLoading) return;
    let cancelled = false;
    (async () => {
      setLoadingOff(true);
      setLoadError(null);
      try {
        const list = await getPremiumProducts();
        if (!cancelled) {
          setProducts(list);
          if (list.length === 0) {
            if (Platform.OS === 'ios') {
              try {
                const snap = await getRevenueCatDebugSnapshot();
                if ((snap?.storeKitPlanCount ?? 0) === 0 && (snap?.rcDirectProductCount ?? 0) === 0) {
                  if (snap?.storeKit?.error) setLoadError('storekit_empty');
                  else if (snap?.offeringsError) setLoadError('rc_offerings_fetch_failed');
                  else setLoadError('no_products');
                }
              } catch {
                setLoadError('no_products');
              }
            } else {
              setLoadError('no_products');
            }
          }
        }
      } catch {
        if (!cancelled) {
          setProducts([]);
          setLoadError('fetch_failed');
        }
      } finally {
        if (!cancelled) setLoadingOff(false);
      }
    })();
    return () => { cancelled = true; };
  }, [getPremiumProducts, isLoading]);

  // Zamknij tylko po aktywacji na tym ekranie (purchase/restore),
  // żeby użytkownik z już aktywnym premium nie był wyrzucany po kilku sekundach.
  useEffect(() => {
    if (!justActivated) return;
    (async () => {
      try {
        await fetchSettings();
      } catch {
        /* ignore */
      }
      Toast.show({
        type: 'success',
        text1: isPremium ? 'VROOM PREMIUM aktywny!' : 'Zakup w App Store zakończony',
        text2: isPremium
          ? 'Ciesz się pełnymi możliwościami 🏆'
          : 'Premium synchronizuje się z kontem — odśwież profil za chwilę.',
        visibilityTime: 4000,
      });
      router.back();
    })();
  }, [justActivated, isPremium, router, fetchSettings]);

  const handlePurchase = async (product: PremiumProduct) => {
    if (Platform.OS === 'ios' && !isIosPremiumStoreReady(product)) {
      Toast.show({
        type: 'error',
        text1: 'Brak ceny z App Store',
        text2: 'Produkcja: pobierz z App Store (nie TestFlight). Subskrypcja musi być w wersji appki wysłanej do review.',
        visibilityTime: 6000,
      });
      return;
    }
    setBuying(product.identifier);
    const result = await purchasePremium(product);
    setBuying(null);
    if (result.ok) {
      await refreshPremiumStatus();
      setJustActivated(true);
      return;
    }
    if (result.cancelled) {
      Toast.show({ type: 'info', text1: 'Anulowano', text2: 'Zakup w App Store został przerwany.' });
      return;
    }
    Toast.show({
      type: 'error',
      text1: 'Zakup nie powiódł się',
      text2: result.error ?? 'Sprawdź połączenie i czy kupujesz z wersji ze sklepu (produkcja).',
      visibilityTime: 5000,
    });
  };

  const handleRestore = async () => {
    setRestoring(true);
    const ok = await restorePurchases();
    setRestoring(false);
    if (ok) {
      setJustActivated(true);
      Toast.show({ type: 'success', text1: 'Zakupy przywrócone!', text2: 'Premium aktywne ✓' });
    } else {
      Toast.show({ type: 'info', text1: 'Brak zakupów do przywrócenia', visibilityTime: 3000 });
    }
  };

  const handleRevenueCatDebug = async () => {
    setRcDebugVisible(true);
    setRcDebugLoading(true);
    setRcDebugText('Pobieram dane z RevenueCat...');
    try {
      const snap = await getRevenueCatDebugSnapshot();
      setRcDebugText(JSON.stringify(snap, null, 2));
    } catch (e: any) {
      setRcDebugText(`Błąd debugowania RC:\n${String(e?.message ?? e)}`);
    } finally {
      setRcDebugLoading(false);
    }
  };

  const handleCopyRevenueCatDebug = async () => {
    if (!rcDebugText) return;
    await Share.share({ message: rcDebugText });
    Toast.show({ type: 'success', text1: 'Udostępnij', text2: 'Wybierz „Kopiuj” w systemowym panelu.' });
  };

  const packages: PremiumProduct[] = products;
  const premiumEndsAt = premiumStatus.currentPeriodEnd ?? premiumStatus.premiumExpiresAt ?? null;
  const premiumEndLabel = premiumEndsAt
    ? new Date(premiumEndsAt).toLocaleDateString('pl-PL')
    : 'Brak daty końca';

  return (
    <View style={{ flex: 1 }}>
      <LinearGradient
        colors={isDark ? ['#160303', '#0e0202', theme.bg] : [theme.bgAlt, theme.bg, theme.surface]}
        style={StyleSheet.absoluteFill}
      />

      {/* Dekoracje */}
      <View style={s.deco1} />
      <View style={s.deco2} />

      <SafeAreaView style={{ flex: 1 }}>
        {/* ─── Header ─── */}
        <View style={s.header}>
          <TouchableOpacity onPress={() => router.back()} style={s.closeBtn}>
            <MaterialIcons name="close" size={22} color={theme.icon} />
          </TouchableOpacity>
        </View>

        <ScrollView
          contentContainerStyle={{ paddingHorizontal: 22, paddingBottom: 50, alignItems: 'center' }}
          showsVerticalScrollIndicator={false}
        >
          <View style={s.contentWrap}>
          {/* ─── Ikona Premium ─── */}
          <View style={s.iconWrap}>
            <LinearGradient
              colors={isDark ? ['#2a2000', '#1a1500', theme.bg] : [theme.gold + '30', theme.surface2, theme.surface]}
              style={s.iconBox}
            >
              <MaterialIcons name="workspace-premium" size={52} color={GOLD} />
            </LinearGradient>
            <View style={s.iconGlow} />
          </View>

          {/* ─── Tytuł ─── */}
          <Text style={s.title}>VROOM PREMIUM</Text>
          <Text style={s.subtitle}>
            {isPremium ? 'Twoja subskrypcja jest aktywna' : 'Opcjonalna subskrypcja — dodatkowe funkcje'}
          </Text>

          {isPremium && (
            <View style={s.activeBanner}>
              <MaterialIcons name="verified" size={18} color={GOLD} />
              <View style={{ flex: 1 }}>
                <Text style={s.activeBannerTitle}>Masz aktywne VROOM Premium</Text>
                <Text style={s.activeBannerText}>
                  Plan: {premiumStatus.plan ?? 'premium'} · Koniec okresu: {premiumEndLabel}
                </Text>
                <Text style={s.activeBannerText}>
                  Status: {premiumStatus.status ?? 'active'}
                </Text>
              </View>
            </View>
          )}
          {!isPremium && premiumStatus.status === 'inactive' && !!premiumStatus.premiumExpiresAt && (
            <View style={s.expiredBanner}>
              <MaterialIcons name="schedule" size={16} color="#ff922b" />
              <Text style={s.expiredBannerText}>
                Premium wygasło. Odnów subskrypcję, aby wrócić do pełnych korzyści.
              </Text>
            </View>
          )}
          {!isPremium && !!premiumStatus.error && (
            <View style={s.errorBanner}>
              <MaterialIcons name="error-outline" size={16} color="#ff6b6b" />
              <Text style={s.errorBannerText}>Nie udało się pobrać pełnego statusu Premium.</Text>
            </View>
          )}

          <View style={s.optionalBanner}>
            <MaterialIcons name="info-outline" size={16} color={GOLD} />
            <Text style={s.optionalBannerText}>
              Aplikacja VROOM jest <Text style={s.optionalBold}>w pełni używalna bez subskrypcji</Text>.
              Premium nie jest wymagane do korzystania z mapy, społeczności ani podstawowych funkcji.
            </Text>
          </View>

          {/* ─── Benefity ─── */}
          <View style={s.benefitsCard}>
            <LinearGradient
              colors={isDark ? ['#1a0808', '#100404', theme.bg] : [theme.primaryBg, theme.surface2, theme.surface]}
              style={StyleSheet.absoluteFill}
            />
            <View style={s.cardDeco} />
            {BENEFITS.map((b, i) => (
              <View key={i} style={s.benefitRow}>
                <Text style={s.benefitIcon}>{b.icon}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={s.benefitText}>{b.text}</Text>
                  {!!b.sub && <Text style={s.benefitSub}>{b.sub}</Text>}
                </View>
                <MaterialIcons name="check-circle" size={16} color={GOLD} />
              </View>
            ))}
          </View>

          {/* ─── Oferty ─── */}
          <Text style={s.sectionLabel}>{isPremium ? 'TWOJE KORZYŚCI' : 'WYBIERZ PLAN'}</Text>

          {!isPremium && Platform.OS === 'ios' && packages.length > 0 && (
            <Text style={s.storeKitHint}>
              {packages[0].source === 'storekit'
                ? 'Cena i zakup z App Store.'
                : 'Cena z RevenueCat — zakup przez App Store / RC.'}
              {' '}
              {(packages[0].priceString ?? '—') === '—'
                ? 'Jeśli cena to „—”, na produkcji app musi być live w App Store z IAP w tej wersji.'
                : ''}
            </Text>
          )}

          {!isPremium && loadingOff ? (
            <ActivityIndicator color={R} style={{ marginVertical: 24 }} />
          ) : !isPremium && packages.length > 0 ? (
            packages.map(product => {
              const priceStr = product.priceString ?? '—';
              const period = billingPeriodLabel(product);
              const frequency = billingFrequencyAdverb(product);
              const canBuy = Platform.OS !== 'ios' || isIosPremiumStoreReady(product);
              return (
              <View key={product.identifier} style={s.offerCardWrap}>
              <TouchableOpacity
                key={product.identifier}
                style={[s.offerBtn, !canBuy && { opacity: 0.45 }]}
                onPress={() => handlePurchase(product)}
                activeOpacity={0.85}
                disabled={buying !== null || !canBuy}
              >
                <LinearGradient
                  colors={['#2a0707', '#1a0404']}
                  style={StyleSheet.absoluteFill}
                  start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                />
                <View style={s.offerDeco} />
                <View style={{ flex: 1 }}>
                  <Text style={s.offerName}>{product.title ?? 'VROOM Premium'}</Text>
                  <Text style={s.offerPriceMain}>
                    {priceStr}
                    <Text style={s.offerPricePeriod}> / {period}</Text>
                  </Text>
                  <Text style={s.offerPriceSub}>
                    Płatność {frequency} · automatyczne odnawianie do anulowania
                  </Text>
                </View>
                {buying === product.identifier
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <MaterialIcons name="arrow-forward-ios" size={16} color={R} />
                }
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.offerCtaBtn, !canBuy && { opacity: 0.45 }]}
                onPress={() => handlePurchase(product)}
                activeOpacity={0.9}
                disabled={buying !== null || !canBuy}
              >
                {buying === product.identifier
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Text style={s.offerCtaTxt}>AKTYWUJ SUBSKRYPCJĘ</Text>
                }
              </TouchableOpacity>
              </View>
              );
            })
          ) : !isPremium ? (
            <View style={s.noOffersWrap}>
              <Text style={s.noOffersTitle}>VROOM Premium</Text>
              <Text style={s.noOffersBody}>
                {Platform.OS === 'ios'
                  ? `Nie udało się załadować planu Premium. ${loadErrorText(loadError)}`
                  : 'Plany subskrypcji pojawią się tutaj po połączeniu z siecią i poprawnej konfiguracji oferty w Google Play.'}
                {'\n\n'}
                Korzyści Premium są opisane powyżej. Możesz użyć „Przywróć zakupy”, jeśli subskrypcja była wcześniej aktywna na tym koncie {Platform.OS === 'ios' ? 'Apple' : 'Google'}.
              </Text>
              {!!loadError && (
                <TouchableOpacity style={s.retryBtn} onPress={handleRetryPurchase} activeOpacity={0.85}>
                  <Text style={s.retryTxt}>SPRÓBUJ PONOWNIE</Text>
                </TouchableOpacity>
              )}
            </View>
          ) : null}

          <View style={s.termsCard}>
            <Text style={s.termsCardTitle}>Warunki subskrypcji</Text>
            <Text style={s.termsBullet}>
              • Płatność jest pobierana z konta {Platform.OS === 'ios' ? 'Apple' : 'Google Play'} po potwierdzeniu zakupu.
            </Text>
            <Text style={s.termsBullet}>
              • Subskrypcja odnawia się automatycznie, chyba że anulujesz ją co najmniej 24 godziny przed końcem bieżącego okresu.
            </Text>
            <Text style={s.termsBullet}>
              • Opłata za kolejny okres zostanie pobrana w ciągu 24 godzin przed jego rozpoczęciem.
            </Text>
            <Text style={s.termsBullet}>
              • Anulowanie: {Platform.OS === 'ios' ? 'Ustawienia → Apple ID → Subskrypcje' : 'Google Play → Płatności i subskrypcje → Subskrypcje'}.
            </Text>
            <Text style={s.termsBullet}>
              • Po anulowaniu Premium pozostaje aktywne do końca opłaconego okresu.
            </Text>
            <View style={s.termsLinksRow}>
              <Text style={s.termsLink} onPress={() => Linking.openURL(TERMS_URL)}>Regulamin</Text>
              <Text style={s.termsLinkSep}> · </Text>
              <Text style={s.termsLink} onPress={() => Linking.openURL(PRIVACY_URL)}>Polityka prywatności</Text>
            </View>
          </View>

          {/* ─── Przywróć zakupy ─── */}
          <TouchableOpacity
            style={s.restoreBtn}
            onPress={handleRestore}
            activeOpacity={0.75}
            disabled={restoring}
          >
            {restoring
              ? <ActivityIndicator color="#ffffff60" size="small" />
              : <Text style={s.restoreTxt}>PRZYWRÓĆ ZAKUPY</Text>
            }
          </TouchableOpacity>

          {(__DEV__ || (Platform.OS === 'ios' && !!loadError)) && (
            <TouchableOpacity
              style={s.restoreBtn}
              onPress={handleRevenueCatDebug}
              activeOpacity={0.75}
            >
              <Text style={s.restoreTxt}>SPRAWDŹ PREMIUM DEBUG</Text>
            </TouchableOpacity>
          )}

          <Text style={s.footerLegal}>
            Subskrypcja VROOM Premium jest dobrowolna. Cena i okres rozliczenia są widoczne przy przycisku planu
            oraz w oknie płatności {Platform.OS === 'ios' ? 'App Store' : 'Google Play'} przed zatwierdzeniem transakcji.
          </Text>
          </View>
        </ScrollView>
      </SafeAreaView>

      <Modal
        visible={rcDebugVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setRcDebugVisible(false)}
      >
        <View style={s.debugBackdrop}>
          <View style={s.debugCard}>
            <View style={s.debugHeader}>
              <Text style={s.debugTitle}>PREMIUM DEBUG</Text>
              <View style={s.debugHeaderActions}>
                <TouchableOpacity onPress={handleCopyRevenueCatDebug} style={s.debugCopyBtn}>
                  <MaterialIcons name="content-copy" size={16} color="#fff" />
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setRcDebugVisible(false)} style={s.debugCloseBtn}>
                  <MaterialIcons name="close" size={18} color="#fff" />
                </TouchableOpacity>
              </View>
            </View>
            {rcDebugLoading ? (
              <ActivityIndicator color={R} style={{ marginVertical: 24 }} />
            ) : (
              <ScrollView style={s.debugScroll}>
                <Text style={s.debugText}>{rcDebugText}</Text>
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
function makePremiumStyles(t: AppTheme) {
  return StyleSheet.create({
  contentWrap: {
    width: '100%',
    maxWidth: isTabletLayout ? 760 : 560,
  },
  deco1: {
    position: 'absolute', top: -100, right: -80,
    width: 380, height: 380, borderRadius: 190,
    backgroundColor: '#e3383506', borderWidth: 1, borderColor: '#e3383518',
  },
  deco2: {
    position: 'absolute', top: -50, right: -30,
    width: 220, height: 220, borderRadius: 110,
    backgroundColor: '#e3383510', borderWidth: 1, borderColor: '#e3383828',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 4,
  },
  closeBtn: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: t.border,
    alignItems: 'center', justifyContent: 'center',
  },

  iconWrap: {
    alignItems: 'center',
    marginTop: 8, marginBottom: 24,
  },
  iconBox: {
    width: 100, height: 100, borderRadius: 28,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5, borderColor: '#FFD70040',
    overflow: 'hidden',
  },
  iconGlow: {
    position: 'absolute',
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: GOLD, opacity: 0.07,
    marginTop: 20,
  },

  title: {
    fontFamily: 'OrbitronBold',
    fontSize: 28, color: t.text,
    textAlign: 'center', letterSpacing: 6,
    marginBottom: 8,
  },
  subtitle: {
    fontFamily: 'Orbitron',
    fontSize: 11, color: t.textDim,
    textAlign: 'center', letterSpacing: 2,
    marginBottom: 16,
  },
  optionalBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    backgroundColor: '#FFD70012',
    borderWidth: 1,
    borderColor: '#FFD70035',
    borderRadius: 14,
    padding: 14,
    marginBottom: 22,
  },
  optionalBannerText: {
    flex: 1,
    fontFamily: 'Orbitron',
    fontSize: 9,
    color: t.textMuted,
    lineHeight: 15,
  },
  optionalBold: {
    color: GOLD,
    fontWeight: '800',
  },
  activeBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    backgroundColor: '#4de92612',
    borderWidth: 1,
    borderColor: '#4de92645',
    borderRadius: 14,
    padding: 14,
    marginBottom: 18,
  },
  activeBannerTitle: {
    fontFamily: 'Orbitron',
    fontSize: 10,
    color: '#4de926',
    fontWeight: '900',
    letterSpacing: 1,
    marginBottom: 4,
  },
  activeBannerText: {
    fontFamily: 'Orbitron',
    fontSize: 8,
    color: t.textMuted,
    lineHeight: 13,
  },
  expiredBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#ff922b18',
    borderWidth: 1,
    borderColor: '#ff922b40',
    borderRadius: 12,
    padding: 10,
    marginBottom: 14,
  },
  expiredBannerText: {
    flex: 1,
    fontFamily: 'Orbitron',
    fontSize: 8,
    color: '#ffd8a8',
    lineHeight: 13,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#ff6b6b15',
    borderWidth: 1,
    borderColor: '#ff6b6b35',
    borderRadius: 12,
    padding: 10,
    marginBottom: 14,
  },
  errorBannerText: {
    flex: 1,
    fontFamily: 'Orbitron',
    fontSize: 8,
    color: '#ffc9c9',
    lineHeight: 13,
  },

  benefitsCard: {
    borderRadius: 20,
    borderWidth: 1, borderColor: '#e3383530',
    padding: 20,
    overflow: 'hidden',
    marginBottom: 28,
  },
  cardDeco: {
    position: 'absolute', top: -40, right: -40,
    width: 140, height: 140, borderRadius: 70,
    backgroundColor: '#e3383508',
  },
  benefitRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: t.border,
  },
  benefitIcon: { fontSize: 20, width: 28, textAlign: 'center' },
  benefitText: {
    fontFamily: 'Orbitron',
    fontSize: 11, color: t.text,
    fontWeight: '700', flex: 1,
  },
  benefitSub: {
    fontFamily: 'Orbitron',
    fontSize: 8, color: t.textDim,
    marginTop: 2,
  },

  sectionLabel: {
    fontFamily: 'Orbitron',
    fontSize: 9, color: R,
    letterSpacing: 4, marginBottom: 14,
    textAlign: 'center',
  },
  storeKitHint: {
    fontSize: 11,
    color: t.textMuted,
    textAlign: 'center',
    marginBottom: 12,
    paddingHorizontal: 8,
    lineHeight: 16,
  },
  termsCard: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: t.border2,
    backgroundColor: t.border,
    padding: 16,
    marginBottom: 18,
    gap: 6,
  },
  termsCardTitle: {
    fontFamily: 'Orbitron',
    fontSize: 10,
    color: t.text,
    fontWeight: '800',
    letterSpacing: 1,
    marginBottom: 4,
  },
  termsBullet: {
    fontFamily: 'Orbitron',
    fontSize: 8,
    color: t.textMuted,
    lineHeight: 14,
  },
  termsLinksRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 8,
    alignItems: 'center',
  },
  termsLink: {
    fontFamily: 'Orbitron',
    fontSize: 9,
    color: R,
    textDecorationLine: 'underline',
  },
  termsLinkSep: {
    fontFamily: 'Orbitron',
    fontSize: 9,
    color: t.textDim,
  },

  offerBtn: {
    borderRadius: 16,
    borderWidth: 1, borderColor: R + '40',
    padding: 18,
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    overflow: 'hidden',
  },
  offerCardWrap: {
    marginBottom: 12,
  },
  offerCtaBtn: {
    marginTop: 8,
    minHeight: 48,
    borderRadius: 12,
    backgroundColor: R,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#ffffff20',
  },
  offerCtaTxt: {
    fontFamily: 'Orbitron',
    fontSize: 10,
    color: t.onPrimary,
    letterSpacing: 1.5,
    fontWeight: '900',
  },
  offerBtnPlaceholder: {},
  offerBtnHighlight: {
    borderColor: GOLD + '50',
  },
  offerDeco: {
    position: 'absolute', top: -20, right: -20,
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: '#e3383510',
  },
  offerName: {
    fontFamily: 'Orbitron',
    fontSize: 12, color: t.text,
    fontWeight: '900', letterSpacing: 1,
    marginBottom: 3,
  },
  offerPriceMain: {
    fontFamily: 'Orbitron',
    fontSize: 16,
    color: GOLD,
    fontWeight: '900',
    marginTop: 2,
  },
  offerPricePeriod: {
    fontSize: 11,
    color: t.textMuted,
    fontWeight: '700',
  },
  offerPriceSub: {
    fontFamily: 'Orbitron',
    fontSize: 8,
    color: t.textDim,
    marginTop: 5,
    lineHeight: 12,
  },
  footerLegal: {
    fontFamily: 'Orbitron',
    fontSize: 8,
    color: t.textDim,
    textAlign: 'center',
    lineHeight: 13,
    marginTop: 8,
    paddingHorizontal: 8,
  },
  badge: {
    backgroundColor: GOLD + '20',
    borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3,
    borderWidth: 1, borderColor: GOLD + '40',
  },
  badgeTxt: {
    fontFamily: 'Orbitron',
    fontSize: 8, color: GOLD, fontWeight: '900',
  },

  noOffersWrap: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: t.border2,
    padding: 18,
    marginBottom: 8,
    backgroundColor: t.border,
  },
  noOffersTitle: {
    fontFamily: 'Orbitron',
    fontSize: 12,
    color: t.text,
    fontWeight: '800',
    marginBottom: 10,
    textAlign: 'center',
  },
  noOffersBody: {
    fontFamily: 'Orbitron',
    fontSize: 9,
    color: t.textMuted,
    lineHeight: 15,
    textAlign: 'center',
  },
  retryBtn: {
    marginTop: 16,
    minHeight: 48,
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: R + '55',
    alignItems: 'center',
  },
  retryTxt: {
    fontFamily: 'Orbitron',
    fontSize: 10,
    color: R,
    letterSpacing: 2,
    fontWeight: '800',
  },

  restoreBtn: {
    marginTop: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  restoreTxt: {
    fontFamily: 'Orbitron',
    fontSize: 10, color: t.textFaint,
    letterSpacing: 2,
  },
  debugBackdrop: {
    flex: 1,
    backgroundColor: t.overlay,
    justifyContent: 'center',
    padding: 16,
  },
  debugCard: {
    maxHeight: '80%',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: t.border2,
    backgroundColor: t.surface,
    overflow: 'hidden',
  },
  debugHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: t.border2,
  },
  debugTitle: {
    color: t.text,
    fontFamily: 'OrbitronBold',
    fontSize: 12,
    letterSpacing: 1,
  },
  debugCloseBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: t.border2,
  },
  debugHeaderActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  debugCopyBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: t.border2,
  },
  debugScroll: {
    maxHeight: '100%',
  },
  debugText: {
    color: t.textMuted,
    fontSize: 11,
    lineHeight: 16,
    padding: 12,
  },
});
}
