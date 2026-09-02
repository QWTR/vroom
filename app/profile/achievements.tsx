import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, TouchableOpacity, ScrollView, ActivityIndicator } from 'react-native';
import { AppText as Text } from '../../components/ui/AppText';
import { useRouter, useLocalSearchParams } from 'expo-router';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useTheme } from '../../contexts/ThemeContext';
import { useAchievements } from '../../hooks/useAchievements';
import {
  groupAchievementsByRarity,
  sortAchievementsByRarity,
} from '../../constants/achievementLabels';
import { GLASS_SHADOW } from '../../components/profile/profileCardTheme';
import AchievementBox from '../../components/profile/AchievementBox';
import { RarityDivider, AchievementGrid } from '../../components/profile/AchievementsPreviewSection';
import { useScreenHeaderTop } from '../../lib/screenHeaderInsets';

export default function AchievementsScreen() {
  const router = useRouter();
  const { userId } = useLocalSearchParams<{ userId?: string }>();
  const { theme } = useTheme();
  const headerTop = useScreenHeaderTop(8);
  const { achievements, loading, fetchMyAchievements, fetchAchievements } = useAchievements();
  const [showLocked, setShowLocked] = useState(false);
  const [scope, setScope] = useState<'global' | 'season'>('global');

  const isOwner = !userId;
  const parsedUserId = userId ? Number(userId) : null;

  const load = useCallback(async () => {
    if (isOwner) {
      await fetchMyAchievements();
      return;
    }
    if (parsedUserId && Number.isFinite(parsedUserId)) {
      await fetchAchievements(parsedUserId);
    }
  }, [fetchAchievements, fetchMyAchievements, isOwner, parsedUserId]);

  useEffect(() => {
    void load();
  }, [load]);

  const scoped = useMemo(() => achievements.filter((a) => (a.scope || 'global') === scope), [achievements, scope]);
  const unlocked = useMemo(() => sortAchievementsByRarity(scoped.filter(a => a.active)), [scoped]);
  const locked = useMemo(() => sortAchievementsByRarity(scoped.filter(a => !a.active)), [scoped]);
  const unlockedGroups = useMemo(() => groupAchievementsByRarity(unlocked), [unlocked]);
  const lockedGroups = useMemo(() => groupAchievementsByRarity(locked), [locked]);

  const countLabel = isOwner
    ? `${unlocked.length}/${achievements.length}`
    : `${unlocked.length}`;

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <View style={{
        flexDirection: 'row',
        alignItems: 'center',
        paddingTop: headerTop,
        paddingHorizontal: 16,
        paddingBottom: 14,
        borderBottomWidth: 1,
        borderBottomColor: theme.border,
        gap: 12,
      }}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={{
            width: 40,
            height: 40,
            borderRadius: 12,
            borderWidth: 1,
            borderColor: theme.border,
            backgroundColor: theme.surface,
            alignItems: 'center',
            justifyContent: 'center',
            ...GLASS_SHADOW,
          }}
        >
          <MaterialIcons name="arrow-back" size={22} color={theme.text} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={{ fontFamily: 'Manrope_600SemiBold', fontSize: 16, color: theme.text, fontWeight: '700', letterSpacing: 1 }}>
            OSIĄGNIĘCIA
          </Text>
          <Text style={{ fontFamily: 'Manrope_600SemiBold', fontSize: 12, color: theme.textDim, letterSpacing: 1, marginTop: 2 }}>
            {countLabel}
          </Text>
        </View>
      </View>

      {loading && achievements.length === 0 ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={theme.primary} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
          <View style={{ flexDirection: 'row', gap: 8, marginBottom: 16 }}>
            {([['global', 'OGÓLNE'], ['season', 'SEZONOWE']] as const).map(([key, label]) => (
              <TouchableOpacity key={key} onPress={() => setScope(key)} style={{ flex: 1, borderRadius: 12, borderWidth: 1, borderColor: scope === key ? theme.primary : theme.border, backgroundColor: scope === key ? `${theme.primary}18` : theme.surface, paddingVertical: 12, alignItems: 'center' }}>
                <Text style={{ fontFamily: 'Manrope_600SemiBold', fontSize: 12, fontWeight: '800', color: scope === key ? theme.primary : theme.textDim }}>{label}</Text>
              </TouchableOpacity>
            ))}
          </View>
          {unlocked.length === 0 ? (
            <View style={{
              backgroundColor: theme.surface,
              borderRadius: 20,
              borderWidth: 1,
              borderColor: theme.border,
              paddingVertical: 28,
              alignItems: 'center',
              ...GLASS_SHADOW,
            }}>
              <Text style={{ fontFamily: 'Manrope_600SemiBold', fontSize: 12, color: theme.textDim, letterSpacing: 1 }}>
                Brak odblokowanych osiągnięć
              </Text>
            </View>
          ) : (
            unlockedGroups.map(({ rarity, items }) => (
              <View key={rarity} style={{ marginBottom: 20 }}>
                <RarityDivider
                  rarity={rarity}
                  count={items.length}
                  surfaceTheme={{
                    text: theme.text,
                    textDim: theme.textDim,
                    surface: theme.surface,
                    border: theme.border,
                    bg: theme.bg,
                  }}
                />
                <AchievementGrid items={items} />
              </View>
            ))
          )}

          {isOwner && locked.length > 0 && (
            <>
              <TouchableOpacity
                style={{
                  backgroundColor: theme.surface,
                  borderRadius: 20,
                  borderWidth: 1,
                  borderColor: theme.border,
                  padding: 16,
                  alignItems: 'center',
                  marginBottom: showLocked ? 16 : 0,
                  ...GLASS_SHADOW,
                }}
                onPress={() => setShowLocked(v => !v)}
                activeOpacity={0.75}
              >
                <Text style={{ fontFamily: 'Manrope_600SemiBold', fontSize: 12, color: theme.textDim, letterSpacing: 1 }}>
                  {showLocked ? '▲  UKRYJ ZABLOKOWANE' : `▼  ZABLOKOWANE (${locked.length})`}
                </Text>
              </TouchableOpacity>

              {showLocked && lockedGroups.map(({ rarity, items }) => (
                <View key={`locked-${rarity}`} style={{ marginBottom: 20, opacity: 0.75 }}>
                  <RarityDivider
                    rarity={rarity}
                    count={items.length}
                    surfaceTheme={{
                      text: theme.text,
                      textDim: theme.textDim,
                      surface: theme.surface,
                      border: theme.border,
                      bg: theme.bg,
                    }}
                  />
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
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
              ))}
            </>
          )}
        </ScrollView>
      )}
    </View>
  );
}
