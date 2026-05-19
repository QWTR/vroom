import React, { useEffect, useState, useRef, useCallback } from 'react';
import { ActivityIndicator, View, Text, TouchableOpacity } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Toast from 'react-native-toast-message';
import { useTheme } from '../../contexts/ThemeContext';
import { usePremium } from '../../contexts/PremiumContext';
import { API_URL } from '../../constants/config';

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

const FREE_CAR_LIMIT = 3;

export default function ProfileScreen() {
  const router = useRouter();
  const { theme } = useTheme();
  const { isPremium } = usePremium();

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
  const effectivePremium = !!(isPremium || profile?.isPremium);
  const { cars,    loading: cLoad, fetchCars }                   = useCars();
  const { achievements, fetchMyAchievements }                    = useAchievements();
  const { spots,   loading: sLoad, fetchUserSpots }              = useProfileSpots();
  const { routes,  loading: rLoad, fetchMyRoutes, fetchRouteGeometry, deleteRoute }  = useMyRoutes();
  const { routes: participatedRoutes, loading: prLoad, fetchParticipated } = useParticipatedRoutes();

  const [shareRoute,          setShareRoute]          = useState<MyRoute | null>(null);
  const [myId,                setMyId]                = useState<number | null>(null);
  const [locationFriendsOnly, setLocationFriendsOnly] = useState(false);
  const [bannerLoading,       setBannerLoading]       = useState(false);

  useEffect(() => {
    AsyncStorage.getItem('user').then(raw => {
      if (raw) setMyId(JSON.parse(raw).userId ?? null);
    });
    AsyncStorage.getItem('locationFriendsOnly').then(v => {
      setLocationFriendsOnly(v === 'true');
    });
  }, []);

  const handleLocationFriendsOnly = async (v: boolean) => {
    setLocationFriendsOnly(v);
    await AsyncStorage.setItem('locationFriendsOnly', String(v));
  };

  const handleBannerChange = async (mode?: 'delete') => {
    try {
      const token = (await AsyncStorage.getItem('userToken')) ?? (await AsyncStorage.getItem('token'));
      setBannerLoading(true);
      if (mode === 'delete') {
        const res = await fetch(`${API_URL}/api/profile/banner`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          await fetchProfile();
          Toast.show({ type: 'success', text1: '✅ Baner usunięty!' });
          return;
        }
        const d = await res.json();
        Toast.show({ type: 'error', text1: 'BŁĄD', text2: d.error ?? 'Spróbuj ponownie' });
        return;
      }
      const ImagePicker = await import('expo-image-picker');
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [16, 5] as [number, number],
        quality: 0.8,
      });
      if (result.canceled || !result.assets?.[0]) return;
      const uri = result.assets[0].uri;
      const formData = new FormData();
      formData.append('banner', { uri, name: `banner_${Date.now()}.jpg`, type: 'image/jpeg' } as any);
      const res = await fetch(`${API_URL}/api/profile/banner`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      if (!res.ok) {
        const d = await res.json();
        Toast.show({ type: 'error', text1: 'BŁĄD', text2: d.error ?? 'Spróbuj ponownie' });
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
        void fetchProfile();
        void fetchActivityHistory({ includeRoute: true });
        void fetchMonthlyStats();
      }, 300);
      return () => {
        if (focusRefreshTimer.current) clearTimeout(focusRefreshTimer.current);
      };
    }, [fetchProfile, fetchActivityHistory, fetchMonthlyStats]),
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

  if (pLoad && !profile) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color={theme.primary} />
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
        locationFriendsOnly={locationFriendsOnly}
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