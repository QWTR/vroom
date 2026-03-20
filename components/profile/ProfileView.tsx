import React, { useState } from 'react';
import {
  ScrollView, View, StyleSheet, TouchableOpacity, RefreshControl,
} from 'react-native';
import { Text }            from '@react-navigation/elements';
import MaterialIcons       from '@expo/vector-icons/MaterialIcons';
import Ionicons            from '@expo/vector-icons/Ionicons';

import AvatarCircle        from './AvatarCircle';
import StatBox             from './StatBox';
import CarCard             from './CarCard';
import AchievementBox      from './AchievementBox';
import SpotPreviewCard     from './SpotPreviewCard';
import { SpotDetailModal } from '../spots/SpotDetailModal';
import type { Achievement } from '../../hooks/useAchievements';
import type { UserProfile, Car, SpotPreview } from '../../constants/profile';
import type { Spot } from '../../constants/spotTypes';

// ── Kolejność rzadkości ───────────────────────────────────
const RARITY_ORDER: Record<string, number> = {
  legendary: 0,
  epic:      1,
  rare:      2,
  common:    3,
};

const RARITY_META: Record<string, { label: string; color: string; border: string }> = {
  legendary: { label: 'LEGENDARY', color: '#f5c518', border: '#f5c51840' },
  epic:      { label: 'EPIC',      color: '#a338e3', border: '#a338e340' },
  rare:      { label: 'RARE',      color: '#38a5e3', border: '#38a5e340' },
  common:    { label: 'COMMON',    color: '#ffffff50', border: '#ffffff20' },
};

function sortByRarity(list: Achievement[]): Achievement[] {
  return [...list].sort((a, b) => {
    const ra = RARITY_ORDER[a.rarity ?? 'common'] ?? 3;
    const rb = RARITY_ORDER[b.rarity ?? 'common'] ?? 3;
    return ra - rb;
  });
}

// Pogrupuj po rzadkości i zwróć tablicę grup
function groupByRarity(list: Achievement[]): { rarity: string; items: Achievement[] }[] {
  const order = ['legendary', 'epic', 'rare', 'common'];
  const groups: { rarity: string; items: Achievement[] }[] = [];
  for (const rarity of order) {
    const items = list.filter(a => (a.rarity ?? 'common') === rarity);
    if (items.length > 0) groups.push({ rarity, items });
  }
  return groups;
}

interface Props {
  profile:          UserProfile | null;
  cars:             Car[];
  achievements:     Achievement[];
  spots:            SpotPreview[];
  loading:          boolean;
  isOwner:          boolean;
  initials:         string;
  joinedLabel:      string;
  avatarUploading?: boolean;
  onRefresh:        () => void;
  onSettings:       () => void;
  onEdit:           () => void;
  onAddCar:         () => void;
  onAvatarChange?:  (uri: string) => void;
  onCarPress:       (id: number) => void;
  onSpotPress:      (id: number) => void;
  onBack?:          () => void;
}

function toSpot(s: SpotPreview): Spot {
  return {
    id:            String(s.id),
    name:          s.name,
    description:   s.description   ?? '',
    category:      s.category      as any,
    latitude:      s.latitude,
    longitude:     s.longitude,
    photos:        s.photos        ?? [],
    author:        s.author        ?? 'Nieznany',
    createdAt:     s.createdAt?.split('T')[0] ?? '',
    likesCount:    s.likesCount    ?? 0,
    commentsCount: s.commentsCount ?? 0,
    isLiked:       s.isLiked       ?? false,
  };
}

