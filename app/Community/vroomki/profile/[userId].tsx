import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  FlatList,
  Image,
  Pressable,
  RefreshControl,
  Share,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LinearGradient } from 'expo-linear-gradient';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import Toast from 'react-native-toast-message';
import { API_URL } from '../../../../constants/config';
import { hasValidCustomHeroColors, resolveProfilePalette } from '../../../../constants/profileThemes';
import { mergeProfilePremiumExtras, type ProfileGradientSpec, type ProfilePremiumExtras } from '../../../../constants/profilePremiumExtras';
import type { UserShopCosmetics } from '../../../../constants/shopCosmetics';
import { ShopAvatarDecoration } from '../../../../components/shop/ShopAvatarDecoration';
import type { VroomkiPost } from '../../community/communityShared';

type VroomkiProfileResponse = {
  user: {
    id: number;
    username: string;
    avatarUrl: string | null;
    bio?: string | null;
    isPremium?: boolean;
    isAdmin?: boolean;
    nickColor?: string | null;
    bannerUrl?: string | null;
    profileThemePreset?: string | null;
    avatarFramePreset?: string | null;
    profilePremiumExtras?: ProfilePremiumExtras | null;
    shopCosmetics?: UserShopCosmetics | null;
  };
  stats: {
    followersCount: number;
    followingCount: number;
    likesCount: number;
    postsCount: number;
  };
  isOwner: boolean;
  isFollowing: boolean;
  posts: VroomkiPost[];
};

const GRID_GAP = 1;
const { width: SCREEN_W } = Dimensions.get('window');

function gradientFromSpec(spec: ProfileGradientSpec | null | undefined, fallback: string[]) {
  const colors = (spec?.colors?.length ?? 0) >= 2 ? spec!.colors : fallback;
  if (colors.length < 2) return null;
  return {
    colors: colors as [string, string, ...string[]],
    start: spec?.start ?? { x: 0.12, y: 0 },
    end: spec?.end ?? { x: 1, y: 1 },
  };
}

function avatarRingColors(preset: string | null | undefined, premiumUi: ProfilePremiumExtras | null) {
  if ((premiumUi?.avatarRingGradient?.colors?.length ?? 0) >= 2) {
    return premiumUi!.avatarRingGradient!.colors as [string, string, ...string[]];
  }
  switch (preset) {
    case 'sunrise':
      return ['#ff6b35', '#f5c518', '#ff6b35'] as [string, string, ...string[]];
    case 'ocean':
      return ['#38a5e3', '#1b6eff', '#38a5e3'] as [string, string, ...string[]];
    case 'lime':
      return ['#4de926', '#a6ff4d', '#4de926'] as [string, string, ...string[]];
    case 'vroom':
    default:
      return ['#e33835', '#268bff', '#4de926', '#e33835'] as [string, string, ...string[]];
  }
}

async function getToken() {
  return (await AsyncStorage.getItem('userToken')) ?? (await AsyncStorage.getItem('token'));
}

