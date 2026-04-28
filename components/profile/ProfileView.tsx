import React, { useState, useRef } from 'react';
import {
  ScrollView, View, Text, TouchableOpacity, RefreshControl,
  Image, Animated, Dimensions, StatusBar, Modal,
} from 'react-native';
import { LinearGradient }           from 'expo-linear-gradient';
import MaterialIcons                from '@expo/vector-icons/MaterialIcons';
import Ionicons                     from '@expo/vector-icons/Ionicons';
import { MaterialCommunityIcons }   from '@expo/vector-icons';
import { useRouter }                from 'expo-router';
import { useTheme }                 from '../../contexts/ThemeContext';

import AvatarCircle                 from './AvatarCircle';
import StatBox                      from './StatBox';
import CarCard                      from './CarCard';
import AchievementBox               from './AchievementBox';
import SpotPreviewCard              from './SpotPreviewCard';
import { SpotDetailModal }          from '../spots/SpotDetailModal';
import type { Achievement }         from '../../hooks/useAchievements';
import type { UserProfile, Car, SpotPreview } from '../../constants/profile';
import type { Spot }                from '../../constants/spotTypes';
import RouteCard                    from './RouteCard';
import type { MyRoute }             from '../../hooks/useMyRoutes';
import { RoutesListModal }          from '../modals/RoutesListModal';
import { RouteLeaderboardModal }    from '../modals/RouteLeaderboardModal';
import { useRouteLeaderboard }      from '../../hooks/useRouteLeaderboard';
import ParticipatedRoutesSection    from './ParticipatedRouteCard';
import type { ParticipatedRoute }   from '../../hooks/useParticipatedRoutes';
import { useChat }                  from '../../hooks/useChats';
import { FriendsModal }             from '../modals/FriendsModal';
import { FriendRequestsModal }      from '../modals/FriendRequestsModal';
import { useFollowCounts }          from '../../hooks/useFollowCounts';

const { width } = Dimensions.get('window');

const RARITY_ORDER: Record<string, number> = { legendary: 0, epic: 1, rare: 2, common: 3 };
const RARITY_META: Record<string, { label: string; color: string; border: string }> = {
  legendary: { label: 'LEGENDARY', color: '#f5c518', border: '#f5c51840' },
  epic:      { label: 'EPIC',      color: '#a338e3', border: '#a338e340' },
  rare:      { label: 'RARE',      color: '#38a5e3', border: '#38a5e340' },
  common:    { label: 'COMMON',    color: '#ff0202b2', border: '#ff020240' },
};

function sortByRarity(list: Achievement[]) {
  return [...list].sort((a, b) => (RARITY_ORDER[a.rarity ?? 'common'] ?? 3) - (RARITY_ORDER[b.rarity ?? 'common'] ?? 3));
}
function groupByRarity(list: Achievement[]) {
  return ['legendary', 'epic', 'rare', 'common'].reduce((acc, rarity) => {
    const items = list.filter(a => (a.rarity ?? 'common') === rarity);
    return items.length ? [...acc, { rarity, items }] : acc;
  }, [] as { rarity: string; items: Achievement[] }[]);
}

interface Props {
  profile:                   UserProfile | null;
  cars:                      Car[];
  achievements:              Achievement[];
  spots:                     SpotPreview[];
  loading:                   boolean;
  isOwner:                   boolean;
  initials:                  string;
  joinedLabel:               string;
  avatarUploading?:          boolean;
  routes:                    MyRoute[];
  routesLoading:             boolean;
  participatedRoutes:        ParticipatedRoute[];
  participatedRoutesLoading: boolean;
  onNavigateParticipated:    (r: ParticipatedRoute) => void;
  onNavigateRoute:           (route: MyRoute) => void;
  onShareRoute:              (route: MyRoute) => void;
  onDeleteRoute:             (id: number) => void;
  onRefresh:                 () => void;
  onSettings:                () => void;
  onEdit:                    () => void;
  onAddCar:                  () => void;
  onAvatarChange?:           (uri: string) => void;
  onCarPress:                (id: number) => void;
  onSpotPress:               (id: number) => void;
  onBack?:                   () => void;
  carLimitBanner?:           React.ReactNode;
}

function toSpot(s: SpotPreview): Spot {
  return {
    id: String(s.id), name: s.name, description: s.description ?? '',
    category: s.category as any, latitude: s.latitude, longitude: s.longitude,
    photos: s.photos ?? [], author: s.author ?? 'Nieznany',
    createdAt: s.createdAt?.split('T')[0] ?? '',
    likesCount: s.likesCount ?? 0, commentsCount: s.commentsCount ?? 0,
    isLiked: s.isLiked ?? false,
  };
}