export default function ProfileView({
  profile, cars, achievements, spots, loading,
  isOwner, initials, joinedLabel, avatarUploading = false,
  onRefresh, onSettings, onEdit, onAddCar,
  onCarPress, onBack,
}: Props) {
  const [selectedSpot, setSelectedSpot] = useState<Spot | null>(null);
  const [localSpots,   setLocalSpots]   = useState<SpotPreview[]>([]);
  const [showAllAchs,  setShowAllAchs]  = useState(false);

  React.useEffect(() => { setLocalSpots(spots); }, [spots]);

  const handleLikeToggle = (spotId: string, liked: boolean, count: number) => {
    setLocalSpots(prev =>
      prev.map(s => String(s.id) === spotId ? { ...s, isLiked: liked, likesCount: count } : s)
    );
    setSelectedSpot(prev =>
      prev?.id === spotId ? { ...prev, isLiked: liked, likesCount: count } : prev
    );
  };

  const unlocked       = sortByRarity(achievements.filter(a =>  a.active));
  const locked         = sortByRarity(achievements.filter(a => !a.active));
  const unlockedGroups = groupByRarity(unlocked);
  const lockedGroups   = groupByRarity(locked);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ paddingBottom: 100 }}
      refreshControl={
        <RefreshControl refreshing={loading} onRefresh={onRefresh} tintColor="#e33835" />
      }
    >
      {/* NAGŁÓWEK */}
      <View style={styles.headerRow}>
        {onBack ? (
          <TouchableOpacity onPress={onBack} style={styles.backBtn}>
            <MaterialIcons name="arrow-back" size={24} color="#fff" />
          </TouchableOpacity>
        ) : (
          <Text style={styles.headerTitle}>PROFIL</Text>
        )}
        {onBack && <Text style={styles.headerTitle}>PROFIL</Text>}
        {isOwner ? (
          <TouchableOpacity style={styles.settingsBtn} onPress={onSettings}>
            <Ionicons name="settings-outline" size={20} color="#ffffff80" />
          </TouchableOpacity>
        ) : (
          <View style={{ width: 36 }} />
        )}
      </View>

      {/* KARTA PROFILU */}
      <View style={styles.profileCard}>
        <View style={styles.profileInfoRow}>
          <AvatarCircle
            initials={initials}
            avatarUrl={profile?.avatarUrl}
            uploading={avatarUploading}
            onCameraPress={isOwner ? onEdit : undefined}
          />
          <View style={styles.nameContainer}>
            <Text style={styles.userName}>{profile?.username ?? '—'}</Text>
            {!!profile?.location && (
              <Text style={styles.userSub}>{profile.location}</Text>
            )}
            <Text style={styles.userSub}>Dołączył: {joinedLabel}</Text>
            {!!profile?.bio && (
              <Text style={styles.userBio}>{profile.bio}</Text>
            )}
          </View>
        </View>
        {isOwner && (
          <TouchableOpacity style={styles.editBtn} onPress={onEdit}>
            <MaterialIcons name="edit" size={18} color="#fff" style={{ marginRight: 8 }} />
            <Text style={styles.editBtnText}>Edytuj profil</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* STATYSTYKI */}
      <View style={styles.statsGrid}>
        <StatBox icon="speed"          label="KILOMETRY" value={`${(profile?.totalDistance ?? 0).toLocaleString('pl-PL')} km`} />
        <StatBox icon="calendar-today" label="ZLOTY"     value={String(profile?.meetCount   ?? 0)} />
        <StatBox icon="emoji-events"   label="RANKING"   value={profile?.position ? `#${profile.position}` : '—'} />
        <StatBox icon="location-on"    label="MIASTA"    value={String(profile?.cityCount   ?? 0)} />
      </View>

      {/* MOJE AUTA */}
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>{isOwner ? 'MOJE AUTA' : 'AUTA'}</Text>
        {isOwner && (
          <TouchableOpacity onPress={onAddCar}>
            <Text style={styles.addText}>+ Dodaj</Text>
          </TouchableOpacity>
        )}
      </View>
      {cars.length === 0 ? (
        <Text style={styles.emptyText}>Brak dodanych aut</Text>
      ) : (
        cars.map(car => (
          <CarCard
            key={car.id}
            brand={car.brand}
            specs={car.specs}
            isMain={car.isMain}
            firstPhoto={car.photos?.[0]}
            onPress={() => onCarPress(car.id)}
          />
        ))
      )}

      {/* ── OSIĄGNIĘCIA ── */}
      <View style={[styles.sectionHeader, { marginTop: 25 }]}>
        <Text style={styles.sectionTitle}>OSIĄGNIĘCIA</Text>
        <Text style={styles.achCount}>
          {unlocked.length}/{achievements.length}
        </Text>
      </View>

      {achievements.length === 0 ? (
        <Text style={styles.emptyText}>Ładowanie osiągnięć...</Text>
      ) : (
        <>
          {/* ── ODBLOKOWANE — pogrupowane po rzadkości ── */}
          {unlocked.length === 0 ? (
            <Text style={styles.emptyText}>Brak odblokowanych osiągnięć</Text>
          ) : (
            unlockedGroups.map(({ rarity, items }) => {
              const meta = RARITY_META[rarity] ?? RARITY_META.common;
              return (
                <View key={rarity} style={styles.rarityGroup}>
                  {/* Nagłówek grupy */}
                  <View style={styles.rarityHeader}>
                    <View style={[styles.rarityLine, { backgroundColor: meta.border }]} />
                    <View style={[styles.rarityBadge, { borderColor: meta.border }]}>
                      <Text style={[styles.rarityBadgeText, { color: meta.color }]}>
                        {meta.label}
                      </Text>
                    </View>
                    <View style={[styles.rarityLine, { backgroundColor: meta.border }]} />
                    <Text style={[styles.rarityCount, { color: meta.color }]}>
                      {items.length}
                    </Text>
                  </View>

                  {/* Kafelki */}
                  <View style={styles.achievementsGrid}>
                    {items.map(a => (
                      <AchievementBox
                        key={a.key}
                        icon={a.icon}
                        label={a.label}
                        active={true}
                        rarity={a.rarity}
                        progress={100}
                        points={a.points}
                        description={a.description}
                        category={a.category}
                        currentValue={a.currentValue}
                        conditionValue={a.conditionValue}
                        conditionField={a.conditionField}
                        unlockedAt={a.unlockedAt}
                      />
                    ))}
                  </View>
                </View>
              );
            })
          )}

          {/* ── ZABLOKOWANE — widoczne po kliknięciu, też pogrupowane ── */}
          {locked.length > 0 && (
            <>
              <TouchableOpacity
                style={styles.showAllBtn}
                onPress={() => setShowAllAchs(prev => !prev)}
                activeOpacity={0.75}
              >
                <Text style={styles.showAllBtnText}>
                  {showAllAchs
                    ? '▲  Ukryj zablokowane'
                    : `▼  Zobacz wszystkie osiągnięcia (${locked.length} zablokowanych)`}
                </Text>
              </TouchableOpacity>

              {showAllAchs && lockedGroups.map(({ rarity, items }) => {
                const meta = RARITY_META[rarity] ?? RARITY_META.common;
                return (
                  <View key={rarity} style={styles.rarityGroup}>
                    <View style={styles.rarityHeader}>
                      <View style={[styles.rarityLine, { backgroundColor: meta.border }]} />
                      <View style={[styles.rarityBadge, { borderColor: meta.border }]}>
                        <Text style={[styles.rarityBadgeText, { color: meta.color }]}>
                          {meta.label}
                        </Text>
                      </View>
                      <View style={[styles.rarityLine, { backgroundColor: meta.border }]} />
                      <Text style={[styles.rarityCount, { color: meta.color }]}>
                        {items.length}
                      </Text>
                    </View>
                    <View style={styles.achievementsGrid}>
                      {items.map(a => (
                        <AchievementBox
                          key={a.key}
                          icon={a.icon}
                          label={a.label}
                          active={false}
                          rarity={a.rarity}
                          progress={a.progress}
                          points={a.points}
                          description={a.description}
                          category={a.category}
                          currentValue={a.currentValue}
                          conditionValue={a.conditionValue}
                          conditionField={a.conditionField}
                          unlockedAt={a.unlockedAt}
                        />
                      ))}
                    </View>
                  </View>
                );
              })}
            </>
          )}
        </>
      )}

      {/* SPOTY */}
      <Text style={[styles.sectionTitle, { marginTop: 25, marginBottom: 15 }]}>
        {isOwner ? 'MOJE SPOTY' : 'SPOTY'}
      </Text>
      {localSpots.length === 0 ? (
        <Text style={styles.emptyText}>Brak spotów</Text>
      ) : (
        <View style={styles.spotsGrid}>
          {localSpots.map(spot => (
            <SpotPreviewCard
              key={spot.id}
              spot={spot}
              isOwner={isOwner}
              onPress={() => setSelectedSpot(toSpot(spot))}
              onDeleted={(deletedId) => {
                setLocalSpots(prev => prev.filter(s => s.id !== deletedId));
              }}
            />
          ))}
        </View>
      )}

      <SpotDetailModal
        visible={selectedSpot !== null}
        spot={selectedSpot}
        onClose={() => setSelectedSpot(null)}
        getDistance={() => 0}
        onLikeToggle={handleLikeToggle}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container:        { flex: 1, backgroundColor: '#0f0f0f', paddingHorizontal: '5%' },
  headerRow:        { marginTop: 60, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  headerTitle:      { fontFamily: 'Orbitron', fontSize: 24, color: '#fff', letterSpacing: 2 },
  backBtn:          { padding: 4 },
  settingsBtn:      { backgroundColor: '#1a1a1a', padding: 8, borderRadius: 10, borderWidth: 1, borderColor: '#ffffff15' },
  profileCard:      { backgroundColor: '#1a1a1a', borderRadius: 15, padding: 20, borderWidth: 1, borderColor: '#ffffff10', marginBottom: 20 },
  profileInfoRow:   { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 20 },
  nameContainer:    { marginLeft: 20, flex: 1 },
  userName:         { fontFamily: 'Orbitron', fontSize: 18, color: '#fff', marginBottom: 4 },
  userSub:          { fontFamily: 'Orbitron', fontSize: 11, color: '#ffffff60', marginBottom: 2 },
  userBio:          { fontFamily: 'Orbitron', fontSize: 10, color: '#ffffff80', marginTop: 6, lineHeight: 16 },
  editBtn:          { backgroundColor: '#252525', flexDirection: 'row', justifyContent: 'center', alignItems: 'center', paddingVertical: 12, borderRadius: 10 },
  editBtnText:      { fontFamily: 'Orbitron', color: '#fff', fontSize: 12 },
  statsGrid:        { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 10, marginBottom: 25 },
  sectionHeader:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15 },
  sectionTitle:     { fontFamily: 'Orbitron', color: '#fff', fontSize: 16, letterSpacing: 1 },
  addText:          { fontFamily: 'Orbitron', color: '#e33835', fontSize: 12 },
  achCount:         { fontFamily: 'Orbitron', color: '#e33835', fontSize: 11 },

  // ── Grupy rzadkości ──
  rarityGroup:      { marginBottom: 16 },
  rarityHeader:     { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  rarityLine:       { flex: 1, height: 1 },
  rarityBadge:      { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 20, borderWidth: 1, backgroundColor: '#0f0f0f' },
  rarityBadgeText:  { fontFamily: 'Orbitron', fontSize: 8, letterSpacing: 2 },
  rarityCount:      { fontFamily: 'Orbitron', fontSize: 9, minWidth: 16, textAlign: 'right' },

  achievementsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  showAllBtn: {
    marginVertical:    12,
    paddingVertical:   12,
    paddingHorizontal: 16,
    backgroundColor:   '#1a1a1a',
    borderRadius:      12,
    borderWidth:       1,
    borderColor:       '#e3383530',
    alignItems:        'center',
  },
  showAllBtnText: {
    fontFamily:    'Orbitron',
    color:         '#e33835',
    fontSize:      10,
    letterSpacing: 0.5,
  },
  spotsGrid:  { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 10, marginBottom: 20 },
  emptyText:  { fontFamily: 'Orbitron', color: '#ffffff40', fontSize: 11, textAlign: 'center', marginVertical: 15 },
});