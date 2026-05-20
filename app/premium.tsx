import React, { useEffect, useState } from 'react';
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

const { width } = Dimensions.get('window');
const R   = '#e33835';
const GOLD = '#FFD700';
const TERMS_URL   = 'https://v-room.app/terms';
const PRIVACY_URL = 'https://v-room.app/privacy';

/** Etykieta okresu rozliczenia — wymagane przez Google Play przy ofercie subskrypcji. */
function billingPeriodLabel(pkg: any): string {
  const type = String(pkg?.packageType ?? '').toUpperCase();
  if (type.includes('MONTH')) return 'miesiąc';
  if (type.includes('ANNUAL') || type.includes('YEAR')) return 'rok';
  if (type.includes('WEEK')) return 'tydzień';
  const iso = String(pkg?.product?.subscriptionPeriod ?? '');
  if (iso === 'P1M' || /month/i.test(iso)) return 'miesiąc';
  if (iso === 'P1Y' || /year/i.test(iso)) return 'rok';
  const priceStr = pkg?.product?.priceString ?? '';
  if (/\/\s*mies|month|mies\./i.test(priceStr)) return 'miesiąc';
  if (/\/\s*rok|year|rocznie/i.test(priceStr)) return 'rok';
  return 'okres rozliczeniowy';
}

function billingFrequencyAdverb(pkg: any): string {
  const period = billingPeriodLabel(pkg);
  if (period === 'miesiąc') return 'co miesiąc';
  if (period === 'rok') return 'co rok';
  if (period === 'tydzień') return 'co tydzień';
  return `co ${period}`;
}

/** RevenueCat: `current` jest wypełnione tylko gdy oferta jest „Current” w dashboardzie — inaczej pakiety są w `all`. */
function packagesFromOfferings(offerings: any): any[] {
  if (!offerings) return [];
  const cur = offerings.current;
  if (Array.isArray(cur?.availablePackages) && cur.availablePackages.length > 0) {
    return cur.availablePackages;
  }
  const all = offerings.all;
  if (all && typeof all === 'object') {
    for (const id of Object.keys(all)) {
      const pkgs = all[id]?.availablePackages;
      if (Array.isArray(pkgs) && pkgs.length > 0) return pkgs;
    }
  }
  return [];
}

// ─── Benefity ─────────────────────────────────────────────────────────────────
const BENEFITS = [
  { icon: '🚗', text: 'Nieograniczony garaż',           sub: 'Free: max 3 auta' },
  { icon: '🛣️', text: 'Nieograniczone prywatne trasy',  sub: 'Free: max 5' },
  { icon: '🏠', text: 'Wiele klubów',                   sub: 'Free: 1 klub' },
  { icon: '📊', text: 'Pełna historia aktywności',      sub: '' },
  { icon: '🛒', text: '5 darmowych ogłoszeń/mies + tydzień promowania gratis', sub: '' },
  { icon: '🗺️', text: 'Tryb prywatny na mapie',         sub: '' },
  { icon: '📤', text: 'Eksport GPX/CSV',                sub: '' },
  { icon: '🚫', text: 'Zero reklam',                    sub: '' },
];

