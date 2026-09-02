import React, { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { AppText as Text } from '../components/ui/AppText';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialCommunityIcons, MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTheme } from '../contexts/ThemeContext';
import { usePremium } from '../contexts/PremiumContext';
import { getPremiumCatalog, type PremiumCatalog } from '../lib/premiumV2';
import PremiumGate from '../components/PremiumGate';
import { track } from '../lib/analytics/client';

const MODULES = [
  { flag: 'driveReplayV1', benefitKey: 'drive_replay', icon: 'play-circle-outline', route: '/profile/history-rides' },
  { flag: 'garageProV1', benefitKey: 'garage_pro', icon: 'garage-variant', route: '/premium-garage' },
  { flag: 'convoyLiveV1', benefitKey: 'convoy_live', icon: 'car-multiple', route: '/convoy' },
  { flag: 'routeStudioV1', benefitKey: 'route_studio', icon: 'map-marker-path', route: '/route-studio' },
  { flag: 'marketWatchV1', benefitKey: 'market_watch', icon: 'car-search', route: '/market-watch' },
  { flag: 'offlineCorridorsV1', benefitKey: 'offline_routes', icon: 'map-check-outline', route: '/offline-routes' },
] as const;

export default function PremiumHubScreen() {
  const router = useRouter();
  const { theme } = useTheme();
  const { isPremium } = usePremium();
  const [catalog, setCatalog] = useState<PremiumCatalog | null>(null);
  const [error, setError] = useState(false);
  const load = () => { setError(false); getPremiumCatalog(true).then(setCatalog).catch(() => { setCatalog(null); setError(true); }); };
  useEffect(() => { load(); }, []);
  if (!isPremium) return <PremiumGate feature="Centrum Premium" description="Aktywuj Premium, aby korzystać z modułów Premium 2.0." locked />;
  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.bg }]}>
      <View style={styles.header}><TouchableOpacity onPress={() => router.back()}><MaterialIcons name="arrow-back" size={24} color={theme.text} /></TouchableOpacity><Text style={[styles.title, { color: theme.text }]}>PREMIUM 2.0</Text><View style={{ width: 24 }} /></View>
      {!catalog && !error ? <ActivityIndicator color="#FFD447" style={{ marginTop: 40 }} /> : error ? <View style={{ padding: 24, alignItems: 'center', gap: 14 }}><Text style={{ color: theme.textDim, textAlign: 'center' }}>Nie udało się pobrać aktualnego katalogu benefitów. Nie pokazujemy niepotwierdzonej oferty.</Text><TouchableOpacity onPress={load} style={{ backgroundColor: '#FFD447', borderRadius: 12, paddingHorizontal: 18, paddingVertical: 12 }}><Text style={{ color: '#111', fontWeight: '900' }}>SPRÓBUJ PONOWNIE</Text></TouchableOpacity></View> : (
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={[styles.lead, { color: theme.textDim }]}>Wszystkie narzędzia Premium w jednym miejscu.</Text>
          {MODULES.filter((item) => catalog!.flags[item.flag]).map((item) => {
            const benefit = catalog!.groups.flatMap((group) => group.benefits).find((entry) => entry.key === item.benefitKey);
            if (!benefit?.enabled) return null;
            return (
            <TouchableOpacity key={item.flag} onPress={() => { track({ eventName: 'premium_benefit_opened', entityType: 'premium_feature', entityId: item.flag, screenName: 'premium_hub', surface: 'premium' }); router.push(item.route as any); }} style={[styles.card, { backgroundColor: theme.surface, borderColor: '#FFD44744' }]}>
              <View style={styles.icon}><MaterialCommunityIcons name={item.icon as any} size={26} color="#FFD447" /></View>
              <View style={{ flex: 1 }}><Text style={[styles.cardTitle, { color: theme.text }]}>{benefit.title}</Text><Text style={[styles.cardSub, { color: theme.textDim }]}>{benefit.description}</Text></View>
              <MaterialIcons name="chevron-right" size={24} color={theme.textDim} />
            </TouchableOpacity>
          ); })}
          {catalog!.market.availablePromoGrants > 0 && <View style={[styles.coupon, { borderColor: '#4de92666' }]}><Text style={styles.couponTitle}>KUPON GOTOWY</Text><Text style={[styles.cardSub, { color: theme.textDim }]}>{catalog!.market.availablePromoGrants} × promocja ogłoszenia na 7 dni</Text></View>}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({ safe: { flex: 1 }, header: { height: 56, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, title: { fontFamily: 'Manrope_700Bold', fontSize: 16, letterSpacing: 1 }, content: { padding: 18, gap: 12, paddingBottom: 40 }, lead: { marginBottom: 6, fontSize: 13 }, card: { minHeight: 82, borderWidth: 1, borderRadius: 18, flexDirection: 'row', alignItems: 'center', padding: 16, gap: 14 }, icon: { width: 48, height: 48, borderRadius: 15, backgroundColor: '#FFD44716', alignItems: 'center', justifyContent: 'center' }, cardTitle: { fontFamily: 'Manrope_600SemiBold', fontSize: 12, fontWeight: '900' }, cardSub: { fontSize: 12, marginTop: 5, lineHeight: 16 }, coupon: { borderWidth: 1, borderRadius: 16, padding: 16, marginTop: 8 }, couponTitle: { color: '#4de926', fontFamily: 'Manrope_600SemiBold', fontSize: 12, fontWeight: '900', letterSpacing: 1 } });