export default function ProfileView({
  profile, cars, achievements, spots, loading,
  isOwner, initials, joinedLabel, avatarUploading = false,
  routes, routesLoading, participatedRoutes, participatedRoutesLoading,
  onNavigateParticipated, onDeleteRoute, onRefresh, onSettings, onEdit,
  onAddCar, onCarPress, onBack, onNavigateRoute, onShareRoute, carLimitBanner,
}: Props) {
  const { theme, isDark } = useTheme();
  const router = useRouter();
  const { friends, fetchFriends, requests, fetchRequests, acceptRequest, rejectRequest, removeFriend } = useChat();
  const { counts: followCounts } = useFollowCounts(profile?.id);

  const [selectedSpot,        setSelectedSpot]        = useState<Spot | null>(null);
  const [localSpots,          setLocalSpots]          = useState<SpotPreview[]>([]);
  const [showAllAchs,         setShowAllAchs]         = useState(false);
  const [routesModalVisible,  setRoutesModalVisible]  = useState(false);
  const [lbVisible,           setLbVisible]           = useState(false);
  const [lbRouteId,           setLbRouteId]           = useState<number | null>(null);
  const [lbRouteName,         setLbRouteName]         = useState('');
  const [friendsModalVisible, setFriendsModalVisible] = useState(false);
  const [invitesModalVisible, setInvitesModalVisible] = useState(false);
  const [statsModalVisible,   setStatsModalVisible]   = useState(false);
  const [showAllSpots,        setShowAllSpots]        = useState(false);
  const statsSlide = useRef(new Animated.Value(0)).current;
  const ROUTES_PREVIEW = 0;
  const SPOTS_PREVIEW  = 4;

  const openStats = () => {
    setStatsModalVisible(true);
    statsSlide.setValue(1);
    Animated.spring(statsSlide, { toValue: 0, useNativeDriver: true, friction: 8, tension: 60 }).start();
  };
  const closeStats = () => {
    Animated.timing(statsSlide, { toValue: 1, duration: 220, useNativeDriver: true }).start(() => setStatsModalVisible(false));
  };

  const { data: lbData, runsData: lbRunsData, loading: lbLoading, fetchLeaderboard, fetchRuns } = useRouteLeaderboard();

  const handleLeaderboard = async (route: { id: number; name: string }) => {
    setLbRouteId(route.id); setLbRouteName(route.name); setLbVisible(true);
    await Promise.all([fetchLeaderboard(route.id), fetchRuns(route.id)]);
  };

  React.useEffect(() => { setLocalSpots(spots); }, [spots]);
  React.useEffect(() => {
    if (isOwner) { fetchFriends(); fetchRequests(); }
  }, [isOwner]);

  const handleLikeToggle = (spotId: string, liked: boolean, count: number) => {
    setLocalSpots(prev => prev.map(s => String(s.id) === spotId ? { ...s, isLiked: liked, likesCount: count } : s));
    setSelectedSpot(prev => prev?.id === spotId ? { ...prev, isLiked: liked, likesCount: count } : prev);
  };

  const unlocked       = sortByRarity(achievements.filter(a => a.active));
  const locked         = sortByRarity(achievements.filter(a => !a.active));
  const unlockedGroups = groupByRarity(unlocked);
  const lockedGroups   = groupByRarity(locked);

  // Club data
  const club = (profile as any)?.club as {
    id: number; name: string; avatarUrl: string | null;
    memberCount: number; myRole: string;
    myRank?: { name: string; color: string } | null;
  } | null | undefined;

  return (
    <>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor="transparent" translucent />
      <ScrollView
        style={{ flex: 1, backgroundColor: theme.bg }}
        contentContainerStyle={{ paddingBottom: 100 }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={onRefresh} tintColor="#e33835" colors={['#e33835']} />}
      >

        {/* ══════════════════════════════════════════════ */}
        {/* HERO HEADER                                    */}
        {/* ══════════════════════════════════════════════ */}
        <View style={{ height: 240, position: 'relative', overflow: 'hidden' }}>
          <LinearGradient
            colors={isDark ? ['#1a0404', '#0d0808', '#080808'] : ['#fce8e8', '#f5f0f0', theme.bg]}
            start={{ x: 0.2, y: 0 }} end={{ x: 1, y: 1 }}
            style={{ ...StyleSheet.absoluteFillObject }}
          />
          {/* Decorative rings */}
          <View style={{ position: 'absolute', top: -60, right: -60, width: 260, height: 260, borderRadius: 130, borderWidth: 1, borderColor: '#e3383518' }} />
          <View style={{ position: 'absolute', top: -20, right: -20, width: 150, height: 150, borderRadius: 75, borderWidth: 1, borderColor: '#e3383530', backgroundColor: '#e3383508' }} />
          {/* Scanlines */}
          {Array.from({ length: 8 }).map((_, i) => (
            <View key={i} style={{ position: 'absolute', left: 0, right: 0, top: i * 30, height: 1, backgroundColor: isDark ? '#ffffff04' : '#00000003' }} />
          ))}

          {/* Top bar */}
          <View style={{ position: 'absolute', top: 52, left: 20, right: 20, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              {onBack ? (
                <TouchableOpacity
                  onPress={onBack}
                  style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: isDark ? '#ffffff12' : '#00000012', alignItems: 'center', justifyContent: 'center' }}
                >
                  <MaterialIcons name="arrow-back" size={20} color={theme.text} />
                </TouchableOpacity>
              ) : (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <View style={{ backgroundColor: '#e33835', borderRadius: 7, padding: 5 }}>
                    <MaterialCommunityIcons name="account" size={14} color="#fff" />
                  </View>
                  <Text style={{ fontFamily: 'Orbitron', fontSize: 13, color: theme.text, fontWeight: '900', letterSpacing: 3 }}>PROFIL</Text>
                </View>
              )}
            </View>
            {isOwner && (
              <TouchableOpacity
                style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: isDark ? '#ffffff10' : '#00000010', borderWidth: 1, borderColor: isDark ? '#ffffff20' : '#00000015', alignItems: 'center', justifyContent: 'center' }}
                onPress={onSettings}
              >
                <Ionicons name="settings-outline" size={18} color={theme.textDim} />
              </TouchableOpacity>
            )}
          </View>

          {/* Avatar + Name */}
          <View style={{ position: 'absolute', bottom: 24, left: 20, right: 20, flexDirection: 'row', alignItems: 'flex-end', gap: 16 }}>
            {/* Avatar */}
            <View style={{ position: 'relative' }}>
              <View style={{ width: 80, height: 80, borderRadius: 40, borderWidth: 3, borderColor: '#e33835', overflow: 'hidden', backgroundColor: theme.surface }}>
                {profile?.avatarUrl
                  ? <Image source={{ uri: profile.avatarUrl }} style={{ width: 80, height: 80 }} />
                  : (
                    <View style={{ flex: 1, backgroundColor: '#e3383515', alignItems: 'center', justifyContent: 'center' }}>
                      <Text style={{ fontFamily: 'Orbitron', fontSize: 24, color: '#e33835', fontWeight: '900' }}>{initials}</Text>
                    </View>
                  )
                }
              </View>
              
            </View>

            {/* Name + info */}
            <View style={{ flex: 1, paddingBottom: 4 }}>
              <Text style={{ fontFamily: 'Orbitron', fontSize: 10, color: '#e33835', letterSpacing: 3, marginBottom: 3 }}>
                {isOwner ? 'TWÓJ PROFIL' : 'PROFIL GRACZA'}
              </Text>
              <Text style={{ fontFamily: 'Orbitron', fontSize: 20, color: theme.text, fontWeight: '900', letterSpacing: 0.5 }} numberOfLines={1}>
                {profile?.username ?? '—'}
              </Text>
              {!!profile?.location && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3 }}>
                  <MaterialIcons name="location-on" size={11} color={theme.textDim} />
                  <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: theme.textDim }}>{profile.location}</Text>
                </View>
              )}
            </View>

            {/* Pozycja badge */}
            {!!profile?.position && (
              <View style={{ backgroundColor: '#e3383518', borderRadius: 12, borderWidth: 1, borderColor: '#e3383540', paddingHorizontal: 12, paddingVertical: 8, alignItems: 'center', marginBottom: 4 }}>
                <Text style={{ fontFamily: 'Orbitron', fontSize: 18, color: '#e33835', fontWeight: '900' }}>#{profile.position}</Text>
                <Text style={{ fontFamily: 'Orbitron', fontSize: 6, color: theme.textDim, letterSpacing: 2, marginTop: 1 }}>RANKING</Text>
              </View>
            )}
          </View>

          {/* Bottom fade */}
          <LinearGradient colors={['transparent', theme.bg]} style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 50 }} />
        </View>

        <View style={{ paddingHorizontal: 20 }}>

          {/* BIO */}
          {!!profile?.bio && (
            <View style={{ marginBottom: 20, backgroundColor: theme.surface, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: theme.border }}>
              <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: theme.textDim, letterSpacing: 3, marginBottom: 8 }}>O MNIE</Text>
              <Text style={{ color: theme.text, fontSize: 13, lineHeight: 20 }}>{profile.bio}</Text>
            </View>
          )}

          {/* Dołączył */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: theme.surface, borderRadius: 12, padding: 10, borderWidth: 1, borderColor: theme.border, marginBottom: 20 }}>
            <MaterialIcons name="calendar-today" size={13} color={theme.textDim} />
            <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: theme.textDim, flex: 1 }}>Dołączył: {joinedLabel}</Text>
          </View>

          {/* ══ 3 KEY STAT PILLS + ACTION BUTTONS ══ */}
          <View style={{ flexDirection: 'row', gap: 8, marginBottom: 16 }}>
            {/* Pts pill */}
            <TouchableOpacity
              onPress={openStats} activeOpacity={0.75}
              style={{ flex: 1, backgroundColor: theme.surface, borderRadius: 14, borderWidth: 1, borderColor: '#e3383540', paddingVertical: 10, paddingHorizontal: 6, alignItems: 'center', gap: 3 }}
            >
              <Text style={{ fontSize: 14 }}>🏆</Text>
              <Text style={{ fontFamily: 'Orbitron', fontSize: 13, color: '#e33835', fontWeight: '900' }}>{unlocked.length}</Text>
              <Text style={{ fontFamily: 'Orbitron', fontSize: 6, color: theme.textDim, letterSpacing: 1 }}>OSIĄGN.</Text>
            </TouchableOpacity>
            {/* km pill */}
            <TouchableOpacity
              onPress={openStats} activeOpacity={0.75}
              style={{ flex: 1, backgroundColor: theme.surface, borderRadius: 14, borderWidth: 1, borderColor: '#268bff40', paddingVertical: 10, paddingHorizontal: 6, alignItems: 'center', gap: 3 }}
            >
              <Text style={{ fontSize: 14 }}>🛣️</Text>
              <Text style={{ fontFamily: 'Orbitron', fontSize: 13, color: '#268bff', fontWeight: '900' }}>{Math.round(profile?.totalDistance ?? 0)}</Text>
              <Text style={{ fontFamily: 'Orbitron', fontSize: 6, color: theme.textDim, letterSpacing: 1 }}>KM</Text>
            </TouchableOpacity>
            {/* ranking pill */}
            <TouchableOpacity
              onPress={openStats} activeOpacity={0.75}
              style={{ flex: 1, backgroundColor: theme.surface, borderRadius: 14, borderWidth: 1, borderColor: '#4de92640', paddingVertical: 10, paddingHorizontal: 6, alignItems: 'center', gap: 3 }}
            >
              <Text style={{ fontSize: 14 }}>📍</Text>
              <Text style={{ fontFamily: 'Orbitron', fontSize: 13, color: '#4de926', fontWeight: '900' }}>
                {profile?.position ? `#${profile.position}` : '—'}
              </Text>
              <Text style={{ fontFamily: 'Orbitron', fontSize: 6, color: theme.textDim, letterSpacing: 1 }}>RANKING</Text>
            </TouchableOpacity>
            {/* Stats button */}
            <TouchableOpacity
              onPress={openStats} activeOpacity={0.75}
              style={{ flex: 1.2, backgroundColor: '#e3383515', borderRadius: 14, borderWidth: 1, borderColor: '#e3383540', paddingVertical: 10, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center', gap: 3 }}
            >
              <MaterialIcons name="bar-chart" size={18} color="#e33835" />
              <Text style={{ fontFamily: 'Orbitron', fontSize: 6, color: '#e33835', letterSpacing: 1, textAlign: 'center' }}>STATYSTYKI</Text>
            </TouchableOpacity>
          </View>

          {/* ══ ACTION BUTTONS ROW ══ */}
          {isOwner && (
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 20 }}>
              <TouchableOpacity
                style={{ flex: 1, backgroundColor: '#e33835', borderRadius: 12, paddingVertical: 11, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }}
                onPress={onEdit} activeOpacity={0.85}
              >
                <MaterialIcons name="edit" size={13} color="#fff" />
                <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: '#fff', fontWeight: '700' }}>EDYTUJ</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={{ flex: 1, backgroundColor: theme.surface, borderRadius: 12, paddingVertical: 11, borderWidth: 1, borderColor: theme.border, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }}
                onPress={onSettings} activeOpacity={0.85}
              >
                <Ionicons name="settings-outline" size={13} color={theme.textDim} />
                <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: theme.textDim, fontWeight: '700' }}>USTAWIENIA</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={{ flex: 1, backgroundColor: '#4de92615', borderRadius: 12, paddingVertical: 11, borderWidth: 1, borderColor: '#4de92630', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }}
                onPress={onAddCar} activeOpacity={0.85}
              >
                <MaterialCommunityIcons name="car-plus" size={13} color="#4de926" />
                <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: '#4de926', fontWeight: '700' }}>DODAJ AUTO</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* ══ OBSERWACJE ══ */}
          <View style={{ flexDirection: 'row', gap: 10, marginBottom: 20 }}>
            {[
              { label: 'OBSERWUJĄCY', value: profile?.followersCount ?? 0, color: '#4de926', icon: 'visibility'   as const },
              { label: 'OBSERWACJE',  value: profile?.followingCount ?? 0, color: '#a855f7', icon: 'person-add'   as const },
            ].map(item => (
              <View key={item.label} style={{ flex: 1, backgroundColor: theme.surface, borderRadius: 14, borderWidth: 1, borderColor: theme.border, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <View style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: item.color + '18', alignItems: 'center', justifyContent: 'center' }}>
                  <MaterialIcons name={item.icon} size={16} color={item.color} />
                </View>
                <View>
                  <Text style={{ fontFamily: 'Orbitron', fontSize: 20, color: theme.text, fontWeight: '900' }}>{item.value}</Text>
                  <Text style={{ fontFamily: 'Orbitron', fontSize: 6, color: item.color, letterSpacing: 1, marginTop: 2 }}>{item.label}</Text>
                </View>
              </View>
            ))}
          </View>

          {/* ══ KLUB ══ */}
          {!club ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: theme.surface, borderRadius: 16, paddingHorizontal: 16, paddingVertical: 14, borderWidth: 1, borderColor: theme.border, marginBottom: 20 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: isDark ? '#ffffff08' : '#00000008', alignItems: 'center', justifyContent: 'center' }}>
                  <MaterialCommunityIcons name="shield-off-outline" size={18} color={theme.textDim} />
                </View>
                <View>
                  <Text style={{ fontFamily: 'Orbitron', fontSize: 11, color: theme.text, fontWeight: '700' }}>KLUB</Text>
                  <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: theme.textDim, marginTop: 2 }}>
                    {isOwner ? 'Nie należysz do żadnego klubu' : 'Brak klubu'}
                  </Text>
                </View>
              </View>
              {isOwner && (
                <TouchableOpacity
                  style={{ backgroundColor: '#e33835', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 7 }}
                  onPress={() => router.push('/Community/clubs/clubs' as any)}
                >
                  <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: '#fff', fontWeight: '700' }}>ZNAJDŹ KLUB</Text>
                </TouchableOpacity>
              )}
            </View>
          ) : (
            <TouchableOpacity
              style={{ backgroundColor: theme.surface, borderRadius: 16, paddingHorizontal: 16, paddingVertical: 14, borderWidth: 1, borderColor: '#e3383530', marginBottom: 20, flexDirection: 'row', alignItems: 'center', gap: 12 }}
              onPress={() => router.push('/Community/clubs/clubs' as any)}
              activeOpacity={0.85}
            >
              <View style={{ width: 46, height: 46, borderRadius: 13, overflow: 'hidden', backgroundColor: '#e3383515', borderWidth: 1, borderColor: '#e3383530', alignItems: 'center', justifyContent: 'center' }}>
                {club.avatarUrl
                  ? <Image source={{ uri: club.avatarUrl }} style={{ width: 46, height: 46 }} />
                  : <MaterialCommunityIcons name="shield-crown-outline" size={22} color="#e33835" />
                }
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: 'Orbitron', fontSize: 13, color: theme.text, fontWeight: '700', marginBottom: 5 }} numberOfLines={1}>{club.name}</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <View style={{ backgroundColor: (club.myRole === 'owner' ? '#e33835' : club.myRank?.color ?? '#4de926') + '20', borderRadius: 5, paddingHorizontal: 6, paddingVertical: 2, borderWidth: 1, borderColor: (club.myRole === 'owner' ? '#e33835' : club.myRank?.color ?? '#4de926') + '40' }}>
                    <Text style={{ fontFamily: 'Orbitron', fontSize: 7, color: club.myRole === 'owner' ? '#e33835' : club.myRank?.color ?? '#4de926', fontWeight: '700' }}>
                      {club.myRole === 'owner' ? 'ZAŁOŻYCIEL' : (club.myRank?.name?.toUpperCase() ?? 'CZŁONEK')}
                    </Text>
                  </View>
                  <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: theme.textDim }}>{club.memberCount} członków</Text>
                </View>
              </View>
              <MaterialIcons name="arrow-forward-ios" size={14} color={theme.textDim} />
            </TouchableOpacity>
          )}

          {/* ══ ZAPROSZENIA ══ */}
          {isOwner && (
            <TouchableOpacity
              style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: theme.surface, borderRadius: 16, paddingHorizontal: 16, paddingVertical: 14, borderWidth: 1, borderColor: requests.length > 0 ? '#e3383530' : theme.border, marginBottom: 12 }}
              onPress={() => setInvitesModalVisible(true)} activeOpacity={0.8}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: '#e3383515', borderWidth: 1, borderColor: '#e3383530', alignItems: 'center', justifyContent: 'center' }}>
                  <MaterialIcons name="person-add" size={18} color="#e33835" />
                </View>
                <View>
                  <Text style={{ fontFamily: 'Orbitron', color: theme.text, fontSize: 11, fontWeight: '700' }}>ZAPROSZENIA DO ZNAJOMYCH</Text>
                  <Text style={{ fontFamily: 'Orbitron', color: theme.textDim, fontSize: 8, marginTop: 2 }}>{requests.length} oczekujących</Text>
                </View>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                {requests.length > 0 && (
                  <View style={{ backgroundColor: '#e3383520', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 3, borderWidth: 1, borderColor: '#e3383540' }}>
                    <Text style={{ fontFamily: 'Orbitron', fontSize: 10, color: '#e33835', fontWeight: '700' }}>{requests.length}</Text>
                  </View>
                )}
                <MaterialIcons name="arrow-forward-ios" size={14} color={theme.textDim} />
              </View>
            </TouchableOpacity>
          )}

          {/* ══ ZNAJOMI ══ */}
          {isOwner && (
            <TouchableOpacity
              style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: theme.surface, borderRadius: 16, paddingHorizontal: 16, paddingVertical: 14, borderWidth: 1, borderColor: theme.border, marginBottom: 20 }}
              onPress={() => setFriendsModalVisible(true)} activeOpacity={0.8}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: '#268bff15', borderWidth: 1, borderColor: '#268bff30', alignItems: 'center', justifyContent: 'center' }}>
                  <MaterialIcons name="people" size={18} color="#268bff" />
                </View>
                <View>
                  <Text style={{ fontFamily: 'Orbitron', color: theme.text, fontSize: 11, fontWeight: '700' }}>ZNAJOMI</Text>
                  <Text style={{ fontFamily: 'Orbitron', color: theme.textDim, fontSize: 8, marginTop: 2 }}>{friends.length} osób</Text>
                </View>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <View style={{ backgroundColor: '#268bff15', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 3, borderWidth: 1, borderColor: '#268bff30' }}>
                  <Text style={{ fontFamily: 'Orbitron', fontSize: 10, color: '#268bff', fontWeight: '700' }}>{friends.length}</Text>
                </View>
                <MaterialIcons name="arrow-forward-ios" size={14} color={theme.textDim} />
              </View>
            </TouchableOpacity>
          )}

          {/* ══ AUTA ══ */}
          <Section
            title={isOwner ? 'MOJE AUTA' : 'AUTA'}
            count={cars.length}
            right={isOwner ? (
              <TouchableOpacity onPress={onAddCar} style={{ backgroundColor: '#e33835', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5 }}>
                <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: '#fff', fontWeight: '700' }}>+ DODAJ</Text>
              </TouchableOpacity>
            ) : null}
          >
            {cars.length === 0
              ? <EmptyState text="Brak dodanych aut" />
              : cars.map(car => <CarCard key={car.id} brand={car.brand} specs={car.specs} isMain={car.isMain} firstPhoto={car.photos?.[0]} onPress={() => onCarPress(car.id)} />)
            }
          </Section>
          {isOwner && carLimitBanner}

          {/* ══ OSIĄGNIĘCIA ══ */}
          <Section title="OSIĄGNIĘCIA" count={`${unlocked.length}/${achievements.length}`}>
            {achievements.length === 0
              ? <EmptyState text="Ładowanie osiągnięć..." />
              : (
                <>
                  {unlocked.length === 0
                    ? <EmptyState text="Brak odblokowanych osiągnięć" />
                    : unlockedGroups.map(({ rarity, items }) => {
                        const meta = RARITY_META[rarity] ?? RARITY_META.common;
                        return (
                          <View key={rarity} style={{ marginBottom: 16 }}>
                            <RarityDivider meta={meta} count={items.length} />
                            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                              {items.map(a => <AchievementBox key={a.key} icon={a.icon} label={a.label} active rarity={a.rarity} progress={100} points={a.points} description={a.description} category={a.category} currentValue={a.currentValue} conditionValue={a.conditionValue} conditionField={a.conditionField} unlockedAt={a.unlockedAt} />)}
                            </View>
                          </View>
                        );
                      })
                  }
                  {locked.length > 0 && (
                    <>
                      <TouchableOpacity
                        style={{ marginVertical: 10, paddingVertical: 12, backgroundColor: theme.surface, borderRadius: 12, borderWidth: 1, borderColor: theme.border, alignItems: 'center' }}
                        onPress={() => setShowAllAchs(p => !p)} activeOpacity={0.75}
                      >
                        <Text style={{ fontFamily: 'Orbitron', color: theme.textDim, fontSize: 9, letterSpacing: 1 }}>
                          {showAllAchs ? '▲  UKRYJ ZABLOKOWANE' : `▼  ZABLOKOWANE (${locked.length})`}
                        </Text>
                      </TouchableOpacity>
                      {showAllAchs && lockedGroups.map(({ rarity, items }) => {
                        const meta = RARITY_META[rarity] ?? RARITY_META.common;
                        return (
                          <View key={rarity} style={{ marginBottom: 16 }}>
                            <RarityDivider meta={meta} count={items.length} />
                            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                              {items.map(a => <AchievementBox key={a.key} icon={a.icon} label={a.label} active={false} rarity={a.rarity} progress={a.progress} points={a.points} description={a.description} category={a.category} currentValue={a.currentValue} conditionValue={a.conditionValue} conditionField={a.conditionField} unlockedAt={a.unlockedAt} />)}
                            </View>
                          </View>
                        );
                      })}
                    </>
                  )}
                </>
              )
            }
          </Section>

          {/* ══ PRZEJECHANE TRASY ══ */}
          <Section title="PRZEJECHANE TRASY" count={participatedRoutes.length}>
            {participatedRoutesLoading
              ? <EmptyState text="Ładowanie..." />
              : participatedRoutes.length === 0
              ? <EmptyState text="Brak przejechanych tras" />
              : <ParticipatedRoutesSection routes={participatedRoutes} myId={null} onNavigate={onNavigateParticipated} onLeaderboard={handleLeaderboard} />
            }
          </Section>

          {/* ══ MOJE TRASY ══ */}
          <Section title={isOwner ? 'MOJE TRASY' : 'TRASY'} count={routes.length}>
            {routes.length === 0
              ? <EmptyState text={routesLoading ? 'Ładowanie...' : 'Brak zapisanych tras'} />
              : (
                <>
                  {routes.slice(0, ROUTES_PREVIEW).map(route => (
                    <RouteCard key={route.id} route={route} isOwner={isOwner} onDelete={onDeleteRoute} onNavigate={onNavigateRoute} onShare={onShareRoute} onLeaderboard={handleLeaderboard} />
                  ))}
                  {routes.length > ROUTES_PREVIEW && (
                    <TouchableOpacity
                      style={{ marginVertical: 10, paddingVertical: 14, backgroundColor: theme.surface, borderRadius: 14, borderWidth: 1, borderColor: theme.border, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8 }}
                      onPress={() => setRoutesModalVisible(true)} activeOpacity={0.75}
                    >
                      <MaterialIcons name="route" size={16} color="#e33835" />
                      <Text style={{ fontFamily: 'Orbitron', color: theme.text, fontSize: 9, letterSpacing: 1 }}>WSZYSTKIE TRASY ({routes.length})</Text>
                    </TouchableOpacity>
                  )}
                </>
              )
            }
          </Section>

          {/* ══ SPOTY ══ */}
          <Section title={isOwner ? 'MOJE SPOTY' : 'SPOTY'} count={localSpots.length}>
            {localSpots.length === 0
              ? <EmptyState text="Brak spotów" />
              : (
                <>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 10 }}>
                    {(showAllSpots ? localSpots : localSpots.slice(0, SPOTS_PREVIEW)).map(spot => (
                      <SpotPreviewCard key={spot.id} spot={spot} isOwner={isOwner} onPress={() => setSelectedSpot(toSpot(spot))} onDeleted={id => setLocalSpots(prev => prev.filter(s => s.id !== id))} />
                    ))}
                  </View>
                  {localSpots.length > SPOTS_PREVIEW && (
                    <TouchableOpacity
                      style={{ marginTop: 10, paddingVertical: 12, backgroundColor: theme.surface, borderRadius: 12, borderWidth: 1, borderColor: theme.border, alignItems: 'center' }}
                      onPress={() => setShowAllSpots(p => !p)} activeOpacity={0.75}
                    >
                      <Text style={{ fontFamily: 'Orbitron', color: theme.textDim, fontSize: 9, letterSpacing: 1 }}>
                        {showAllSpots ? '▲  UKRYJ' : `▼  ZOBACZ WIĘCEJ (${localSpots.length - SPOTS_PREVIEW})`}
                      </Text>
                    </TouchableOpacity>
                  )}
                </>
              )
            }
          </Section>

        </View>

        <SpotDetailModal visible={selectedSpot !== null} spot={selectedSpot} onClose={() => setSelectedSpot(null)} getDistance={() => 0} onLikeToggle={handleLikeToggle} />
        <RoutesListModal visible={routesModalVisible} routes={routes} onClose={() => setRoutesModalVisible(false)} onNavigate={onNavigateRoute} onShare={onShareRoute} onDelete={onDeleteRoute} onLeaderboard={route => { setRoutesModalVisible(false); setTimeout(() => handleLeaderboard(route), 350); }} isOwner={isOwner} />
      </ScrollView>

      <RouteLeaderboardModal visible={lbVisible} routeId={lbRouteId} routeName={lbRouteName} data={lbData} runsData={lbRunsData} loading={lbLoading} onClose={() => { setLbVisible(false); setLbRouteId(null); setLbRouteName(''); }} />
      <FriendsModal visible={friendsModalVisible} friends={friends} loading={false} isOwner={isOwner} onClose={() => setFriendsModalVisible(false)} onRemove={async (f) => { await removeFriend(f.id); fetchFriends(); }} />
      <FriendRequestsModal
        visible={invitesModalVisible}
        requests={requests}
        onClose={() => setInvitesModalVisible(false)}
        onAccept={async (id) => { await acceptRequest(id); }}
        onReject={async (id) => { await rejectRequest(id); }}
      />

      {/* ══ STATS MODAL ══ */}
      <Modal visible={statsModalVisible} transparent animationType="none" onRequestClose={closeStats} statusBarTranslucent>
        <View style={{ flex: 1, backgroundColor: '#000000aa', justifyContent: 'flex-end' }}>
          <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={closeStats} />
          <Animated.View
            style={{
              transform: [{ translateY: statsSlide.interpolate({ inputRange: [0, 1], outputRange: [0, Dimensions.get('window').height] }) }],
              backgroundColor: isDark ? '#111' : '#f8f8f8',
              borderTopLeftRadius: 28, borderTopRightRadius: 28,
              borderWidth: 1, borderBottomWidth: 0, borderColor: isDark ? '#ffffff10' : '#00000010',
              maxHeight: '92%',
            }}
          >
            {/* Modal handle */}
            <View style={{ alignItems: 'center', paddingTop: 12, paddingBottom: 4 }}>
              <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: isDark ? '#ffffff25' : '#00000020' }} />
            </View>

            {/* Modal header */}
            <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderColor: isDark ? '#ffffff0a' : '#0000000a' }}>
              <View style={{ backgroundColor: '#e3383515', borderRadius: 10, padding: 8, marginRight: 12 }}>
                <MaterialIcons name="bar-chart" size={18} color="#e33835" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: 'Orbitron', fontSize: 14, color: isDark ? '#fff' : '#000', fontWeight: '900', letterSpacing: 1 }}>STATYSTYKI</Text>
                <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: '#e33835', letterSpacing: 2, marginTop: 2 }}>{profile?.username ?? ''}</Text>
              </View>
              <TouchableOpacity onPress={closeStats} style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: isDark ? '#ffffff10' : '#00000010', alignItems: 'center', justifyContent: 'center' }}>
                <MaterialIcons name="close" size={18} color={isDark ? '#fff' : '#000'} />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
              {/* PRĘDKOŚĆ */}
              <StatsModalSection title="PRĘDKOŚĆ" color="#e33835" icon="speedometer">
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
                  <StatsModalItem label="TOP SPEED" value={`${Math.round(profile?.topSpeed ?? 0)}`} unit="km/h" color="#e33835" isDark={isDark} />
                  <StatsModalItem label="ŚR. PRĘDKOŚĆ" value={`${Math.round((profile as any)?.avgSpeed ?? 0)}`} unit="km/h" color="#ff6b35" isDark={isDark} />
                  <StatsModalItem label="ŚR. MAX" value={`${Math.round((profile as any)?.avgMaxSpeed ?? 0)}`} unit="km/h" color="#ff922b" isDark={isDark} />
                </View>
              </StatsModalSection>

              {/* DYSTANS */}
              <StatsModalSection title="DYSTANS" color="#268bff" icon="road-variant">
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
                  <StatsModalItem label="ŁĄCZNIE" value={`${Math.round(profile?.totalDistance ?? 0)}`} unit="km" color="#268bff" isDark={isDark} />
                  <StatsModalItem label="MIESIĘCZNY" value={`${Math.round((profile as any)?.monthlyDistance ?? 0)}`} unit="km" color="#268bff" isDark={isDark} />
                  <StatsModalItem label="TYGODNIOWY" value={`${Math.round((profile as any)?.weeklyDistance ?? 0)}`} unit="km" color="#268bff" isDark={isDark} />
                  <StatsModalItem label="DZIENNY" value={`${Math.round((profile as any)?.dailyDistance ?? 0)}`} unit="km" color="#268bff" isDark={isDark} />
                </View>
              </StatsModalSection>

              {/* AKTYWNOŚĆ */}
              <StatsModalSection title="AKTYWNOŚĆ" color="#4de926" icon="fire">
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
                  <StatsModalItem label="TRASY ŁĄCZNIE" value={`${routes.length}`} unit="szt." color="#4de926" isDark={isDark} />
                  <StatsModalItem label="TRASY MIES." value={`${(profile as any)?.monthlyRoutes ?? 0}`} unit="szt." color="#4de926" isDark={isDark} />
                  <StatsModalItem label="MEETY" value={`${profile?.meetCount ?? 0}`} unit="szt." color="#ff6b35" isDark={isDark} />
                  <StatsModalItem label="STREAK" value={`${(profile as any)?.streak ?? 0}`} unit="🔥" color="#ff922b" isDark={isDark} />
                  <StatsModalItem label="MIASTA" value={`${profile?.cityCount ?? 0}`} unit="odw." color="#a855f7" isDark={isDark} />
                  <StatsModalItem label="SPOTY" value={`${localSpots.length}`} unit="szt." color="#4de926" isDark={isDark} />
                  <StatsModalItem label="SAMOCHODY" value={`${cars.length}`} unit="szt." color="#268bff" isDark={isDark} />
                </View>
              </StatsModalSection>

              {/* OSIĄGNIĘCIA */}
              <StatsModalSection title="OSIĄGNIĘCIA" color="#f5c518" icon="trophy">
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
                  <StatsModalItem label="ODBLOKOWANE" value={`${unlocked.length}`} unit="szt." color="#f5c518" isDark={isDark} />
                  <StatsModalItem label="WSZYSTKIE" value={`${achievements.length}`} unit="szt." color="#f5c518" isDark={isDark} />
                  <StatsModalItem label="OBSERWUJĄCY" value={`${profile?.followersCount ?? 0}`} unit="os." color="#4de926" isDark={isDark} />
                  {!!profile?.position && (
                    <StatsModalItem label="RANKING" value={`#${profile.position}`} color="#e33835" isDark={isDark} />
                  )}
                </View>
              </StatsModalSection>
            </ScrollView>
          </Animated.View>
        </View>
      </Modal>
    </>
  );
}

