import React, { useState, useRef } from 'react';
import {
  ScrollView, View, Text, TouchableOpacity, RefreshControl,
  Image, Animated, Dimensions, StatusBar,
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
  onAddCar, onCarPress, onBack, onNavigateRoute, onShareRoute,
}: Props) {
  const { theme, isDark } = useTheme();
  const router = useRouter();
  const { friends, fetchFriends, requests, fetchRequests, acceptRequest, rejectRequest, removeFriend } = useChat();

  const [selectedSpot,        setSelectedSpot]        = useState<Spot | null>(null);
  const [localSpots,          setLocalSpots]          = useState<SpotPreview[]>([]);
  const [showAllAchs,         setShowAllAchs]         = useState(false);
  const [routesModalVisible,  setRoutesModalVisible]  = useState(false);
  const [lbVisible,           setLbVisible]           = useState(false);
  const [lbRouteId,           setLbRouteId]           = useState<number | null>(null);
  const [lbRouteName,         setLbRouteName]         = useState('');
  const [friendsModalVisible, setFriendsModalVisible] = useState(false);
  const ROUTES_PREVIEW = 0;

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
              {isOwner && (
                <TouchableOpacity
                  onPress={onEdit}
                  style={{ position: 'absolute', bottom: 0, right: 0, width: 24, height: 24, borderRadius: 12, backgroundColor: '#e33835', alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: theme.bg }}
                >
                  <MaterialIcons name="edit" size={11} color="#fff" />
                </TouchableOpacity>
              )}
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

          {/* Dołączył + edit btn */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 20 }}>
            <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: theme.surface, borderRadius: 12, padding: 10, borderWidth: 1, borderColor: theme.border }}>
              <MaterialIcons name="calendar-today" size={13} color={theme.textDim} />
              <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: theme.textDim }}>Dołączył: {joinedLabel}</Text>
            </View>
            {isOwner && (
              <TouchableOpacity
                style={{ backgroundColor: '#e33835', borderRadius: 12, paddingHorizontal: 16, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 6 }}
                onPress={onEdit} activeOpacity={0.85}
              >
                <MaterialIcons name="edit" size={14} color="#fff" />
                <Text style={{ fontFamily: 'Orbitron', fontSize: 9, color: '#fff', fontWeight: '700' }}>EDYTUJ</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* ══ STATS GRID ══ */}
          <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: theme.textDim, letterSpacing: 4, marginBottom: 12 }}>STATYSTYKI</Text>

          {/* TOP SPEED card */}
          <View style={{ borderRadius: 20, overflow: 'hidden', marginBottom: 10, borderWidth: 1, borderColor: '#e3383540' }}>
            <LinearGradient
              colors={isDark ? ['#1a0808', '#0d0404', '#080808'] : ['#fff5f5', '#fffafa']}
              start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
              style={{ padding: 18, flexDirection: 'row', alignItems: 'center' }}
            >
              <View style={{ position: 'absolute', right: -20, top: -20, width: 120, height: 120, borderRadius: 60, backgroundColor: '#e3383510' }} />
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                  <View style={{ backgroundColor: '#e3383520', padding: 5, borderRadius: 7 }}>
                    <MaterialCommunityIcons name="speedometer" size={12} color="#e33835" />
                  </View>
                  <Text style={{ fontFamily: 'Orbitron', fontSize: 7, color: '#e33835', letterSpacing: 3 }}>TOP SPEED</Text>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4 }}>
                  <Text style={{ fontFamily: 'Orbitron', fontSize: 52, color: '#e33835', fontWeight: '900', letterSpacing: -2, lineHeight: 58 }}>
                    {Math.round(profile?.topSpeed ?? 0)}
                  </Text>
                  <Text style={{ fontFamily: 'Orbitron', fontSize: 14, color: '#e3383570', fontWeight: '700' }}>km/h</Text>
                </View>
              </View>
              <View style={{ gap: 12, alignItems: 'flex-end' }}>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={{ fontFamily: 'Orbitron', fontSize: 16, color: theme.text, fontWeight: '700' }}>{Math.round(profile?.totalDistance ?? 0)} km</Text>
                  <Text style={{ fontFamily: 'Orbitron', fontSize: 7, color: theme.textDim, letterSpacing: 2, marginTop: 2 }}>ŁĄCZNIE</Text>
                </View>
                <View style={{ width: 50, height: 1, backgroundColor: isDark ? '#ffffff15' : '#00000015' }} />
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={{ fontFamily: 'Orbitron', fontSize: 16, color: theme.text, fontWeight: '700' }}>{profile?.meetCount ?? 0}</Text>
                  <Text style={{ fontFamily: 'Orbitron', fontSize: 7, color: theme.textDim, letterSpacing: 2, marginTop: 2 }}>MEETY</Text>
                </View>
              </View>
            </LinearGradient>
          </View>

          {/* 4-stat grid */}
          <View style={{ flexDirection: 'row', gap: 8, marginBottom: 20 }}>
            {[
              { label: 'KILOMETRY', value: `${Math.round(profile?.totalDistance ?? 0)}`, unit: 'km',   color: '#268bff', icon: 'road-variant',   lib: 'mci' },
              { label: 'ZLOTY',     value: String(profile?.meetCount ?? 0),               unit: 'szt.', color: '#ff6b35', icon: 'flag-checkered', lib: 'mci' },
              { label: 'MIASTA',    value: String(profile?.cityCount ?? 0),               unit: 'odw.', color: '#a855f7', icon: 'location-city',  lib: 'mi'  },
              { label: 'STREAK',    value: String((profile as any)?.streak ?? 0),         unit: '🔥',   color: '#ff922b', icon: 'fire',           lib: 'mci' },
            ].map(item => (
              <View key={item.label} style={{ flex: 1, backgroundColor: theme.surface, borderRadius: 14, borderWidth: 1, borderColor: theme.border, padding: 12, alignItems: 'center', gap: 4 }}>
                <View style={{ width: 30, height: 30, borderRadius: 9, backgroundColor: item.color + '18', alignItems: 'center', justifyContent: 'center', marginBottom: 2 }}>
                  {item.lib === 'mci'
                    ? <MaterialCommunityIcons name={item.icon as any} size={14} color={item.color} />
                    : <MaterialIcons name={item.icon as any} size={14} color={item.color} />
                  }
                </View>
                <Text style={{ fontFamily: 'Orbitron', fontSize: 17, color: theme.text, fontWeight: '900' }}>{item.value}</Text>
                <Text style={{ fontFamily: 'Orbitron', fontSize: 6, color: item.color, letterSpacing: 1 }}>{item.unit}</Text>
                <Text style={{ fontFamily: 'Orbitron', fontSize: 6, color: theme.textDim, letterSpacing: 0.5 }}>{item.label}</Text>
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
          {isOwner && requests.length > 0 && (
            <View style={{ backgroundColor: theme.surface, borderRadius: 16, borderWidth: 1, borderColor: '#e3383530', marginBottom: 20, overflow: 'hidden' }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: theme.border, gap: 10 }}>
                <View style={{ width: 32, height: 32, borderRadius: 9, backgroundColor: '#e3383515', borderWidth: 1, borderColor: '#e3383530', alignItems: 'center', justifyContent: 'center' }}>
                  <MaterialIcons name="person-add" size={16} color="#e33835" />
                </View>
                <Text style={{ fontFamily: 'Orbitron', color: theme.text, fontSize: 11, fontWeight: '700', flex: 1 }}>ZAPROSZENIA</Text>
                <View style={{ backgroundColor: '#e3383520', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 3, borderWidth: 1, borderColor: '#e3383540' }}>
                  <Text style={{ fontFamily: 'Orbitron', fontSize: 10, color: '#e33835', fontWeight: '700' }}>{requests.length}</Text>
                </View>
              </View>
              {requests.map((req, index) => (
                <View key={req.id} style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, gap: 12, borderBottomWidth: index < requests.length - 1 ? 1 : 0, borderBottomColor: theme.border }}>
                  <View style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }}>
                    {req.requester.avatarUrl
                      ? <Image source={{ uri: req.requester.avatarUrl }} style={{ width: 42, height: 42 }} />
                      : <Text style={{ fontFamily: 'Orbitron', fontSize: 14, color: theme.textDim, fontWeight: '700' }}>{req.requester.username.slice(0, 2).toUpperCase()}</Text>
                    }
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontFamily: 'Orbitron', fontSize: 11, color: theme.text, fontWeight: '700' }}>{req.requester.username}</Text>
                    <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: theme.textDim, marginTop: 2 }}>chce zostać Twoim znajomym</Text>
                  </View>
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <TouchableOpacity onPress={() => acceptRequest(req.id)} style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: '#4de92620', borderWidth: 1, borderColor: '#4de92645', alignItems: 'center', justifyContent: 'center' }}>
                      <MaterialIcons name="check" size={17} color="#4de926" />
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => rejectRequest(req.id)} style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: '#e3383520', borderWidth: 1, borderColor: '#e3383540', alignItems: 'center', justifyContent: 'center' }}>
                      <MaterialIcons name="close" size={17} color="#e33835" />
                    </TouchableOpacity>
                  </View>
                </View>
              ))}
            </View>
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
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 10 }}>
                  {localSpots.map(spot => (
                    <SpotPreviewCard key={spot.id} spot={spot} isOwner={isOwner} onPress={() => setSelectedSpot(toSpot(spot))} onDeleted={id => setLocalSpots(prev => prev.filter(s => s.id !== id))} />
                  ))}
                </View>
              )
            }
          </Section>

        </View>

        <SpotDetailModal visible={selectedSpot !== null} spot={selectedSpot} onClose={() => setSelectedSpot(null)} getDistance={() => 0} onLikeToggle={handleLikeToggle} />
        <RoutesListModal visible={routesModalVisible} routes={routes} onClose={() => setRoutesModalVisible(false)} onNavigate={onNavigateRoute} onShare={onShareRoute} onDelete={onDeleteRoute} onLeaderboard={route => { setRoutesModalVisible(false); setTimeout(() => handleLeaderboard(route), 350); }} isOwner={isOwner} />
      </ScrollView>

      <RouteLeaderboardModal visible={lbVisible} routeId={lbRouteId} routeName={lbRouteName} data={lbData} runsData={lbRunsData} loading={lbLoading} onClose={() => { setLbVisible(false); setLbRouteId(null); setLbRouteName(''); }} />
      <FriendsModal visible={friendsModalVisible} friends={friends} loading={false} isOwner={isOwner} onClose={() => setFriendsModalVisible(false)} onRemove={async (f) => { await removeFriend(f.id); fetchFriends(); }} />
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