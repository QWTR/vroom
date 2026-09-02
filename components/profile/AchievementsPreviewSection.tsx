import React, { useMemo } from 'react';
import { View, TouchableOpacity } from 'react-native';
import { AppText as Text } from '../ui/AppText';
import { useTheme } from '../../contexts/ThemeContext';
import type { Achievement } from '../../hooks/useAchievements';
import {
  groupAchievementsByRarity,
  pickAchievementPreview,
  RARITY_META,
} from '../../constants/achievementLabels';
import { GLASS_SHADOW, type ProfileCardTheme } from './profileCardTheme';
import AchievementBox from './AchievementBox';

type ProfileSurface = {
  text: string;
  textDim: string;
  surface: string;
  border: string;
  bg?: string;
};

interface Props {
  achievements: Achievement[];
  theme?: ProfileCardTheme;
  loading?: boolean;
  isOwner?: boolean;
  onSeeAll: () => void;
}

function profileLabel(t: ProfileSurface) {
  return { fontFamily: 'Manrope_600SemiBold' as const, fontSize: 12, color: t.textDim, letterSpacing: 1 };
}

function glassCard(t: ProfileSurface, extra?: Record<string, unknown>) {
  return {
    backgroundColor: t.surface,
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: t.border,
    marginBottom: 16,
    ...GLASS_SHADOW,
    ...extra,
  };
}

function RarityDivider({
  rarity,
  count,
  surfaceTheme,
}: {
  rarity: string;
  count: number;
  surfaceTheme: ProfileSurface;
}) {
  const meta = RARITY_META[rarity] ?? RARITY_META.common;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 }}>
      <View style={{ flex: 1, height: 1, backgroundColor: meta.border }} />
      <View style={{
        paddingHorizontal: 10,
        paddingVertical: 3,
        borderRadius: 20,
        borderWidth: 1,
        borderColor: meta.border,
        backgroundColor: surfaceTheme.bg ?? '#090909',
      }}>
        <Text style={{ fontFamily: 'Manrope_600SemiBold', fontSize: 12, letterSpacing: 1, color: meta.color }}>
          {meta.label}
        </Text>
      </View>
      <View style={{ flex: 1, height: 1, backgroundColor: meta.border }} />
      <Text style={{ fontFamily: 'Manrope_600SemiBold', fontSize: 12, color: meta.color }}>{count}</Text>
    </View>
  );
}

function EmptyState({ text, surfaceTheme }: { text: string; surfaceTheme: ProfileSurface }) {
  return (
    <View style={{ ...glassCard(surfaceTheme, { alignItems: 'center', paddingVertical: 24 }) }}>
      <Text style={{ fontFamily: 'Manrope_600SemiBold', color: surfaceTheme.textDim, fontSize: 12, letterSpacing: 1 }}>{text}</Text>
    </View>
  );
}

function AchievementGrid({ items, theme }: { items: Achievement[]; theme?: ProfileCardTheme }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {items.map(a => (
        <AchievementBox
          key={a.key}
          icon={a.icon}
          label={a.label}
          active={a.active}
          rarity={a.rarity}
          progress={a.progress}
          points={a.points}
          description={a.description}
          category={a.category}
          currentValue={a.currentValue}
          conditionValue={a.conditionValue}
          conditionField={a.conditionField}
          unlockedAt={a.unlockedAt}
          theme={theme}
        />
      ))}
    </View>
  );
}

export default function AchievementsPreviewSection({
  achievements,
  theme: profileTheme,
  loading,
  isOwner = false,
  onSeeAll,
}: Props) {
  const { theme: globalTheme } = useTheme();
  const surfaceTheme: ProfileSurface = {
    text: profileTheme?.text ?? globalTheme.text,
    textDim: profileTheme?.textDim ?? globalTheme.textDim,
    surface: profileTheme?.surface ?? globalTheme.surface,
    border: profileTheme?.border ?? globalTheme.border,
    bg: profileTheme?.bg ?? globalTheme.bg,
  };

  const unlocked = useMemo(() => achievements.filter(a => a.active), [achievements]);
  const lockedCount = useMemo(() => achievements.filter(a => !a.active).length, [achievements]);
  const preview = useMemo(() => pickAchievementPreview(unlocked), [unlocked]);
  const previewGroups = useMemo(() => groupAchievementsByRarity(preview.items), [preview.items]);
  const showSeeAll = preview.hasMore || (isOwner && lockedCount > 0);

  if (loading && achievements.length === 0) {
    return <EmptyState surfaceTheme={surfaceTheme} text="Ładowanie osiągnięć..." />;
  }

  if (unlocked.length === 0) {
    return <EmptyState surfaceTheme={surfaceTheme} text="Brak odblokowanych osiągnięć" />;
  }

  return (
    <>
      {previewGroups.map(({ rarity, items }) => (
        <View key={rarity} style={{ marginBottom: 16 }}>
          <RarityDivider rarity={rarity} count={items.length} surfaceTheme={surfaceTheme} />
          <AchievementGrid items={items} theme={profileTheme} />
        </View>
      ))}

      {showSeeAll && (
        <TouchableOpacity
          style={{ ...glassCard(surfaceTheme, { marginVertical: 0, alignItems: 'center' }) }}
          onPress={onSeeAll}
          activeOpacity={0.75}
        >
          <Text style={{ ...profileLabel(surfaceTheme), textAlign: 'center' }}>
            {`▼  ZOBACZ WSZYSTKIE OSIĄGNIĘCIA (${unlocked.length})`}
          </Text>
        </TouchableOpacity>
      )}
    </>
  );
}

export { RarityDivider, AchievementGrid, EmptyState as AchievementsEmptyState };
