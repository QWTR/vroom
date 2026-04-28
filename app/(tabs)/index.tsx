// @ts-nocheck
import React from 'react';
import {
  ActivityIndicator,
  Modal,
  RefreshControl,
  ScrollView,
  StatusBar,
  TouchableOpacity,
  View,
  Text,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import Toast from 'react-native-toast-message';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { LinearGradient } from 'expo-linear-gradient';

import { useTheme } from '../../contexts/ThemeContext';
import { usePremium } from '../../contexts/PremiumContext';
import { useAnnouncements } from '../../hooks/useAnnouncements';
import { usePolls } from '../../hooks/usePolls';
import { useGifts } from '../../hooks/useGifts';
import { useAppUpdate } from '../../hooks/useAppUpdate';

import { PollModal } from '../../components/modals/PollModal';
import { GiftModal } from '../../components/modals/GiftModal';
import { UpdateModal } from '../../components/modals/UpdateModal';
import { AnnouncementsModal } from '../../components/modals/AnnouncementsModal';
import { AdBanner } from '../../components/ads/AdBanner';
import { API_URL } from '../../constants/config';

type User = {
  username: string;
  isPremium?: boolean;
  totalDistance: number;
  monthlyDistance: number;
  weeklyDistance: number;
  totalRides: number;
  topSpeed: number;
  avgSpeed: number | string;
  streak: number;
  points: number;
};

const GOLD = '#FFD700';

const getToken = async () =>
  (await AsyncStorage.getItem('userToken')) ?? (await AsyncStorage.getItem('token'));

export default function HomeScreen() {
  const router = useRouter();
  const { theme, isDark } = useTheme();
  const { isPremium, getOfferings, purchasePremium, restorePurchases } = usePremium();
  const { unseenCount, load: loadAnnouncements } = useAnnouncements();
  const { poll, voted, fetchActivePoll, vote } = usePolls();
  const { gifts, fetchAvailableGifts, claimGift } = useGifts();
  const { updateAvailable, downloading, applyUpdate, dismiss } = useAppUpdate();

  const [user, setUser] = React.useState<User | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);
  const [showPremiumModal, setShowPremiumModal] = React.useState(false);
  const [showAnnouncements, setShowAnnouncements] = React.useState(false);
  const [pollVisible, setPollVisible] = React.useState(false);
  const [giftVisible, setGiftVisible] = React.useState(false);
  const [giftIndex, setGiftIndex] = React.useState(0);
  const [offerings, setOfferings] = React.useState<any>(null);
  const [loadingOffers, setLoadingOffers] = React.useState(false);
  const [buying, setBuying] = React.useState<string | null>(null);
  const effectivePremium = !!(isPremium || user?.isPremium);

  const loadUser = async () => {
    try {
      const raw = await AsyncStorage.getItem('user');
      if (!raw) {
        router.replace('/login');
        return;
      }
      const cached = JSON.parse(raw);
      setUser(cached);

      const token = await getToken();
      if (token) {
        const res = await fetch(`${API_URL}/api/profile/me`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const fresh = await res.json();
          const merged = { ...cached, ...fresh };
          setUser(merged);
          await AsyncStorage.setItem('user', JSON.stringify(merged));
        }
      }
    } catch {
      Toast.show({ type: 'error', text2: 'Błąd ładowania profilu' });
    } finally {
      setLoading(false);
      setRefreshing(false);
      
    }
  };

  React.useEffect(() => {
    loadUser();
    loadAnnouncements();
    fetchActivePoll();
    fetchAvailableGifts();
  }, []);

  React.useEffect(() => {
    if (!loading && gifts.length > 0) {
      setGiftVisible(true);
      setGiftIndex(0);
    }
  }, [loading, gifts.length]);

  React.useEffect(() => {
    if (!loading && poll && !voted && !giftVisible && gifts.length === 0) {
      setPollVisible(true);
    }
  }, [loading, poll?.id, voted, giftVisible, gifts.length]);

  const openPremium = async () => {
    setShowPremiumModal(true);
    if (offerings) return;
    setLoadingOffers(true);
    try {
      const off = await getOfferings();
      setOfferings(off);
    } finally {
      setLoadingOffers(false);
    }
  };

  const handlePurchase = async (pkg: any) => {
    setBuying(pkg.identifier);
    const ok = await purchasePremium(pkg);
    setBuying(null);
    if (ok) {
      setShowPremiumModal(false);
      Toast.show({ type: 'success', text2: 'Premium aktywne' });
    }
  };

  if (loading || !user) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg, alignItems: 'center', justifyContent: 'center', gap: 10 }}>
        <MaterialCommunityIcons name="car-sports" size={48} color={theme.primary} />
        <ActivityIndicator color={theme.primary} />
      </View>
    );
  }

  return (
    <>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor="transparent" translucent />
      <View style={{ flex: 1 }}>
        <ScrollView
          style={{ flex: 1, backgroundColor: theme.bg }}
          contentContainerStyle={{ paddingBottom: 40 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadUser(); }} tintColor={theme.primary} />}
          showsVerticalScrollIndicator={false}
        >
          <LinearGradient
            colors={isDark ? ['#1f0606', '#0e0e12', theme.bg] : ['#fff1f1', '#f6f7fb', theme.bg]}
            style={{ paddingTop: 64, paddingHorizontal: 18, paddingBottom: 22, borderBottomLeftRadius: 28, borderBottomRightRadius: 28 }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <View>
                <Text style={{ color: theme.textDim, fontFamily: 'Orbitron', fontSize: 8, letterSpacing: 3 }}>VROOM COMMAND</Text>
                <Text style={{ color: theme.text, fontFamily: 'Orbitron', fontSize: 26, marginTop: 7 }}>{user.username}</Text>
              </View>
              <TouchableOpacity
                onPress={() => router.push('/(tabs)/account')}
                style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border2, alignItems: 'center', justifyContent: 'center' }}
              >
                <MaterialIcons name="person" size={22} color={theme.primary} />
              </TouchableOpacity>
            </View>
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 14 }}>
              <StatCard label="KM TOTAL" value={`${Math.round(user.totalDistance)}`} isDark={isDark} />
              <StatCard label="RIDES" value={`${user.totalRides}`} isDark={isDark} />
              <StatCard label="TOP KM/H" value={`${Math.round(user.topSpeed)}`} isDark={isDark} />
            </View>
          </LinearGradient>

          <View style={{ paddingHorizontal: 16, marginTop: 14, gap: 12 }}>
            {effectivePremium ? (
              <Banner title="PREMIUM AKTYWNE" subtitle="Wszystkie funkcje odblokowane" color={GOLD} />
            ) : (
              <TouchableOpacity onPress={openPremium} activeOpacity={0.85}>
                <Banner title="ODBLOKUJ PREMIUM" subtitle="Więcej statystyk, historia i personalizacja" color={theme.primary} />
              </TouchableOpacity>
            )}

            {!effectivePremium && (
              <AdBanner BANNERID="ca-app-pub-1660420496578702/2956669151" />
            )}

            <SectionTitle text="Szybkie akcje" />
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <QuickSquare icon="map" label="Mapa" onPress={() => router.push('/map')} theme={theme} />
              <QuickSquare icon="person" label="Profil" onPress={() => router.push('/(tabs)/account')} theme={theme} />
              <QuickSquare icon="groups" label="Social" onPress={() => router.push('/(tabs)/community')} theme={theme} />
            </View>

            <SectionTitle text="Dashboard" />
            <QuickTile icon="timeline" title="Dystans miesięczny" subtitle={`${Math.round(user.monthlyDistance || 0)} km w tym miesiącu`} onPress={() => router.push('/(tabs)/account')} theme={theme} />
            <QuickTile icon="speed" title="Średnia prędkość" subtitle={`${Math.round(Number(user.avgSpeed || 0))} km/h · streak ${user.streak || 0}`} onPress={() => router.push('/(tabs)/account')} theme={theme} />
            <QuickTile icon="campaign" title={`Ogłoszenia ${unseenCount > 0 ? `(${unseenCount})` : ''}`} subtitle="Nowości i komunikaty aplikacji" onPress={() => setShowAnnouncements(true)} theme={theme} />
          </View>
        </ScrollView>
      </View>

      {poll && (
        <PollModal
          visible={pollVisible}
          poll={poll}
          onVote={(optionIdx) => vote(poll.id, optionIdx)}
          onClose={() => setPollVisible(false)}
        />
      )}
      {gifts[giftIndex] && (
        <GiftModal
          visible={giftVisible}
          gift={gifts[giftIndex]}
          onClaim={claimGift}
          onClose={() => {
            const next = giftIndex + 1;
            if (next < gifts.length) setGiftIndex(next);
            else setGiftVisible(false);
          }}
        />
      )}
      <AnnouncementsModal visible={showAnnouncements} onClose={() => setShowAnnouncements(false)} />
      <UpdateModal visible={updateAvailable} loading={downloading} onUpdate={applyUpdate} onDismiss={dismiss} />

      <Modal visible={showPremiumModal} transparent animationType="slide" onRequestClose={() => setShowPremiumModal(false)}>
        <View style={{ flex: 1, backgroundColor: '#000000aa', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: theme.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 16 }}>
            <Text style={{ fontFamily: 'Orbitron', color: theme.text, fontSize: 13, marginBottom: 10 }}>VROOM PREMIUM</Text>
            {loadingOffers ? (
              <ActivityIndicator color={theme.primary} />
            ) : (
              (offerings?.current?.availablePackages ?? []).map((pkg: any) => (
                <TouchableOpacity
                  key={pkg.identifier}
                  onPress={() => handlePurchase(pkg)}
                  style={{ backgroundColor: theme.surface2, borderWidth: 1, borderColor: theme.border2, borderRadius: 12, padding: 12, marginBottom: 8, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}
                >
                  <Text style={{ color: theme.text, fontFamily: 'Orbitron', fontSize: 10 }}>{pkg.product?.title ?? pkg.identifier}</Text>
                  <Text style={{ color: theme.primary, fontFamily: 'Orbitron', fontSize: 10 }}>{buying === pkg.identifier ? '...' : pkg.product?.priceString ?? ''}</Text>
                </TouchableOpacity>
              ))
            )}
            <TouchableOpacity onPress={restorePurchases} style={{ paddingVertical: 10 }}>
              <Text style={{ color: theme.textDim, fontFamily: 'Orbitron', fontSize: 9, textAlign: 'center' }}>Przywróć zakupy</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </>
  );
}

