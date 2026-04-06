import React, { useState } from 'react';
import {
  ScrollView, View, Text, TouchableOpacity, RefreshControl,
} from 'react-native';
import MaterialIcons            from '@expo/vector-icons/MaterialIcons';
import Ionicons                 from '@expo/vector-icons/Ionicons';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme }             from '../../contexts/ThemeContext';

import AvatarCircle             from './AvatarCircle';
import StatBox                  from './StatBox';
import CarCard                  from './CarCard';
import AchievementBox           from './AchievementBox';
import SpotPreviewCard          from './SpotPreviewCard';
import { SpotDetailModal }      from '../spots/SpotDetailModal';
import type { Achievement }     from '../../hooks/useAchievements';
import type { UserProfile, Car, SpotPreview } from '../../constants/profile';
import type { Spot }            from '../../constants/spotTypes';
import RouteCard                from './RouteCard';
import type { MyRoute }         from '../../hooks/useMyRoutes';
import { RoutesListModal }      from '../modals/RoutesListModal';
import { RouteLeaderboardModal } from '../modals/RouteLeaderboardModal';
import { useRouteLeaderboard }  from '../../hooks/useRouteLeaderboard';
import ParticipatedRoutesSection from './ParticipatedRouteCard';
import type { ParticipatedRoute } from '../../hooks/useParticipatedRoutes';

const RARITY_ORDER: Record<string, number> = { legendary: 0, epic: 1, rare: 2, common: 3 };
const RARITY_META: Record<string, { label: string; color: string; border: string }> = {
  legendary: { label: 'LEGENDARY', color: '#f5c518', border: '#f5c51840' },
  epic:      { label: 'EPIC',      color: '#a338e3', border: '#a338e340' },
  rare:      { label: 'RARE',      color: '#38a5e3', border: '#38a5e340' },
  common:    { label: 'COMMON',    color: '#ff0202b2', border: '#ff0202b2' },
};

