import React, { useEffect, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, Dimensions, ActivityIndicator, Modal, Share,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView }   from 'react-native-safe-area-context';
import { useRouter }      from 'expo-router';
import MaterialIcons      from '@expo/vector-icons/MaterialIcons';
import Toast              from 'react-native-toast-message';
import { usePremium }     from '../contexts/PremiumContext';

const { width } = Dimensions.get('window');
const R   = '#e33835';
const GOLD = '#FFD700';

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
  const {
    getOfferings,
    getRevenueCatDebugSnapshot,
    purchasePremium,
    restorePurchases,
    isPremium,
    isLoading,
  } = usePremium();

  const [offerings, setOfferings]   = useState<any>(null);
  const [loadingOff, setLoadingOff] = useState(true);
  const [buying, setBuying]         = useState<string | null>(null);
  const [restoring, setRestoring]   = useState(false);
  const [rcDebugVisible, setRcDebugVisible] = useState(false);
  const [rcDebugLoading, setRcDebugLoading] = useState(false);
  const [rcDebugText, setRcDebugText] = useState('');

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

  // Zamknij po zakupie
  useEffect(() => {
    if (isPremium) {
      Toast.show({
        type: 'success',
        text1: 'VROOM PREMIUM aktywny!',
        text2: 'Ciesz się pełnymi możliwościami 🏆',
        visibilityTime: 3500,
      });
      router.back();
    }
  }, [isPremium, router]);

  const handlePurchase = async (pkg: any) => {
    setBuying(pkg.identifier);
    const ok = await purchasePremium(pkg);
    setBuying(null);
    if (!ok) {
      Toast.show({ type: 'error', text1: 'Zakup nie powiódł się', text2: 'Spróbuj ponownie.' });
    }
  };

  const handleRestore = async () => {
    setRestoring(true);
    const ok = await restorePurchases();
    setRestoring(false);
    if (ok) {
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
          <Text style={s.subtitle}>Odblokuj pełne możliwości</Text>

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
          <Text style={s.sectionLabel}>WYBIERZ PLAN</Text>

          {loadingOff ? (
            <ActivityIndicator color={R} style={{ marginVertical: 24 }} />
          ) : packages.length > 0 ? (
            packages.map(pkg => (
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
                  <Text style={s.offerName}>{pkg.product?.title ?? pkg.packageType}</Text>
                  <Text style={s.offerPrice}>{pkg.product?.priceString ?? '—'}</Text>
                </View>
                {buying === pkg.identifier
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <MaterialIcons name="arrow-forward-ios" size={16} color={R} />
                }
              </TouchableOpacity>
            ))
          ) : (
            /* Brak pakietów z RevenueCat (np. brak current offering albo sieć) */
            <View style={s.noOffersWrap}>
              <Text style={s.noOffersTitle}>Nie udało się wczytać oferty</Text>
              <Text style={s.noOffersBody}>
                Sprawdź połączenie i RevenueCat: Offering „current”, produkty w App Store Connect / Google Play Console zsynchronizowane z RevenueCat.
                W RevenueCat: Project → Offerings — jedna oferta musi być oznaczona jako Current (inaczej SDK zwraca puste pakiety mimo dobrego API).
                Klucze EXPO_PUBLIC_REVENUECAT_* muszą być w tym samym środowisku EAS co profil buildu (np. development ≠ production).
                W __DEV__ zobaczysz też ostrzeżenia [RevenueCat] w konsoli Metro / Logcat.
              </Text>
            </View>
          )}

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

          <TouchableOpacity
            style={s.restoreBtn}
            onPress={handleRevenueCatDebug}
            activeOpacity={0.75}
          >
            <Text style={s.restoreTxt}>SPRAWDŹ RC DEBUG</Text>
          </TouchableOpacity>
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
    marginBottom: 28,
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
  offerPrice: {
    fontFamily: 'Orbitron',
    fontSize: 9, color: '#ffffff70',
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
