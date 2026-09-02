import React, { useCallback, useMemo, useRef } from 'react';
import { ActivityIndicator, Animated, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import { AppText as Text } from '../ui/AppText';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useTheme } from '../../contexts/ThemeContext';
import {
  formatQuestProgress,
  sortQuestTasks,
  useQuestTrack,
} from '../../lib/questTrack';
import { LiveCountdownText } from './LiveCountdownText';
import { useReadability } from '../../contexts/ReadabilityContext';

const VROOM_RED = '#e33835';
const COMPLETE = '#4de926';

interface Props {
  theme: any;
  fadeAnim: Animated.Value;
  onSynced?: () => void;
}

export function QuestTrackSection({ theme: t, fadeAnim, onSynced }: Props) {
  const router = useRouter();
  const { isDark } = useTheme();
  const { textScale } = useReadability();
  const { width, fontScale } = useWindowDimensions();
  const expandedLayout = Math.min(2, textScale * fontScale) >= 1.2 || width < 370;
  const { data, loading, error, refreshedAt, refresh } = useQuestTrack();
  const notifiedAtRef = useRef(0);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  React.useEffect(() => {
    if (!refreshedAt || refreshedAt === notifiedAtRef.current) return;
    notifiedAtRef.current = refreshedAt;
    onSynced?.();
  }, [onSynced, refreshedAt]);

  const tasks = useMemo(
    () => sortQuestTasks(data?.tasks ?? []).slice(0, 3),
    [data?.tasks],
  );
  const completed = data?.summary.completed ?? 0;
  const total = data?.summary.total ?? data?.tasks.length ?? 0;
  const overallProgress = total > 0 ? completed / total : 0;
  const cardBg = isDark ? 'rgba(20, 5, 5, 0.52)' : 'rgba(255, 255, 255, 0.92)';

  return (
    <Animated.View style={{ opacity: fadeAnim, paddingHorizontal: 20, marginBottom: 18 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10 }}>
        <View style={{ width: 3, height: 14, borderRadius: 2, backgroundColor: VROOM_RED, marginRight: 8 }} />
        <Text style={{ fontFamily: 'Manrope_600SemiBold', fontSize: 12, color: t.textDim, letterSpacing: 1 }}>
          TYGODNIOWY TOR VROOM
        </Text>
      </View>

      <View
        style={{
          backgroundColor: cardBg,
          borderRadius: 20,
          borderWidth: 1,
          borderColor: 'rgba(227, 56, 53, 0.24)',
          padding: 15,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 4 },
          shadowOpacity: 0.35,
          shadowRadius: 10,
          elevation: 4,
        }}
      >
        <View style={{ flexDirection: expandedLayout ? 'column' : 'row', justifyContent: 'space-between', alignItems: expandedLayout ? 'stretch' : 'flex-start', gap: expandedLayout ? 12 : 0 }}>
          <View style={{ flexShrink: 1 }}>
            <Text style={{ fontFamily: 'Manrope_600SemiBold', fontSize: 20, color: VROOM_RED, fontWeight: '900' }}>
              {data?.weeklyPoints ?? 0} pkt
            </Text>
            <Text style={{ fontFamily: 'Manrope_600SemiBold', fontSize: 12, color: t.textDim, marginTop: 3 }}>
              {completed}/{total} ZADAŃ UKOŃCZONYCH
            </Text>
          </View>
          <View style={{ alignItems: expandedLayout ? 'flex-start' : 'flex-end' }}>
            <LiveCountdownText
              targetIso={data?.nextResetAt ?? null}
              prefix="RESET ZA: "
              fallback="RESET: BRAK DANYCH"
              allowWrapping={expandedLayout}
              style={{ fontFamily: 'Manrope_600SemiBold', fontSize: 12, color: t.textDim }}
            />
            {data?.isPremium ? (
              <Text style={{ fontFamily: 'Manrope_600SemiBold', fontSize: 12, color: '#FFD700', marginTop: 5 }}>
                PREMIUM +{Math.round((data.pointsMultiplier - 1) * 100)}%
              </Text>
            ) : null}
          </View>
        </View>

        <View style={{ height: 7, borderRadius: 6, backgroundColor: isDark ? '#2b1717' : '#eadede', marginTop: 14, overflow: 'hidden' }}>
          <View
            testID="quest-overall-progress"
            style={{
              width: `${Math.max(0, Math.min(100, overallProgress * 100))}%`,
              height: '100%',
              borderRadius: 6,
              backgroundColor: overallProgress >= 1 ? COMPLETE : VROOM_RED,
            }}
          />
        </View>

        {loading && !data ? (
          <ActivityIndicator color={VROOM_RED} style={{ marginVertical: 22 }} />
        ) : error && !data ? (
          <TouchableOpacity
            onPress={() => void refresh()}
            style={{ paddingVertical: 18, alignItems: 'center' }}
          >
            <MaterialIcons name="cloud-off" size={24} color={VROOM_RED} />
            <Text style={{ fontFamily: 'Manrope_600SemiBold', fontSize: 12, color: t.text, marginTop: 8 }}>
              BRAK POŁĄCZENIA — SPRÓBUJ PONOWNIE
            </Text>
          </TouchableOpacity>
        ) : (
          <View style={{ marginTop: 10 }}>
            {tasks.map((task) => (
              <View
                key={task.key}
                style={{
                  flexDirection: 'row',
                  alignItems: 'flex-start',
                  paddingVertical: 9,
                  borderTopWidth: 1,
                  borderTopColor: isDark ? 'rgba(227,56,53,0.16)' : 'rgba(227,56,53,0.10)',
                  gap: 10,
                }}
              >
                <MaterialIcons
                  name={task.done ? 'check-circle' : 'radio-button-unchecked'}
                  size={20}
                  color={task.done ? COMPLETE : 'rgba(227,56,53,0.55)'}
                />
                <View style={{ flex: 1 }}>
                  <Text style={{ fontFamily: 'Manrope_600SemiBold', fontSize: 14, lineHeight: 20, color: t.text, fontWeight: '600' }}>
                    {task.label}
                  </Text>
                  <Text style={{ fontFamily: 'Manrope_600SemiBold', fontSize: 12, color: t.textDim, marginTop: 3 }}>
                    {formatQuestProgress(task)}
                  </Text>
                </View>
                <Text style={{ flexShrink: 0, fontFamily: 'Manrope_600SemiBold', fontSize: 13, color: task.done ? COMPLETE : VROOM_RED, fontWeight: '800', paddingTop: 2 }}>
                  +{task.done
                    ? task.earned
                    : Math.round(data?.isPremium ? (task.premiumPoints ?? task.points) : task.points)}
                </Text>
              </View>
            ))}
          </View>
        )}

        <TouchableOpacity
          testID="quest-show-all"
          onPress={() => router.push('/quest-track' as any)}
          activeOpacity={0.8}
          style={{
            marginTop: 8,
            paddingTop: 12,
            borderTopWidth: 1,
            borderTopColor: isDark ? 'rgba(227,56,53,0.18)' : 'rgba(227,56,53,0.12)',
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            minHeight: 48,
            gap: 10,
          }}
        >
          <Text style={{ flex: 1, fontFamily: 'Manrope_600SemiBold', fontSize: 13, color: VROOM_RED, fontWeight: '800' }}>
            POKAŻ WSZYSTKIE ZADANIA
          </Text>
          <MaterialIcons name="arrow-forward-ios" size={13} color={VROOM_RED} />
        </TouchableOpacity>
      </View>
    </Animated.View>
  );
}