function sortByRarity(list: Achievement[]): Achievement[] {
  return [...list].sort((a, b) => (RARITY_ORDER[a.rarity ?? 'common'] ?? 3) - (RARITY_ORDER[b.rarity ?? 'common'] ?? 3));
}
function groupByRarity(list: Achievement[]): { rarity: string; items: Achievement[] }[] {
  return ['legendary','epic','rare','common'].reduce((acc, rarity) => {
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
  routes, routesLoading, participatedRoutes, participatedRoutesLoading, onNavigateParticipated,
  onDeleteRoute, onRefresh, onSettings, onEdit, onAddCar,
  onCarPress, onBack, onNavigateRoute, onShareRoute,
}: Props) {
  const { theme } = useTheme();

  const [selectedSpot,        setSelectedSpot]        = useState<Spot | null>(null);
  const [localSpots,          setLocalSpots]          = useState<SpotPreview[]>([]);
  const [showAllAchs,         setShowAllAchs]         = useState(false);
  const [routesModalVisible,  setRoutesModalVisible]  = useState(false);
  const [lbVisible,           setLbVisible]           = useState(false);
  const [lbRouteId,           setLbRouteId]           = useState<number | null>(null);
  const [lbRouteName,         setLbRouteName]         = useState('');
  const ROUTES_PREVIEW = 0;

  const { data: lbData, runsData: lbRunsData, loading: lbLoading, fetchLeaderboard, fetchRuns } = useRouteLeaderboard();

  const handleLeaderboard = async (route: { id: number; name: string }) => {
    setLbRouteId(route.id); setLbRouteName(route.name); setLbVisible(true);
    await Promise.all([fetchLeaderboard(route.id), fetchRuns(route.id)]);
  };

  React.useEffect(() => { setLocalSpots(spots); }, [spots]);

  const handleLikeToggle = (spotId: string, liked: boolean, count: number) => {
    setLocalSpots(prev => prev.map(s => String(s.id) === spotId ? { ...s, isLiked: liked, likesCount: count } : s));
    setSelectedSpot(prev => prev?.id === spotId ? { ...prev, isLiked: liked, likesCount: count } : prev);
  };

  const unlocked = sortByRarity(achievements.filter(a => a.active));
  const locked   = sortByRarity(achievements.filter(a => !a.active));
  const unlockedGroups = groupByRarity(unlocked);
  const lockedGroups   = groupByRarity(locked);

  const SectionHeader = ({ title, right }: { title: string; right?: React.ReactNode }) => (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15 }}>
      <Text style={{ fontFamily: 'Orbitron', color: theme.text, fontSize: 16, letterSpacing: 1 }}>{title}</Text>
      {right}
    </View>
  );

  const ShowAllBtn = ({ onPress, label }: { onPress: () => void; label: string }) => (
    <TouchableOpacity
      style={{ marginVertical: 12, paddingVertical: 12, paddingHorizontal: 16, backgroundColor: theme.surface3, borderRadius: 12, borderWidth: 1, borderColor: theme.primaryBorder, alignItems: 'center', flexDirection: 'row', justifyContent: 'center' }}
      onPress={onPress} activeOpacity={0.75}
    >
      <Text style={{ fontFamily: 'Orbitron', color: theme.primary, fontSize: 10, letterSpacing: 0.5 }}>{label}</Text>
    </TouchableOpacity>
  );

  return (
    <>
      <ScrollView
        style={{ flex: 1, backgroundColor: theme.bgAlt, paddingHorizontal: '5%' }}
        contentContainerStyle={{ paddingBottom: 100 }}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={onRefresh} tintColor={theme.primary} />}
      >
        {/* NAGŁÓWEK */}
        <View style={{ marginTop: 60, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          {onBack ? (
            <TouchableOpacity onPress={onBack} style={{ padding: 4 }}>
              <MaterialIcons name="arrow-back" size={24} color={theme.text} />
            </TouchableOpacity>
          ) : (
            <Text style={{ fontFamily: 'Orbitron', fontSize: 24, color: theme.text, letterSpacing: 2 }}>PROFIL</Text>
          )}
          {onBack && <Text style={{ fontFamily: 'Orbitron', fontSize: 24, color: theme.text, letterSpacing: 2 }}>PROFIL</Text>}
          {isOwner ? (
            <TouchableOpacity style={{ backgroundColor: theme.surface3, padding: 8, borderRadius: 10, borderWidth: 1, borderColor: theme.border2 }} onPress={onSettings}>
              <Ionicons name="settings-outline" size={20} color={theme.textDim} />
            </TouchableOpacity>
          ) : (
            <View style={{ width: 36 }} />
          )}
        </View>

        {/* KARTA PROFILU */}
        <View style={{ backgroundColor: theme.surface3, borderRadius: 15, padding: 20, borderWidth: 1, borderColor: theme.border, marginBottom: 20 }}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', marginBottom: 20 }}>
            <AvatarCircle initials={initials} avatarUrl={profile?.avatarUrl} uploading={avatarUploading} onCameraPress={isOwner ? onEdit : undefined} />
            <View style={{ marginLeft: 20, flex: 1 }}>
              <Text style={{ fontFamily: 'Orbitron', fontSize: 18, color: theme.text, marginBottom: 4 }}>{profile?.username ?? '—'}</Text>
              {!!profile?.location && <Text style={{ fontFamily: 'Orbitron', fontSize: 11, color: theme.textDim, marginBottom: 2 }}>{profile.location}</Text>}
              <Text style={{ fontFamily: 'Orbitron', fontSize: 11, color: theme.textDim, marginBottom: 2 }}>Dołączył: {joinedLabel}</Text>
              {!!profile?.bio && <Text style={{ fontFamily: 'Orbitron', fontSize: 10, color: theme.textMuted, marginTop: 6, lineHeight: 16 }}>{profile.bio}</Text>}
            </View>
          </View>
          {isOwner && (
            <TouchableOpacity style={{ backgroundColor: theme.surface4, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', paddingVertical: 12, borderRadius: 10 }} onPress={onEdit}>
              <MaterialIcons name="edit" size={18} color={theme.text} style={{ marginRight: 8 }} />
              <Text style={{ fontFamily: 'Orbitron', color: theme.text, fontSize: 12 }}>Edytuj profil</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* STATYSTYKI */}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 10, marginBottom: 25 }}>
          <StatBox icon="speed"          label="KILOMETRY" value={`${(Math.round(profile?.totalDistance) ?? 0).toLocaleString('pl-PL')} km`} />
          <StatBox icon="calendar-today" label="ZLOTY"     value={String(profile?.meetCount ?? 0)} />
          <StatBox icon="emoji-events"   label="RANKING"   value={profile?.position ? `#${profile.position}` : '—'} />
          <StatBox icon="location-on"    label="MIASTA"    value={String(profile?.cityCount ?? 0)} />
        </View>

        {/* MOJE AUTA */}
        <View style={{ marginTop: 0, marginBottom: 15 }}>
          <SectionHeader
            title={isOwner ? 'MOJE AUTA' : 'AUTA'}
            right={isOwner && <TouchableOpacity onPress={onAddCar}><Text style={{ fontFamily: 'Orbitron', color: theme.primary, fontSize: 12 }}>+ Dodaj</Text></TouchableOpacity>}
          />
          {cars.length === 0
            ? <Text style={{ fontFamily: 'Orbitron', color: theme.textFaint, fontSize: 11, textAlign: 'center', marginVertical: 15 }}>Brak dodanych aut</Text>
            : cars.map(car => <CarCard key={car.id} brand={car.brand} specs={car.specs} isMain={car.isMain} firstPhoto={car.photos?.[0]} onPress={() => onCarPress(car.id)} />)
          }
        </View>

        {/* OSIĄGNIĘCIA */}
        <View style={{ marginTop: 25, marginBottom: 15 }}>
          <SectionHeader title="OSIĄGNIĘCIA" right={<Text style={{ fontFamily: 'Orbitron', color: theme.primary, fontSize: 11 }}>{unlocked.length}/{achievements.length}</Text>} />

          {achievements.length === 0 ? (
            <Text style={{ fontFamily: 'Orbitron', color: theme.textFaint, fontSize: 11, textAlign: 'center', marginVertical: 15 }}>Ładowanie osiągnięć...</Text>
          ) : (
            <>
              {unlocked.length === 0
                ? <Text style={{ fontFamily: 'Orbitron', color: theme.textFaint, fontSize: 11, textAlign: 'center', marginVertical: 15 }}>Brak odblokowanych osiągnięć</Text>
                : unlockedGroups.map(({ rarity, items }) => {
                    const meta = RARITY_META[rarity] ?? RARITY_META.common;
                    return (
                      <View key={rarity} style={{ marginBottom: 16 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                          <View style={{ flex: 1, height: 1, backgroundColor: meta.border }} />
                          <View style={{ paddingHorizontal: 10, paddingVertical: 3, borderRadius: 20, borderWidth: 1, borderColor: meta.border, backgroundColor: theme.bgAlt }}>
                            <Text style={{ fontFamily: 'Orbitron', fontSize: 8, letterSpacing: 2, color: meta.color }}>{meta.label}</Text>
                          </View>
                          <View style={{ flex: 1, height: 1, backgroundColor: meta.border }} />
                          <Text style={{ fontFamily: 'Orbitron', fontSize: 9, color: meta.color, minWidth: 16, textAlign: 'right' }}>{items.length}</Text>
                        </View>
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                          {items.map(a => <AchievementBox key={a.key} icon={a.icon} label={a.label} active={true} rarity={a.rarity} progress={100} points={a.points} description={a.description} category={a.category} currentValue={a.currentValue} conditionValue={a.conditionValue} conditionField={a.conditionField} unlockedAt={a.unlockedAt} />)}
                        </View>
                      </View>
                    );
                  })
              }
              {locked.length > 0 && (
                <>
                  <ShowAllBtn
                    onPress={() => setShowAllAchs(p => !p)}
                    label={showAllAchs ? '▲  Ukryj zablokowane' : `▼  Zobacz wszystkie osiągnięcia (${locked.length} zablokowanych)`}
                  />
                  {showAllAchs && lockedGroups.map(({ rarity, items }) => {
                    const meta = RARITY_META[rarity] ?? RARITY_META.common;
                    return (
                      <View key={rarity} style={{ marginBottom: 16 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                          <View style={{ flex: 1, height: 1, backgroundColor: meta.border }} />
                          <View style={{ paddingHorizontal: 10, paddingVertical: 3, borderRadius: 20, borderWidth: 1, borderColor: meta.border, backgroundColor: theme.bgAlt }}>
                            <Text style={{ fontFamily: 'Orbitron', fontSize: 8, letterSpacing: 2, color: meta.color }}>{meta.label}</Text>
                          </View>
                          <View style={{ flex: 1, height: 1, backgroundColor: meta.border }} />
                          <Text style={{ fontFamily: 'Orbitron', fontSize: 9, color: meta.color, minWidth: 16, textAlign: 'right' }}>{items.length}</Text>
                        </View>
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                          {items.map(a => <AchievementBox key={a.key} icon={a.icon} label={a.label} active={false} rarity={a.rarity} progress={a.progress} points={a.points} description={a.description} category={a.category} currentValue={a.currentValue} conditionValue={a.conditionValue} conditionField={a.conditionField} unlockedAt={a.unlockedAt} />)}
                        </View>
                      </View>
                    );
                  })}
                </>
              )}
            </>
          )}
        </View>

        {/* PRZEJECHANE TRASY */}
        <View style={{ marginTop: 25, marginBottom: 15 }}>
          <SectionHeader title="PRZEJECHANE TRASY" right={<Text style={{ fontFamily: 'Orbitron', color: theme.primary, fontSize: 11 }}>{participatedRoutes.length}</Text>} />
          {participatedRoutesLoading
            ? <Text style={{ fontFamily: 'Orbitron', color: theme.textFaint, fontSize: 11, textAlign: 'center', marginVertical: 15 }}>Ładowanie...</Text>
            : participatedRoutes.length === 0
            ? <Text style={{ fontFamily: 'Orbitron', color: theme.textFaint, fontSize: 11, textAlign: 'center', marginVertical: 15 }}>Brak przejechanych tras</Text>
            : <ParticipatedRoutesSection routes={participatedRoutes} myId={null} onNavigate={onNavigateParticipated} onLeaderboard={handleLeaderboard} />
          }
        </View>

        {/* MOJE TRASY */}
        <View style={{ marginTop: 25, marginBottom: 15 }}>
          <SectionHeader title={isOwner ? 'MOJE TRASY' : 'TRASY'} right={<Text style={{ fontFamily: 'Orbitron', color: theme.primary, fontSize: 11 }}>{routes.length}</Text>} />
          {routes.length === 0
            ? <Text style={{ fontFamily: 'Orbitron', color: theme.textFaint, fontSize: 11, textAlign: 'center', marginVertical: 15 }}>{routesLoading ? 'Ładowanie...' : 'Brak zapisanych tras'}</Text>
            : (
              <>
                {routes.slice(0, ROUTES_PREVIEW).map(route => (
                  <RouteCard key={route.id} route={route} isOwner={isOwner} onDelete={onDeleteRoute} onNavigate={onNavigateRoute} onShare={onShareRoute} onLeaderboard={handleLeaderboard} />
                ))}
                {routes.length > ROUTES_PREVIEW && (
                  <ShowAllBtn
                    onPress={() => setRoutesModalVisible(true)}
                    label={`ZOBACZ WSZYSTKIE TRASY (${routes.length})`}
                  />
                )}
              </>
            )
          }
        </View>

        {/* SPOTY */}
        <View style={{ marginTop: 25 }}>
          <Text style={{ fontFamily: 'Orbitron', color: theme.text, fontSize: 16, letterSpacing: 1, marginBottom: 15 }}>
            {isOwner ? 'MOJE SPOTY' : 'SPOTY'}
          </Text>
          {localSpots.length === 0
            ? <Text style={{ fontFamily: 'Orbitron', color: theme.textFaint, fontSize: 11, textAlign: 'center', marginVertical: 15 }}>Brak spotów</Text>
            : (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 10, marginBottom: 20 }}>
                {localSpots.map(spot => (
                  <SpotPreviewCard key={spot.id} spot={spot} isOwner={isOwner} onPress={() => setSelectedSpot(toSpot(spot))} onDeleted={id => setLocalSpots(prev => prev.filter(s => s.id !== id))} />
                ))}
              </View>
            )
          }
        </View>

        <SpotDetailModal visible={selectedSpot !== null} spot={selectedSpot} onClose={() => setSelectedSpot(null)} getDistance={() => 0} onLikeToggle={handleLikeToggle} />
        <RoutesListModal visible={routesModalVisible} routes={routes} onClose={() => setRoutesModalVisible(false)} onNavigate={onNavigateRoute} onShare={onShareRoute} onDelete={onDeleteRoute} onLeaderboard={route => { setRoutesModalVisible(false); setTimeout(() => handleLeaderboard(route), 350); }} isOwner={isOwner} />
      </ScrollView>

      <RouteLeaderboardModal visible={lbVisible} routeId={lbRouteId} routeName={lbRouteName} data={lbData} runsData={lbRunsData} loading={lbLoading} onClose={() => { setLbVisible(false); setLbRouteId(null); setLbRouteName(''); }} />
    </>
  );
}