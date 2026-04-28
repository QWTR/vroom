import React, { useEffect, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, Dimensions, ActivityIndicator,
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
  const { getOfferings, purchasePremium, restorePurchases, isPremium } = usePremium();

  const [offerings, setOfferings]   = useState<any>(null);
  const [loadingOff, setLoadingOff] = useState(true);
  const [buying, setBuying]         = useState<string | null>(null);
  const [restoring, setRestoring]   = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const off = await getOfferings();
        setOfferings(off);
      } finally {
        setLoadingOff(false);
      }
    })();
  }, []);

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
  }, [isPremium]);

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

  // Zbierz pakiety z offerings
  const packages: any[] = offerings?.current?.availablePackages ?? [];

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
            /* Placeholder gdy brak ofert (sandbox / no connection) */
            <>
              <TouchableOpacity style={[s.offerBtn, s.offerBtnPlaceholder]} activeOpacity={0.85}>
                <LinearGradient
                  colors={['#2a0707', '#1a0404']}
                  style={StyleSheet.absoluteFill}
                  start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                />
                <View style={{ flex: 1 }}>
                  <Text style={s.offerName}>PREMIUM MIESIĘCZNY</Text>
                  <Text style={s.offerPrice}>ok. 19,99 zł/mies</Text>
                </View>
                <MaterialIcons name="arrow-forward-ios" size={16} color={R} />
              </TouchableOpacity>
              <TouchableOpacity style={[s.offerBtn, s.offerBtnHighlight]} activeOpacity={0.85}>
                <LinearGradient
                  colors={['#3a0a0a', '#220505']}
                  style={StyleSheet.absoluteFill}
                  start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                />
                <View style={{ flex: 1 }}>
                  <Text style={s.offerName}>PREMIUM ROCZNY</Text>
                  <Text style={s.offerPrice}>ok. 149,99 zł/rok • oszczędzasz 40%</Text>
                </View>
                <View style={s.badge}>
                  <Text style={s.badgeTxt}>BEST</Text>
                </View>
              </TouchableOpacity>
            </>
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
        </ScrollView>
      </SafeAreaView>
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
});