function SectionTitle({ text }: { text: string }) {
  return <Text style={{ fontFamily: 'Orbitron', fontSize: 8, letterSpacing: 3, color: '#888', marginTop: 8 }}>{text}</Text>;
}

function StatCard({ label, value, isDark }: { label: string; value: string; isDark: boolean }) {
  return (
    <View style={{ flex: 1, backgroundColor: isDark ? '#ffffff10' : '#ffffffdd', borderRadius: 12, borderWidth: 1, borderColor: isDark ? '#ffffff20' : '#00000012', paddingVertical: 10, alignItems: 'center' }}>
      <Text style={{ color: isDark ? '#fff' : '#121212', fontFamily: 'Orbitron', fontSize: 14 }}>{value}</Text>
      <Text style={{ color: isDark ? '#ffffff90' : '#00000070', fontFamily: 'Orbitron', fontSize: 7 }}>{label}</Text>
    </View>
  );
}

function Banner({ title, subtitle, color }: { title: string; subtitle: string; color: string }) {
  return (
    <View style={{ backgroundColor: `${color}12`, borderWidth: 1, borderColor: `${color}44`, borderRadius: 14, padding: 12 }}>
      <Text style={{ color, fontFamily: 'Orbitron', fontSize: 10 }}>{title}</Text>
      <Text style={{ color: '#aaa', fontFamily: 'Orbitron', fontSize: 8, marginTop: 4 }}>{subtitle}</Text>
    </View>
  );
}

