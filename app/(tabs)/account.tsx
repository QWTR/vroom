import React, { useEffect, useState, useRef, useCallback } from 'react';
import { ActivityIndicator, View, Text, TouchableOpacity } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Toast from 'react-native-toast-message';
import { useTheme } from '../../contexts/ThemeContext';
import { useEffectivePremium } from '../../hooks/useEffectivePremium';

import { useProfile }      from '../../hooks/useProfile';
import { useCars }         from '../../hooks/useCars';
import { useAchievements } from '../../hooks/useAchievements';
import { useProfileSpots } from '../../hooks/useProfileSpots';
import { useMyRoutes }     from '../../hooks/useMyRoutes';
import ProfileView         from '../../components/profile/ProfileView';
import type { MyRoute }    from '../../hooks/useMyRoutes';
import { ShareRouteModal } from '../../components/modals/ShareRouteModal';
import { useParticipatedRoutes } from '../../hooks/useParticipatedRoutes';
import type { ParticipatedRoute } from '../../hooks/useParticipatedRoutes';
import { useSettings } from '../../contexts/SettingsContext';
import { mergeProfilePremiumExtras } from '../../constants/profilePremiumExtras';
import {
  BANNER_ASPECT,
  prepareBannerForUpload,
  uploadProfileBanner,
  deleteProfileBanner,
} from '../../lib/profileBanner';

const FREE_CAR_LIMIT = 3;

