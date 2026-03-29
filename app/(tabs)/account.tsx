import React, { useEffect ,useState} from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Toast from 'react-native-toast-message';

import { useProfile }      from '../../hooks/useProfile';
import { useCars }         from '../../hooks/useCars';
import { useAchievements } from '../../hooks/useAchievements';
import { useProfileSpots } from '../../hooks/useProfileSpots';
import { useMyRoutes } from '../../hooks/useMyRoutes';
import ProfileView         from '../../components/profile/ProfileView';
import type { MyRoute } from '../../hooks/useMyRoutes';
import { ShareRouteModal } from '../../components/modals/ShareRouteModal';

export default function ProfileScreen() {
  const router = useRouter();
  const { profile, loading: pLoad, avatarLoading, fetchProfile } = useProfile();
  const { cars,    loading: cLoad, fetchCars }                   = useCars();
  const { achievements, fetchMyAchievements }                    = useAchievements();
  const { spots,   loading: sLoad, fetchUserSpots }              = useProfileSpots();
  const { routes, loading: rLoad, fetchMyRoutes, deleteRoute } = useMyRoutes();
  const [shareRoute, setShareRoute] = useState<MyRoute | null>(null);
  const [myId, setMyId] = useState<number | null>(null);

  useEffect(() => {
    AsyncStorage.getItem('user').then(raw => {
      if (raw) setMyId(JSON.parse(raw).userId ?? null);
    });
  }, []);

  useEffect(() => {
    const load = async () => {
      const raw = await AsyncStorage.getItem('user');
      if (!raw) { router.replace('/login'); return; }
      const localUser = JSON.parse(raw);
      const userId: number = localUser.userId ?? localUser.id;
      if (!userId) { router.replace('/login'); return; }

      await fetchProfile();
      fetchCars(userId);
      fetchMyAchievements();
      fetchUserSpots(userId);
      fetchMyRoutes();
    };
    load();
  }, []);

  const onRefresh = async () => {
    const raw = await AsyncStorage.getItem('user');
    if (!raw) return;
    const localUser      = JSON.parse(raw);
    const userId: number = localUser.userId ?? localUser.id;
    fetchProfile();
    fetchCars(userId);
    fetchMyAchievements();
    fetchUserSpots(userId);
    fetchMyRoutes();
  };

  const handleNavigateRoute = async (route: MyRoute) => {
    if (route.points.length < 2) return;
    // Zapisz trasę do AsyncStorage — map.tsx ją odbierze
    await AsyncStorage.setItem('nav_route', JSON.stringify({
      routeId:   route.id,
      routeName: route.name,
      points:    route.points,
      distance:  route.distance,
    }));
    router.push('/(tabs)/map');
  };

  const handleShareRoute = (route: MyRoute) => {
    // Na razie Toast — pełne udostępnianie w kolejnym etapie
    Toast.show({ type: 'info', text1: '🔗 UDOSTĘPNIANIE', text2: 'Wkrótce dostępne' });
  };

  const initials    = profile?.username?.slice(0, 2).toUpperCase() ?? '??';
  const joinedLabel = profile?.createdAt
    ? new Date(profile.createdAt).toLocaleDateString('pl-PL', { month: 'long', year: 'numeric' })
    : '—';

  if (pLoad && !profile) {
    return (
      <View style={{ flex: 1, backgroundColor: '#0f0f0f', justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color="#e33835" />
      </View>
    );
  }

  return (
    <>
    <ProfileView
      profile={profile}
      cars={cars}
      achievements={achievements}
      spots={spots}
      loading={pLoad || cLoad || sLoad}
      onRefresh={onRefresh}
      isOwner={true}
      initials={initials}
      joinedLabel={joinedLabel}
      avatarUploading={avatarLoading}
      onSettings={() => router.push('/profile/settings')}
      onEdit={()     => router.push('/profile/edit')}
      onAddCar={()   => router.push('/profile/add-car')}
      onCarPress={(id) => router.push({ pathname: '/profile/car-detail', params: { id } })}
      onSpotPress={(id) => {}}
      routes={routes}
      routesLoading={rLoad}
      onNavigateRoute={handleNavigateRoute}
      onShareRoute={(route) => setShareRoute(route)}
      onDeleteRoute={deleteRoute}
    />
    <ShareRouteModal
      visible={shareRoute !== null}
      route={shareRoute}
      myId={myId}
      onClose={() => setShareRoute(null)}
      onSent={() => {
        Toast.show({ type: 'success', text1: '✅ TRASA WYSŁANA' });
      }}
    />
    </>
  );
}