function QuickTile({ icon, title, subtitle, onPress, theme }: { icon: keyof typeof MaterialIcons.glyphMap; title: string; subtitle: string; onPress: () => void; theme: any }) {
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.85} style={{ backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border2, borderRadius: 14, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      <View style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: `${theme.primary}20`, alignItems: 'center', justifyContent: 'center' }}>
        <MaterialIcons name={icon} size={18} color={theme.primary} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ color: theme.text, fontFamily: 'Orbitron', fontSize: 10 }}>{title}</Text>
        <Text style={{ color: theme.textDim, fontFamily: 'Orbitron', fontSize: 8, marginTop: 2 }}>{subtitle}</Text>
      </View>
      <MaterialIcons name="arrow-forward-ios" size={12} color={theme.textDim} />
    </TouchableOpacity>
  );
}

function QuickSquare({ icon, label, onPress, theme }: { icon: keyof typeof MaterialIcons.glyphMap; label: string; onPress: () => void; theme: any }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.85}
      style={{ flex: 1, backgroundColor: theme.surface, borderRadius: 14, borderWidth: 1, borderColor: theme.border2, paddingVertical: 14, alignItems: 'center', justifyContent: 'center', gap: 6 }}
    >
      <MaterialIcons name={icon} size={20} color={theme.primary} />
      <Text style={{ color: theme.text, fontFamily: 'Orbitron', fontSize: 9 }}>{label}</Text>
    </TouchableOpacity>
  );
}