// ── Helpers ───────────────────────────────────────────────
import { StyleSheet } from 'react-native';

function Section({ title, count, right, children }: {
  title: string; count?: number | string; right?: React.ReactNode; children: React.ReactNode;
}) {
  const { theme } = useTheme();
  return (
    <View style={{ marginBottom: 24 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 14, gap: 10 }}>
        <Text style={{ fontFamily: 'Orbitron', color: theme.text, fontSize: 13, fontWeight: '700', letterSpacing: 1, flex: 1 }}>{title}</Text>
        {count !== undefined && (
          <View style={{ backgroundColor: theme.surface, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 3, borderWidth: 1, borderColor: theme.border }}>
            <Text style={{ fontFamily: 'Orbitron', fontSize: 10, color: theme.textDim }}>{count}</Text>
          </View>
        )}
        {right}
      </View>
      {children}
    </View>
  );
}

function EmptyState({ text }: { text: string }) {
  const { theme } = useTheme();
  return (
    <View style={{ paddingVertical: 20, alignItems: 'center', backgroundColor: theme.surface, borderRadius: 14, borderWidth: 1, borderColor: theme.border }}>
      <Text style={{ fontFamily: 'Orbitron', color: theme.textDim, fontSize: 10 }}>{text}</Text>
    </View>
  );
}

