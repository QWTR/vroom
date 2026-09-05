import React, { memo, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import { AppText as Text } from '../ui/AppText';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { API_URL } from '../../constants/config';
import type { User } from '../../constants/types';
import type { UserShopCosmetics } from '../../constants/shopCosmetics';
import type { ProfilePremiumExtras } from '../../constants/profilePremiumExtras';
import { mergeProfilePremiumExtras } from '../../constants/profilePremiumExtras';
import { hasValidCustomHeroColors, resolveProfilePalette } from '../../constants/profileThemes';
import { useTheme } from '../../contexts/ThemeContext';
import { useModalBackHandler } from '../../hooks/useModalBackHandler';
import { normalizeMediaUri } from '../../lib/mediaUri';
import { ProfileHeroBannerFrame } from '../profile/ProfileHeroBannerFrame';
import { ShopAvatarDecoration } from '../shop/ShopAvatarDecoration';
import { PremiumAvatar, PremiumName, type PublicUserIdentity } from '../user/PremiumIdentity';
import { UserBadges } from '../user/UserBadges';

interface UserInfoModalProps {
  visible: boolean;
  user: User | null;
  distance: number;
  onNavigate: () => void;
  onClose: () => void;
  onViewProfile: () => void;
  onMessage: () => void;
}

type ProfileVisuals = {
  bannerUrl: string | null;
  nickColor: string | null;
  profileThemePreset: string;
  profilePremiumExtras: ProfilePremiumExtras;
  isPremiumProfile: boolean;
  isAdmin: boolean;
};

const HEX = /^#[0-9A-Fa-f]{6}$/;

const PRESET_GRADIENTS: Record<string, [string, string, string]> = {
  default: ['#241010', '#120A0D', '#08090C'],
  midnight: ['#172554', '#0B1227', '#070911'],
  sunset: ['#7C2D12', '#3B1010', '#09090B'],
  neon: ['#064E3B', '#072A22', '#070B0A'],
  royal: ['#4C1D95', '#241044', '#09070E'],
  cyber: ['#0E7490', '#102A56', '#070A12'],
  gold: ['#854D0E', '#35220A', '#0B0905'],
  forest: ['#166534', '#0D2B19', '#070B08'],
  custom: ['#312E81', '#23153D', '#08080C'],
};

const PRESET_LABELS: Record<string, string> = {
  default: 'VROOM',
  midnight: 'MIDNIGHT',
  sunset: 'SUNSET',
  neon: 'NEON',
  royal: 'ROYAL',
  cyber: 'CYBER',
  gold: 'GOLD',
  forest: 'FOREST',
  custom: 'WŁASNY',
};

function safeAccent(value: unknown, fallback: string): string {
  return typeof value === 'string' && HEX.test(value.trim()) ? value.trim().toUpperCase() : fallback;
}

function formatDistance(distance: number): string {
  if (!Number.isFinite(distance) || distance < 0) return '0 m';
  if (distance < 1) return `${Math.round(distance * 1000)} m`;
  if (distance >= 100) return `${Math.round(distance)} km`;
  return `${distance.toFixed(1)} km`;
}

export const UserInfoModal = memo(function UserInfoModal({
  visible,
  user,
  distance,
  onNavigate,
  onClose,
  onViewProfile,
  onMessage,
}: UserInfoModalProps) {
  const { theme } = useTheme();
  const [shopCosmetics, setShopCosmetics] = useState<UserShopCosmetics | null>(null);
  const [profileVisuals, setProfileVisuals] = useState<ProfileVisuals | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(false);

  useEffect(() => {
    let active = true;
    if (!visible || !user?.id) {
      setShopCosmetics(null);
      setProfileVisuals(null);
      setLoadingProfile(false);
      return () => { active = false; };
    }

    setShopCosmetics(null);
    setProfileVisuals(null);
    setLoadingProfile(true);
    void (async () => {
      try {
        const token = await AsyncStorage.getItem('userToken') ?? await AsyncStorage.getItem('token');
        const res = await fetch(`${API_URL}/api/profile/${user.id}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        });
        if (!res.ok) return;
        const data = await res.json();
        if (!active) return;
        const isPremiumProfile = data?.isPremium === true;
        setShopCosmetics(isPremiumProfile ? (data?.shopCosmetics ?? null) : null);
        setProfileVisuals({
          bannerUrl: isPremiumProfile ? normalizeMediaUri(data?.bannerUrl) : null,
          nickColor: isPremiumProfile && typeof data?.nickColor === 'string' ? data.nickColor : null,
          profileThemePreset: isPremiumProfile && typeof data?.profileThemePreset === 'string'
            ? data.profileThemePreset
            : 'default',
          profilePremiumExtras: mergeProfilePremiumExtras(
            isPremiumProfile ? data?.profilePremiumExtras : null,
          ),
          isPremiumProfile,
          isAdmin: data?.isAdmin === true,
        });
      } catch {
        if (active) {
          setShopCosmetics(null);
          setProfileVisuals(null);
        }
      } finally {
        if (active) setLoadingProfile(false);
      }
    })();

    return () => { active = false; };
  }, [visible, user?.id]);

  useModalBackHandler(visible, onClose);

  const identityIsPremium = profileVisuals
    ? profileVisuals.isPremiumProfile
    : user?.isPremium === true;
  const isAdmin = profileVisuals?.isAdmin ?? user?.isAdmin ?? false;
  const preset = identityIsPremium
    ? (profileVisuals?.profileThemePreset || user?.premiumVisual?.preset || 'default')
    : 'default';
  const extras = profileVisuals?.profilePremiumExtras ?? mergeProfilePremiumExtras(null);
  const accentA = safeAccent(
    profileVisuals?.nickColor || user?.premiumVisual?.accentColors?.[0],
    identityIsPremium ? '#FFD447' : theme.primary,
  );
  const accentB = safeAccent(user?.premiumVisual?.accentColors?.[1], '#7AA2FF');
  const profilePalette = useMemo(
    () => resolveProfilePalette(identityIsPremium ? preset : 'default', {
      isDark: true,
      customHeroGradient: extras.customHeroGradient,
      applySavedCustomTint: identityIsPremium,
    }),
    [extras.customHeroGradient, identityIsPremium, preset],
  );

  if (!user) return null;

  const avatarUri = normalizeMediaUri(user.avatar);
  const avatarFrameUri = normalizeMediaUri(user.avatarFrameUrl);
  const shopBannerUri = identityIsPremium
    ? normalizeMediaUri(shopCosmetics?.profileBanner?.assetUrl)
    : null;
  const bannerUri = shopBannerUri || profileVisuals?.bannerUrl || null;
  const customColors = identityIsPremium && hasValidCustomHeroColors(extras.customHeroGradient)
    ? extras.customHeroGradient!.colors.filter((color) => typeof color === 'string' && HEX.test(color)).slice(0, 3)
    : [];
  const fallbackGradient = PRESET_GRADIENTS[preset] ?? PRESET_GRADIENTS.default;
  const heroGradientColors = (customColors.length >= 2 ? customColors : fallbackGradient) as [string, string, ...string[]];
  const isOnline = user.status === 'Online';
  const identity: PublicUserIdentity = {
    id: Number(user.id),
    username: user.name || 'Kierowca',
    avatarUrl: avatarUri,
    isPremium: identityIsPremium,
    isAdmin,
    premiumVisual: identityIsPremium
      ? (user.premiumVisual ?? {
          preset,
          accentColors: [accentA, accentB],
          nickColor: accentA,
          avatarFramePreset: 'vroom',
          ringGradient: { colors: [accentA, accentB] },
          ringAnimation: 'pulse',
          visualVersion: `card-${preset}-${accentA}-${accentB}`,
        })
      : null,
  };
  const cardSurface = identityIsPremium ? profilePalette.bg : theme.surface;
  const statSurface = identityIsPremium ? profilePalette.surface : theme.surface2;
  const borderColor = identityIsPremium ? `${accentA}55` : theme.border2;
  const primaryAction = identityIsPremium ? accentA : theme.primary;
  const primaryText = identityIsPremium && ['#FFD447', '#F5C518', '#EAB308', '#4DE926', '#4ADE80'].includes(primaryAction)
    ? '#080808'
    : '#FFFFFF';

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose} statusBarTranslucent>
      <SafeAreaView style={localStyles.overlay} edges={['bottom']}>
        <TouchableOpacity
          style={[StyleSheet.absoluteFill, { backgroundColor: theme.overlay }]}
          activeOpacity={1}
          onPress={onClose}
          accessibilityLabel="Zamknij kartę użytkownika"
        />

        <View
          style={[
            localStyles.card,
            {
              backgroundColor: cardSurface,
              borderColor,
              shadowColor: identityIsPremium ? accentA : '#000000',
            },
          ]}
        >
          <View style={localStyles.hero}>
            <ProfileHeroBannerFrame
              uri={bannerUri}
              gradient={{
                colors: heroGradientColors,
                start: extras.customHeroGradient?.start ?? { x: 0, y: 0 },
                end: extras.customHeroGradient?.end ?? { x: 1, y: 1 },
              }}
              focusPoint={shopBannerUri ? 'center' : extras.bannerFocusPoint}
              fixedHeight={196}
            />
            <LinearGradient
              colors={['#00000010', `${accentA}2C`, cardSurface]}
              locations={[0, 0.56, 1]}
              style={StyleSheet.absoluteFill}
            />

            <View style={localStyles.handle} />
            <View style={localStyles.heroTopRow}>
              <View style={[localStyles.livePill, { borderColor: `${isOnline ? theme.online : '#9CA3AF'}66` }]}>
                <View style={[localStyles.statusDot, { backgroundColor: isOnline ? theme.online : '#9CA3AF' }]} />
                <Text style={localStyles.livePillText}>{isOnline ? 'LIVE NA MAPIE' : 'POZA SIECIĄ'}</Text>
              </View>
              <TouchableOpacity
                style={localStyles.closeButton}
                onPress={onClose}
                accessibilityRole="button"
                accessibilityLabel="Zamknij"
              >
                <MaterialIcons name="close" size={22} color="#FFFFFF" />
              </TouchableOpacity>
            </View>

            <View style={localStyles.identityRow}>
              <View style={localStyles.avatarSlot}>
                <PremiumAvatar user={identity} size={72} representative />
                {!shopCosmetics?.avatarFrame && avatarFrameUri ? (
                  <Image
                    source={{ uri: avatarFrameUri }}
                    style={localStyles.legacyAvatarFrame}
                    resizeMode="contain"
                  />
                ) : null}
                <ShopAvatarDecoration item={shopCosmetics?.avatarFrame} size={72} />
              </View>

              <View style={localStyles.identityText}>
                <PremiumName user={identity} style={localStyles.name} numberOfLines={1} />
                <View style={localStyles.badgesRow}>
                  <UserBadges isAdmin={isAdmin} isPremium={identityIsPremium} />
                  {identityIsPremium ? (
                    <View style={[localStyles.themePill, { borderColor: `${accentA}88`, backgroundColor: `${accentA}20` }]}>
                      <MaterialIcons name="auto-awesome" size={11} color={accentA} />
                      <Text style={[localStyles.themePillText, { color: accentA }]}>
                        {PRESET_LABELS[preset] ?? preset.toUpperCase()}
                      </Text>
                    </View>
                  ) : null}
                </View>
              </View>
            </View>
          </View>

          <View style={localStyles.body}>
            {loadingProfile ? (
              <View style={localStyles.loadingRow}>
                <ActivityIndicator size="small" color={accentA} />
                <Text style={[localStyles.loadingText, { color: identityIsPremium ? profilePalette.textDim : theme.textDim }]}>WCZYTUJĘ WYGLĄD PROFILU</Text>
              </View>
            ) : null}

            <View style={localStyles.statsRow}>
              <View style={[localStyles.statCard, { backgroundColor: statSurface, borderColor }]}>
                <View style={[localStyles.statIcon, { backgroundColor: `${accentA}18`, borderColor: `${accentA}40` }]}>
                  <MaterialIcons name="near-me" size={17} color={accentA} />
                </View>
                <View style={localStyles.statCopy}>
                  <Text style={[localStyles.statLabel, { color: identityIsPremium ? profilePalette.textDim : theme.textDim }]}>OD CIEBIE</Text>
                  <Text style={[localStyles.statValue, { color: identityIsPremium ? profilePalette.text : theme.text }]}>{formatDistance(distance)}</Text>
                </View>
              </View>

              <View style={[localStyles.statCard, { backgroundColor: statSurface, borderColor }]}>
                <View style={[localStyles.statIcon, { backgroundColor: isOnline ? `${theme.online}18` : `${theme.textDim}18`, borderColor: isOnline ? `${theme.online}40` : theme.border2 }]}>
                  <MaterialIcons name={isOnline ? 'location-on' : 'location-off'} size={17} color={isOnline ? theme.online : theme.textDim} />
                </View>
                <View style={localStyles.statCopy}>
                  <Text style={[localStyles.statLabel, { color: identityIsPremium ? profilePalette.textDim : theme.textDim }]}>POZYCJA</Text>
                  <Text style={[localStyles.statValueSmall, { color: isOnline ? theme.online : theme.textDim }]}>{isOnline ? 'UDOSTĘPNIANA' : 'NIEAKTYWNA'}</Text>
                </View>
              </View>
            </View>

            {user.isFriend ? (
              <View style={localStyles.friendRow}>
                <MaterialIcons name="favorite" size={14} color="#FF6B9D" />
                <Text style={localStyles.friendText}>TEN KIEROWCA JEST W TWOICH ZNAJOMYCH</Text>
              </View>
            ) : null}

            <View style={localStyles.actionsRow}>
              <TouchableOpacity
                style={[localStyles.primaryButton, { backgroundColor: primaryAction, shadowColor: primaryAction }]}
                onPress={onNavigate}
                activeOpacity={0.82}
                accessibilityRole="button"
                accessibilityLabel={`Jedź do ${user.name}`}
              >
                <MaterialIcons name="navigation" size={21} color={primaryText} />
                <Text style={[localStyles.primaryButtonText, { color: primaryText }]}>JEDŹ</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[localStyles.secondaryButton, { backgroundColor: `${accentA}12`, borderColor: `${accentA}55` }]}
                onPress={onMessage}
                activeOpacity={0.82}
                accessibilityRole="button"
                accessibilityLabel={`Napisz do ${user.name}`}
              >
                <MaterialIcons name="chat-bubble-outline" size={20} color={accentA} />
                <Text style={[localStyles.secondaryButtonText, { color: accentA }]}>NAPISZ</Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              style={[localStyles.profileButton, { backgroundColor: statSurface, borderColor }]}
              onPress={onViewProfile}
              activeOpacity={0.82}
              accessibilityRole="button"
              accessibilityLabel={`Otwórz profil ${user.name}`}
            >
              <MaterialIcons name="person-outline" size={20} color={identityIsPremium ? profilePalette.text : theme.text} />
              <Text style={[localStyles.profileButtonText, { color: identityIsPremium ? profilePalette.text : theme.text }]}>ZOBACZ PEŁNY PROFIL</Text>
              <MaterialIcons name="chevron-right" size={22} color={identityIsPremium ? profilePalette.textDim : theme.textMuted} />
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>
    </Modal>
  );
});

const localStyles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end' },
  card: {
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    borderWidth: 1,
    borderBottomWidth: 0,
    overflow: 'hidden',
    elevation: 24,
    shadowOffset: { width: 0, height: -6 },
    shadowOpacity: 0.35,
    shadowRadius: 18,
  },
  hero: { height: 196, overflow: 'hidden' },
  handle: { position: 'absolute', top: 10, alignSelf: 'center', width: 44, height: 4, borderRadius: 3, backgroundColor: '#FFFFFF55' },
  heroTopRow: { position: 'absolute', top: 24, left: 18, right: 18, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  livePill: { flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: '#050608B8', borderWidth: 1, borderRadius: 999, paddingHorizontal: 11, paddingVertical: 7 },
  livePillText: { color: '#FFFFFF', fontFamily: 'Orbitron', fontSize: 8, letterSpacing: 1.2, fontWeight: '700' },
  statusDot: { width: 7, height: 7, borderRadius: 4 },
  closeButton: { width: 40, height: 40, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: '#050608B8', borderWidth: 1, borderColor: '#FFFFFF22' },
  identityRow: { position: 'absolute', left: 18, right: 18, bottom: 14, flexDirection: 'row', alignItems: 'center', gap: 14 },
  avatarSlot: { width: 82, height: 82, alignItems: 'center', justifyContent: 'center' },
  legacyAvatarFrame: { position: 'absolute', width: 82, height: 82 },
  identityText: { flex: 1, minWidth: 0, gap: 7 },
  name: { color: '#FFFFFF', fontSize: 23, fontFamily: 'Orbitron', fontWeight: '800', letterSpacing: 0.4 },
  badgesRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  themePill: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderRadius: 999, paddingHorizontal: 7, paddingVertical: 3 },
  themePillText: { fontFamily: 'Manrope_700Bold', fontSize: 8, letterSpacing: 0.8 },
  body: { paddingHorizontal: 18, paddingTop: 14, paddingBottom: 18, gap: 12 },
  loadingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 18 },
  loadingText: { fontFamily: 'Orbitron', fontSize: 7, letterSpacing: 1.2 },
  statsRow: { flexDirection: 'row', gap: 10 },
  statCard: { flex: 1, minHeight: 82, borderRadius: 17, borderWidth: 1, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 10 },
  statIcon: { width: 35, height: 35, borderRadius: 11, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  statCopy: { flex: 1, minWidth: 0, gap: 5 },
  statLabel: { fontFamily: 'Orbitron', fontSize: 7, letterSpacing: 1.3 },
  statValue: { fontFamily: 'Orbitron', fontSize: 15, fontWeight: '800' },
  statValueSmall: { fontFamily: 'Orbitron', fontSize: 9, fontWeight: '800', letterSpacing: 0.2 },
  friendRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingVertical: 2 },
  friendText: { color: '#FF8DB3', fontFamily: 'Orbitron', fontSize: 7, letterSpacing: 0.9 },
  actionsRow: { flexDirection: 'row', gap: 10 },
  primaryButton: { flex: 1, height: 54, borderRadius: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, elevation: 5, shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.3, shadowRadius: 7 },
  primaryButtonText: { fontFamily: 'Orbitron', fontSize: 10, fontWeight: '800', letterSpacing: 1.5 },
  secondaryButton: { flex: 1, height: 54, borderRadius: 16, borderWidth: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9 },
  secondaryButtonText: { fontFamily: 'Orbitron', fontSize: 10, fontWeight: '800', letterSpacing: 1.3 },
  profileButton: { height: 50, borderRadius: 16, borderWidth: 1, paddingHorizontal: 15, flexDirection: 'row', alignItems: 'center', gap: 10 },
  profileButtonText: { flex: 1, fontFamily: 'Orbitron', fontSize: 9, fontWeight: '700', letterSpacing: 1.1 },
});