// ─── Ekran ────────────────────────────────────────────────────────────────────
export default function PremiumScreen() {
  const router = useRouter();
  const { fetchSettings } = useSettings();
  const {
    getOfferings,
    getRevenueCatDebugSnapshot,
    purchasePremium,
    restorePurchases,
    isPremium,
    isLoading,
    premiumStatus,
  } = usePremium();

  const [offerings, setOfferings]   = useState<any>(null);
  const [loadingOff, setLoadingOff] = useState(true);
  const [buying, setBuying]         = useState<string | null>(null);
  const [restoring, setRestoring]   = useState(false);
  const [rcDebugVisible, setRcDebugVisible] = useState(false);
  const [rcDebugLoading, setRcDebugLoading] = useState(false);
  const [rcDebugText, setRcDebugText] = useState('');
  const [justActivated, setJustActivated] = useState(false);

  useEffect(() => {
    if (isLoading) return;
    let cancelled = false;
    (async () => {
      setLoadingOff(true);
      try {
        const off = await getOfferings();
        if (!cancelled) setOfferings(off);
      } finally {
        if (!cancelled) setLoadingOff(false);
      }
    })();
    return () => { cancelled = true; };
  }, [getOfferings, isLoading]);

  // Zamknij tylko po aktywacji na tym ekranie (purchase/restore),
  // żeby użytkownik z już aktywnym premium nie był wyrzucany po kilku sekundach.
  useEffect(() => {
    if (isPremium && justActivated) {
      (async () => {
        try {
          await fetchSettings();
        } catch {
          /* ignore */
        }
        Toast.show({
          type: 'success',
          text1: 'VROOM PREMIUM aktywny!',
          text2: 'Ciesz się pełnymi możliwościami 🏆',
          visibilityTime: 3500,
        });
        router.back();
      })();
    }
  }, [isPremium, justActivated, router, fetchSettings]);

  const handlePurchase = async (pkg: any) => {
    setBuying(pkg.identifier);
    const ok = await purchasePremium(pkg);
    setBuying(null);
    if (ok) {
      setJustActivated(true);
    }
    if (!ok) {
      Toast.show({ type: 'error', text1: 'Zakup nie powiódł się', text2: 'Spróbuj ponownie.' });
    }
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

  const packages: any[] = packagesFromOfferings(offerings);
  const premiumEndsAt = premiumStatus.currentPeriodEnd ?? premiumStatus.premiumExpiresAt ?? null;
  const premiumEndLabel = premiumEndsAt
    ? new Date(premiumEndsAt).toLocaleDateString('pl-PL')
    : 'Brak daty końca';

  return (
    <View style={{ flex: 1 }}>
      <LinearGradient
        colors={['#160303', '#0e0202', '#080808']}
        style={StyleSheet.absoluteFill}
      />

      {/* Dekoracje */}
      <View style={s.deco1} />
      <View style={s.deco2} />

      <SafeAreaView style={{ flex: 1 }}>
        {/* ─── Header ─── */}
        <View style={s.header}>
          <TouchableOpacity onPress={() => router.back()} style={s.closeBtn}>
            <MaterialIcons name="close" size={22} color="#fff" />
          </TouchableOpacity>
        </View>

        <ScrollView
          contentContainerStyle={{ paddingHorizontal: 22, paddingBottom: 50 }}
          showsVerticalScrollIndicator={false}
        >
          {/* ─── Ikona Premium ─── */}
          <View style={s.iconWrap}>
            <LinearGradient
              colors={['#2a2000', '#1a1500', '#0a0a0a']}
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
              colors={['#1a0808', '#100404', '#0a0a0a']}
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

          {!isPremium && loadingOff ? (
            <ActivityIndicator color={R} style={{ marginVertical: 24 }} />
          ) : !isPremium && packages.length > 0 ? (
            packages.map(pkg => {
              const priceStr = pkg.product?.priceString ?? '—';
              const period = billingPeriodLabel(pkg);
              const frequency = billingFrequencyAdverb(pkg);
              return (
              <TouchableOpacity
                key={pkg.identifier}
                style={s.offerBtn}
                onPress={() => handlePurchase(pkg)}
                activeOpacity={0.85}
                disabled={buying !== null}
              >
                <LinearGradient
                  colors={['#2a0707', '#1a0404']}
                  style={StyleSheet.absoluteFill}
                  start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                />
                <View style={s.offerDeco} />
                <View style={{ flex: 1 }}>
                  <Text style={s.offerName}>{pkg.product?.title ?? 'VROOM Premium'}</Text>
                  <Text style={s.offerPriceMain}>
                    {priceStr}
                    <Text style={s.offerPricePeriod}> / {period}</Text>
                  </Text>
                  <Text style={s.offerPriceSub}>
                    Płatność {frequency} · automatyczne odnawianie do anulowania
                  </Text>
                </View>
                {buying === pkg.identifier
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <MaterialIcons name="arrow-forward-ios" size={16} color={R} />
                }
              </TouchableOpacity>
              );
            })
          ) : !isPremium ? (
            <View style={s.noOffersWrap}>
              <Text style={s.noOffersTitle}>VROOM Premium</Text>
              <Text style={s.noOffersBody}>
                {Platform.OS === 'ios'
                  ? 'Plany subskrypcji ładują się z App Store. Upewnij się, że masz połączenie z internetem. W środowisku testowym Apple (Sandbox) zaloguj się kontem sandbox w Ustawienia → App Store → Konto sandbox, a następnie wróć tutaj.'
                  : 'Plany subskrypcji pojawią się tutaj po połączeniu z siecią i poprawnej konfiguracji oferty w Google Play oraz RevenueCat.'}
                {'\n\n'}
                Korzyści Premium są opisane powyżej. Możesz używać „Przywróć zakupy”, jeśli subskrypcja była wcześniej aktywna na tym koncie {Platform.OS === 'ios' ? 'Apple' : 'Google'}.
              </Text>
            </View>
          ) : null}

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

          {__DEV__ && (
            <TouchableOpacity
              style={s.restoreBtn}
              onPress={handleRevenueCatDebug}
              activeOpacity={0.75}
            >
              <Text style={s.restoreTxt}>SPRAWDŹ RC DEBUG</Text>
            </TouchableOpacity>
          )}

          <Text style={s.footerLegal}>
            Subskrypcja VROOM Premium jest dobrowolna. Cena i okres rozliczenia są widoczne przy przycisku planu
            oraz w oknie płatności {Platform.OS === 'ios' ? 'App Store' : 'Google Play'} przed zatwierdzeniem transakcji.
          </Text>
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
              <Text style={s.debugTitle}>RC DEBUG</Text>
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
const s = StyleSheet.create({
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
    backgroundColor: '#ffffff12',
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
    fontSize: 28, color: '#fff',
    textAlign: 'center', letterSpacing: 6,
    marginBottom: 8,
  },
  subtitle: {
    fontFamily: 'Orbitron',
    fontSize: 11, color: '#ffffff60',
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
    color: '#ffffffcc',
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
    color: '#ffffffc0',
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
    borderBottomColor: '#ffffff08',
  },
  benefitIcon: { fontSize: 20, width: 28, textAlign: 'center' },
  benefitText: {
    fontFamily: 'Orbitron',
    fontSize: 11, color: '#fff',
    fontWeight: '700', flex: 1,
  },
  benefitSub: {
    fontFamily: 'Orbitron',
    fontSize: 8, color: '#ffffff50',
    marginTop: 2,
  },

  sectionLabel: {
    fontFamily: 'Orbitron',
    fontSize: 9, color: R,
    letterSpacing: 4, marginBottom: 14,
    textAlign: 'center',
  },
  termsCard: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#ffffff18',
    backgroundColor: '#ffffff08',
    padding: 16,
    marginBottom: 18,
    gap: 6,
  },
  termsCardTitle: {
    fontFamily: 'Orbitron',
    fontSize: 10,
    color: '#fff',
    fontWeight: '800',
    letterSpacing: 1,
    marginBottom: 4,
  },
  termsBullet: {
    fontFamily: 'Orbitron',
    fontSize: 8,
    color: '#ffffffb0',
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
    color: '#ffffff50',
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
    fontSize: 12, color: '#fff',
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
    color: '#ffffff90',
    fontWeight: '700',
  },
  offerPriceSub: {
    fontFamily: 'Orbitron',
    fontSize: 8,
    color: '#ffffff65',
    marginTop: 5,
    lineHeight: 12,
  },
  footerLegal: {
    fontFamily: 'Orbitron',
    fontSize: 8,
    color: '#ffffff45',
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
    borderColor: '#ffffff18',
    padding: 18,
    marginBottom: 8,
    backgroundColor: '#ffffff06',
  },
  noOffersTitle: {
    fontFamily: 'Orbitron',
    fontSize: 12,
    color: '#fff',
    fontWeight: '800',
    marginBottom: 10,
    textAlign: 'center',
  },
  noOffersBody: {
    fontFamily: 'Orbitron',
    fontSize: 9,
    color: '#ffffff70',
    lineHeight: 15,
    textAlign: 'center',
  },

  restoreBtn: {
    marginTop: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  restoreTxt: {
    fontFamily: 'Orbitron',
    fontSize: 10, color: '#ffffff40',
    letterSpacing: 2,
  },
  debugBackdrop: {
    flex: 1,
    backgroundColor: '#000000cc',
    justifyContent: 'center',
    padding: 16,
  },
  debugCard: {
    maxHeight: '80%',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#ffffff20',
    backgroundColor: '#111',
    overflow: 'hidden',
  },
  debugHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#ffffff18',
  },
  debugTitle: {
    color: '#fff',
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
    backgroundColor: '#ffffff14',
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
    backgroundColor: '#ffffff14',
  },
  debugScroll: {
    maxHeight: '100%',
  },
  debugText: {
    color: '#e6e6e6',
    fontSize: 11,
    lineHeight: 16,
    padding: 12,
  },
});