export default function ProfileScreen() {
  const router = useRouter();
  const { theme } = useTheme();
  const {
    profile,
    loading: pLoad,
    avatarLoading,
    fetchProfile,
    activityHistory,
    monthlyStats,
    monthlyCompare,
    fetchActivityHistory,
    fetchMonthlyStats,
  } = useProfile();
  const { isPremium: effectivePremium, refresh: refreshPremiumAccess } = useEffectivePremium(profile);
  const { settings, updateSetting, fetchSettings } = useSettings();
  const { cars,    loading: cLoad, fetchCars }                   = useCars();
  const { achievements, fetchMyAchievements }                    = useAchievements();
  const { spots,   loading: sLoad, fetchUserSpots }              = useProfileSpots();
  const { routes,  loading: rLoad, fetchMyRoutes, fetchRouteGeometry, deleteRoute }  = useMyRoutes();
  const { routes: participatedRoutes, loading: prLoad, fetchParticipated } = useParticipatedRoutes();

  const [shareRoute,          setShareRoute]          = useState<MyRoute | null>(null);
  const [myId,                setMyId]                = useState<number | null>(null);
  const [bannerLoading, setBannerLoading] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem('user').then(raw => {
      if (raw) setMyId(JSON.parse(raw).userId ?? null);
    });
  }, []);

  const handleLocationFriendsOnly = async (v: boolean) => {
    if (!effectivePremium) {
      router.push('/premium' as any);
      return;
    }
    const ok = await updateSetting('locationFriendsOnly', v);
    if (!ok) {
      Toast.show({ type: 'error', text1: 'Nie udało się zapisać ustawienia' });
    }
  };

  const handleBannerChange = async (mode?: 'delete') => {
    try {
      setBannerLoading(true);
      if (mode === 'delete') {
        const result = await deleteProfileBanner();
        if (result.ok) {
          await fetchProfile();
          Toast.show({ type: 'success', text1: '✅ Baner usunięty!' });
          return;
        }
        Toast.show({ type: 'error', text1: 'BŁĄD', text2: result.error ?? 'Spróbuj ponownie' });
        return;
      }
      const ImagePicker = await import('expo-image-picker');
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: BANNER_ASPECT,
        quality: 1,
      });
      if (result.canceled || !result.assets?.[0]) return;
      const focus = mergeProfilePremiumExtras(settings.profilePremiumExtras).bannerFocusPoint ?? 'center';
      const prepared = await prepareBannerForUpload(result.assets[0].uri, focus);
      const upload = await uploadProfileBanner(prepared.uri);
      if (!upload.ok) {
        Toast.show({ type: 'error', text1: 'BŁĄD', text2: upload.error });
        return;
      }
      await fetchProfile();
      Toast.show({ type: 'success', text1: '✅ Baner zaktualizowany!' });
    } catch {
      Toast.show({ type: 'error', text1: 'BŁĄD', text2: 'Brak połączenia' });
    } finally {
      setBannerLoading(false);
    }
  };

  useEffect(() => {
    (async () => {
      const raw = await AsyncStorage.getItem('user');
      if (!raw) { router.replace('/login'); return; }
      const localUser = JSON.parse(raw);
      const userId: number = localUser.userId ?? localUser.id;
      if (!userId) { router.replace('/login'); return; }
      void fetchProfile();
      await Promise.all([
        fetchCars(userId),
        fetchMyAchievements(),
        fetchUserSpots(userId),
        fetchMyRoutes({ includeGeometry: true }),
        fetchParticipated(),
      ]);
      setTimeout(() => {
        fetchActivityHistory({ includeRoute: true });
        fetchMonthlyStats();
      }, 400);
    })();
  }, []);

  const focusRefreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useFocusEffect(
    useCallback(() => {
      if (focusRefreshTimer.current) clearTimeout(focusRefreshTimer.current);
      focusRefreshTimer.current = setTimeout(() => {
        void refreshPremiumAccess();
        void fetchSettings();
        void fetchProfile();
        void fetchActivityHistory({ includeRoute: true });
        void fetchMonthlyStats();
      }, 300);
      return () => {
        if (focusRefreshTimer.current) clearTimeout(focusRefreshTimer.current);
      };
    }, [refreshPremiumAccess, fetchSettings, fetchProfile, fetchActivityHistory, fetchMonthlyStats]),
  );

  const onRefresh = async () => {
    const raw = await AsyncStorage.getItem('user');
    if (!raw) return;
    const localUser = JSON.parse(raw);
    const userId: number = localUser.userId ?? localUser.id;
    await Promise.all([
      fetchProfile(),
      fetchCars(userId),
      fetchMyAchievements(),
      fetchUserSpots(userId),
      fetchMyRoutes({ includeGeometry: true }),
      fetchParticipated(),
      fetchActivityHistory({ includeRoute: true }),
      fetchMonthlyStats(),
    ]);
  };

  const handleAddCar = () => {
    if (!effectivePremium && cars.length >= FREE_CAR_LIMIT) {
      router.push('/premium' as any);
      return;
    }
    router.push('/profile/add-car');
  };

  const handleNavigateRoute = async (route: MyRoute) => {
    let points = route.points;
    if (!points || points.length < 2) {
      const full = await fetchRouteGeometry(route.id);
      points = full?.points;
    }
    if (!points || points.length < 2) return;
    await AsyncStorage.setItem('nav_route', JSON.stringify({
      routeId:   route.id,
      routeName: route.name,
      points,
      distance:  route.distance,
      isOffroad: (route as any).isOffroad ?? false,  // ← NOWE
    }));
    router.push('/(tabs)/map');
  };


  const handleNavigateParticipated = async (route: ParticipatedRoute) => {
    await AsyncStorage.setItem('nav_route', JSON.stringify({
      routeId:   route.id,
      routeName: route.name,
      points:    route.points,
      distance:  route.distance,
      isOffroad: (route as any).isOffroad ?? false,  // ← NOWE
    }));
    router.push('/(tabs)/map');
  };

  if (!profile) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg, justifyContent: 'center', alignItems: 'center', gap: 12 }}>
        <ActivityIndicator size="large" color={theme.primary} />
        {!pLoad && (
          <TouchableOpacity
            onPress={() => void fetchProfile()}
            style={{ paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: theme.primary + '50' }}
          >
            <Text style={{ fontFamily: 'Orbitron', fontSize: 10, color: theme.primary }}>ODŚWIEŻ PROFIL</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }

  const initials   = profile?.username?.slice(0, 2).toUpperCase() ?? '??';
  const joinedLabel = profile?.createdAt
    ? new Date(profile.createdAt).toLocaleDateString('pl-PL', { month: 'long', year: 'numeric' })
    : '—';

  const showCarLimit = !effectivePremium && cars.length >= FREE_CAR_LIMIT;

  return (
    <>
      <ProfileView
        profile={profile} cars={cars} achievements={achievements} spots={spots}
        loading={pLoad || cLoad || sLoad}
        onRefresh={onRefresh} isOwner={true}
        initials={initials} joinedLabel={joinedLabel}
        avatarUploading={avatarLoading}
        onSettings={()  => router.push('/profile/settings')}
        onEdit={()      => router.push('/profile/edit')}
        onAddCar={handleAddCar}
        onCarPress={id  => router.push({ pathname: '/profile/car-detail', params: { id } })}
        onSpotPress={_  => {}}
        routes={routes} routesLoading={rLoad}
        onNavigateRoute={handleNavigateRoute}
        onShareRoute={route => setShareRoute(route)}
        onDeleteRoute={deleteRoute}
        participatedRoutes={participatedRoutes}
        participatedRoutesLoading={prLoad}
        onNavigateParticipated={handleNavigateParticipated}
        isPremium={effectivePremium}
        isAdmin={!!profile?.isAdmin}
        activityHistory={activityHistory}
        monthlyStats={monthlyStats}
        monthlyCompare={monthlyCompare}
        locationFriendsOnly={effectivePremium ? !!settings.locationFriendsOnly : false}
        onLocationFriendsOnlyChange={handleLocationFriendsOnly}
        onBannerChange={(arg: any) => handleBannerChange(arg)}
        bannerUploading={bannerLoading}
        carLimitBanner={showCarLimit ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8, paddingHorizontal: 4 }}>
            <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: '#ffffff50' }}>
              Limit free: 3 auta •{' '}
            </Text>
            <TouchableOpacity onPress={() => router.push('/premium' as any)}>
              <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: '#e33835', fontWeight: '700' }}>
                Upgrade
              </Text>
            </TouchableOpacity>
          </View>
        ) : null}
      />
      <ShareRouteModal
        visible={shareRoute !== null} route={shareRoute}
        onClose={() => setShareRoute(null)} onSent={() => setShareRoute(null)}
        myId={myId}
      />
    </>
  );
}