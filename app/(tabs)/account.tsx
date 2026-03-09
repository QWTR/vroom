import React, { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { useProfile }      from '../../hooks/useProfile';
import { useCars }         from '../../hooks/useCars';
import { useAchievements } from '../../hooks/useAchievements';
import { useProfileSpots } from '../../hooks/useProfileSpots';
import ProfileView         from '../../components/profile/ProfileView';

export default function ProfileScreen() {
  const router = useRouter();
  const { profile, loading: pLoad, avatarLoading, fetchProfile } = useProfile();
  const { cars,    loading: cLoad, fetchCars }                   = useCars();
  const { achievements, fetchAchievements }                      = useAchievements();
  const { spots,   loading: sLoad, fetchUserSpots }              = useProfileSpots();

  useEffect(() => {
    const load = async () => {
      const raw = await AsyncStorage.getItem('user');
      if (!raw) { router.replace('/login'); return; }
      const localUser = JSON.parse(raw);
      const userId: number = localUser.userId ?? localUser.id;
      if (!userId) { router.replace('/login'); return; }

      await fetchProfile();
      fetchCars(userId);
      fetchAchievements(userId);
      fetchUserSpots(userId);
    };
    load();
  }, []);

  // Odśwież po powrocie z ekranu edycji
  useEffect(() => {
    const refresh = async () => {
      const raw = await AsyncStorage.getItem('user');
      if (!raw) return;
      const userId: number = JSON.parse(raw).userId ?? JSON.parse(raw).id;
      fetchProfile();
      fetchCars(userId);
    };
    // expo-router focus event
    refresh();
  }, []);

  const onRefresh = async () => {
    const raw = await AsyncStorage.getItem('user');
    if (!raw) return;
    const userId: number = JSON.parse(raw).userId ?? JSON.parse(raw).id;
    fetchProfile();
    fetchCars(userId);
    fetchAchievements(userId);
    fetchUserSpots(userId);
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
      onEdit={() => router.push('/profile/edit')}   // ← avatar + dane w jednym miejscu
      onAddCar={() => router.push('/profile/add-car')}
      onCarPress={(id) => router.push({ pathname: '/profile/car-detail', params: { id } })}
      onSpotPress={(id) => {}}                       // obsługiwane przez modal w ProfileView
    />
  );
}