function RarityDivider({ meta, count }: { meta: { label: string; color: string; border: string }; count: number }) {
  const { theme } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 }}>
      <View style={{ flex: 1, height: 1, backgroundColor: meta.border }} />
      <View style={{ paddingHorizontal: 10, paddingVertical: 3, borderRadius: 20, borderWidth: 1, borderColor: meta.border, backgroundColor: theme.bg }}>
        <Text style={{ fontFamily: 'Orbitron', fontSize: 8, letterSpacing: 2, color: meta.color }}>{meta.label}</Text>
      </View>
      <View style={{ flex: 1, height: 1, backgroundColor: meta.border }} />
      <Text style={{ fontFamily: 'Orbitron', fontSize: 9, color: meta.color }}>{count}</Text>
    </View>
  );
}

function StatsModalSection({ title, color, icon, children }: { title: string; color: string; icon: string; children: React.ReactNode }) {
  return (
    <View style={{ marginBottom: 24 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14 }}>
        <View style={{ width: 28, height: 28, borderRadius: 8, backgroundColor: color + '20', alignItems: 'center', justifyContent: 'center' }}>
          <MaterialCommunityIcons name={icon as any} size={14} color={color} />
        </View>
        <Text style={{ fontFamily: 'Orbitron', fontSize: 9, color, letterSpacing: 3, fontWeight: '700' }}>{title}</Text>
        <View style={{ flex: 1, height: 1, backgroundColor: color + '25', marginLeft: 4 }} />
      </View>
      {children}
    </View>
  );
}

function StatsModalItem({ label, value, unit, color, isDark }: { label: string; value: string; unit?: string; color: string; isDark: boolean }) {
  return (
    <View style={{ minWidth: '30%', flex: 1, backgroundColor: isDark ? '#1a1a1a' : '#f0f0f0', borderRadius: 14, borderWidth: 1, borderColor: color + '30', padding: 12, alignItems: 'center', gap: 3 }}>
      <Text style={{ fontFamily: 'Orbitron', fontSize: 18, color, fontWeight: '900', letterSpacing: -0.5 }}>{value}</Text>
      {!!unit && <Text style={{ fontFamily: 'Orbitron', fontSize: 7, color: color + 'bb', letterSpacing: 1 }}>{unit}</Text>}
      <Text style={{ fontFamily: 'Orbitron', fontSize: 6, color: isDark ? '#ffffff50' : '#00000050', letterSpacing: 0.5, textAlign: 'center', marginTop: 2 }}>{label}</Text>
    </View>
  );
}