function formatCount(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1).replace('.', ',')} mln`;
  if (value >= 1000) return `${(value / 1000).toFixed(value >= 10_000 ? 0 : 1).replace('.', ',')} tys.`;
  return String(value);
}

export default function VroomkiProfileScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ userId?: string }>();
  const userId = Number(params.userId);

  const [data, setData] = useState<VroomkiProfileResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [followingBusy, setFollowingBusy] = useState(false);

  const tileSize = useMemo(() => {
    return Math.floor((SCREEN_W - GRID_GAP * 2) / 3);
  }, []);

  const premiumUi = useMemo(
    () => data?.user.isPremium ? mergeProfilePremiumExtras(data.user.profilePremiumExtras) : null,
    [data?.user.isPremium, data?.user.profilePremiumExtras],
  );

  const palette = useMemo(() => {
    const preset = data?.user.profileThemePreset ?? 'default';
    return resolveProfilePalette(data?.user.isPremium ? preset : 'default', {
      isDark: true,
      customHeroGradient: premiumUi?.customHeroGradient ?? null,
      applySavedCustomTint:
        !!data?.user.isPremium &&
        preset === 'custom' &&
        hasValidCustomHeroColors(premiumUi?.customHeroGradient),
    });
  }, [data?.user.isPremium, data?.user.profileThemePreset, premiumUi?.customHeroGradient]);

  const loadProfile = useCallback(async (isRefresh = false) => {
    if (!Number.isFinite(userId)) return;
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    try {
      const token = await getToken();
      const res = await fetch(`${API_URL}/api/vroomki/profile/${userId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? 'Nie udalo sie zaladowac profilu');
      setData(body as VroomkiProfileResponse);
    } catch (e: any) {
      Toast.show({ type: 'error', text1: 'Profil VROOMKI', text2: e?.message ?? 'Blad ladowania' });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [userId]);

  useEffect(() => {
    void loadProfile();
  }, [loadProfile]);

  const toggleFollow = useCallback(async () => {
    if (!data || data.isOwner || followingBusy) return;
    setFollowingBusy(true);
    const nextFollowing = !data.isFollowing;
    setData((prev) => prev ? {
      ...prev,
      isFollowing: nextFollowing,
      stats: {
        ...prev.stats,
        followersCount: Math.max(0, prev.stats.followersCount + (nextFollowing ? 1 : -1)),
      },
    } : prev);

    try {
      const token = await getToken();
      const res = await fetch(`${API_URL}/api/follow/${data.user.id}`, {
        method: nextFollowing ? 'POST' : 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error();
    } catch {
      setData((prev) => prev ? {
        ...prev,
        isFollowing: !nextFollowing,
        stats: {
          ...prev.stats,
          followersCount: Math.max(0, prev.stats.followersCount + (nextFollowing ? -1 : 1)),
        },
      } : prev);
      Toast.show({ type: 'error', text1: 'Nie udalo sie zmienic obserwacji' });
    } finally {
      setFollowingBusy(false);
    }
  }, [data, followingBusy]);

  const shareProfile = useCallback(async () => {
    if (!data) return;
    await Share.share({
      message: `Zobacz profil VROOMKI @${data.user.username} w VROOM`,
    });
  }, [data]);

  const openPost = useCallback((postId: number) => {
    if (!data?.user.id) return;
    router.push({
      pathname: '/Community/vroomki',
      params: { vroomkiId: String(postId), userId: String(data.user.id) },
    } as any);
  }, [data?.user.id, router]);

  const header = useMemo(() => {
    if (!data) return null;
    const avatar = data.user.avatarUrl;
    const displayName = data.user.username;
    const shopCosmetics = data.user.shopCosmetics ?? null;
    const bannerUri = shopCosmetics?.profileBanner?.assetUrl ?? data.user.bannerUrl ?? null;
    const heroGradient = gradientFromSpec(
      premiumUi?.customHeroGradient ?? null,
      [palette.surfaceAlt, palette.bg, '#050505'],
    );
    const nickColor = data.user.nickColor ?? '#fff';
    const ringColors = avatarRingColors(data.user.avatarFramePreset, premiumUi);

    return (
      <View style={[styles.header, { backgroundColor: palette.bg }]}>
        <View style={styles.heroBg} pointerEvents="none">
          {bannerUri ? (
            <Image source={{ uri: bannerUri }} style={StyleSheet.absoluteFillObject} />
          ) : heroGradient ? (
            <LinearGradient
              colors={heroGradient.colors}
              start={heroGradient.start}
              end={heroGradient.end}
              style={StyleSheet.absoluteFillObject}
            />
          ) : null}
          <LinearGradient
            colors={['#00000055', `${palette.bg}AA`, palette.bg]}
            style={StyleSheet.absoluteFillObject}
          />
        </View>
        <View style={styles.topBar}>
          <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn}>
            <MaterialIcons name="arrow-back" size={26} color="#fff" />
          </TouchableOpacity>
          <View style={styles.topActions}>
            <TouchableOpacity style={styles.iconBtn} onPress={() => Toast.show({ type: 'info', text1: 'Powiadomienia', text2: 'Wkrotce' })}>
              <MaterialCommunityIcons name="bell-outline" size={24} color="#fff" />
            </TouchableOpacity>
            <TouchableOpacity style={styles.iconBtn} onPress={shareProfile}>
              <MaterialIcons name="share" size={24} color="#fff" />
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.avatarWrap}>
          <LinearGradient
            colors={ringColors}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.avatarRing}
          />
          <View style={styles.avatarInner}>
            {avatar ? (
              <Image source={{ uri: avatar }} style={styles.avatar} />
            ) : (
              <View style={[styles.avatar, styles.avatarFallback]}>
                <MaterialIcons name="person" size={44} color="#777" />
              </View>
            )}
            <ShopAvatarDecoration item={shopCosmetics?.avatarFrame} size={96} />
          </View>
        </View>

        <Text style={[styles.username, { color: nickColor }]}>{displayName}</Text>
        <Text style={styles.handle}>@{displayName}</Text>

        <View style={styles.statsRow}>
          <View style={styles.statBox}>
            <Text style={styles.statValue}>{formatCount(data.stats.followingCount)}</Text>
            <Text style={styles.statLabel}>Obserwowani</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={styles.statValue}>{formatCount(data.stats.followersCount)}</Text>
            <Text style={styles.statLabel}>Obserwujacych</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={styles.statValue}>{formatCount(data.stats.likesCount)}</Text>
            <Text style={styles.statLabel}>Polubienia</Text>
          </View>
        </View>

        <View style={styles.actionRow}>
          {data.isOwner ? (
            <>
              <TouchableOpacity style={styles.primaryAction} onPress={() => router.push('/(tabs)/account' as any)}>
                <MaterialIcons name="edit" size={18} color="#fff" />
                <Text style={styles.primaryActionText}>Edytuj profil</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.roundAction} onPress={shareProfile}>
                <MaterialIcons name="share" size={20} color="#fff" />
              </TouchableOpacity>
            </>
          ) : (
            <>
              <TouchableOpacity
                style={[styles.primaryAction, data.isFollowing && styles.secondaryAction]}
                onPress={toggleFollow}
                disabled={followingBusy}
              >
                <MaterialIcons name={data.isFollowing ? 'person' : 'person-add'} size={18} color="#fff" />
                <Text style={styles.primaryActionText}>{data.isFollowing ? 'Obserwujesz' : 'Obserwuj'}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.roundAction} onPress={() => Toast.show({ type: 'info', text1: 'Wiadomosc', text2: 'Otworz czat z glownego profilu' })}>
                <MaterialIcons name="send" size={20} color="#fff" />
              </TouchableOpacity>
              <TouchableOpacity style={styles.roundAction} onPress={shareProfile}>
                <MaterialIcons name="share" size={20} color="#fff" />
              </TouchableOpacity>
            </>
          )}
        </View>

        {!!data.user.bio && <Text style={styles.bio}>{data.user.bio}</Text>}

        <View style={[styles.tabsRow, { borderBottomColor: palette.borderStrong }]}>
          <View style={styles.activeTab}>
            <MaterialCommunityIcons name="grid" size={24} color="#fff" />
          </View>
        </View>
      </View>
    );
  }, [data, followingBusy, palette.bg, palette.borderStrong, palette.surfaceAlt, premiumUi, router, shareProfile, toggleFollow]);

  if (loading && !data) {
    return (
      <View style={styles.loading}>
        <StatusBar barStyle="light-content" />
        <ActivityIndicator color="#e33835" />
      </View>
    );
  }

  const posts = data?.posts ?? [];

  return (
    <View style={[styles.screen, { backgroundColor: palette.bg }]}>
      <StatusBar barStyle="light-content" />
      <FlatList
        data={posts}
        numColumns={3}
        keyExtractor={(item) => String(item.id)}
        ListHeaderComponent={header}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void loadProfile(true)} tintColor="#fff" />}
        ListEmptyComponent={
          <View style={styles.empty}>
            <MaterialCommunityIcons name="video-outline" size={42} color="#555" />
            <Text style={styles.emptyText}>Brak VROOMKI</Text>
          </View>
        }
        renderItem={({ item }) => {
          const thumb = item.videoThumbnailUrl ?? item.photos?.[0] ?? item.car?.photos?.[0] ?? null;
          return (
            <Pressable
              onPress={() => openPost(item.id)}
              style={[styles.tile, { width: tileSize, height: Math.round(tileSize * 1.42), backgroundColor: palette.surface }]}
            >
              {thumb ? (
                <Image source={{ uri: thumb }} style={StyleSheet.absoluteFillObject} />
              ) : (
                <View style={[StyleSheet.absoluteFillObject, styles.tileFallback]}>
                  <MaterialCommunityIcons name="video" size={26} color="#777" />
                </View>
              )}
              <View style={styles.tileShade} />
              <View style={styles.viewsBadge}>
                <MaterialCommunityIcons name="play" size={12} color="#fff" />
                <Text style={styles.viewsText}>{formatCount(item.viewsCount)}</Text>
              </View>
            </Pressable>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#050505' },
  loading: { flex: 1, backgroundColor: '#050505', alignItems: 'center', justifyContent: 'center' },
  header: { backgroundColor: '#050505', paddingBottom: 2, overflow: 'hidden' },
  heroBg: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 255,
  },
  topBar: {
    minHeight: 54,
    paddingHorizontal: 12,
    paddingTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  topActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  iconBtn: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  avatarWrap: { alignSelf: 'center', marginTop: 10, width: 108, height: 108, alignItems: 'center', justifyContent: 'center' },
  avatarRing: { position: 'absolute', width: 108, height: 108, borderRadius: 54 },
  avatarInner: { width: 96, height: 96 },
  avatar: { width: 96, height: 96, borderRadius: 48, borderWidth: 3, borderColor: '#050505' },
  avatarFallback: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#151515' },
  username: { color: '#fff', textAlign: 'center', fontSize: 23, fontWeight: '800', marginTop: 14 },
  handle: { color: '#a6a6a6', textAlign: 'center', fontSize: 14, marginTop: 2 },
  statsRow: { flexDirection: 'row', justifyContent: 'center', gap: 28, marginTop: 20 },
  statBox: { alignItems: 'center', minWidth: 76 },
  statValue: { color: '#fff', fontSize: 21, fontWeight: '900' },
  statLabel: { color: '#aaa', fontSize: 13, marginTop: 2 },
  actionRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 10, marginTop: 18 },
  primaryAction: {
    minWidth: 190,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#e33835',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 18,
  },
  secondaryAction: { backgroundColor: '#2d2d2d' },
  primaryActionText: { color: '#fff', fontSize: 16, fontWeight: '800' },
  roundAction: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#242424',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bio: { color: '#f1f1f1', textAlign: 'center', fontSize: 15, lineHeight: 21, marginTop: 16, paddingHorizontal: 34 },
  tabsRow: {
    height: 54,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#252525',
    marginTop: 22,
  },
  activeTab: {
    height: 54,
    minWidth: 54,
    alignItems: 'center',
    justifyContent: 'center',
    borderBottomWidth: 2,
    borderBottomColor: '#fff',
  },
  tile: { marginRight: GRID_GAP, marginBottom: GRID_GAP, backgroundColor: '#111', overflow: 'hidden' },
  tileFallback: { backgroundColor: '#141414', alignItems: 'center', justifyContent: 'center' },
  tileShade: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.08)' },
  viewsBadge: {
    position: 'absolute',
    left: 6,
    bottom: 5,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  viewsText: { color: '#fff', fontSize: 12, fontWeight: '700', textShadowColor: '#000', textShadowRadius: 4 },
  empty: { alignItems: 'center', paddingVertical: 60 },
  emptyText: { color: '#777', marginTop: 10, fontSize: 14 },
});
