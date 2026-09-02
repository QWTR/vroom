import React, { useCallback, useMemo } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, TouchableOpacity, View } from 'react-native';
import { AppText as Text } from '../components/ui/AppText';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useFocusEffect, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../contexts/ThemeContext';
import {
  formatQuestProgress,
  sortQuestTasks,
  useQuestTrack,
} from '../lib/questTrack';
import { LiveCountdownText } from '../components/home/LiveCountdownText';

const RED = '#e33835';
const GREEN = '#4de926';

export default function QuestTrackScreen() {
  const router = useRouter();
  const { theme, isDark } = useTheme();
  const { data, loading, error, refresh } = useQuestTrack();

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  const tasks = useMemo(() => sortQuestTasks(data?.tasks ?? []), [data?.tasks]);
  const completed = data?.summary.completed ?? 0;
  const total = data?.summary.total ?? 0;
  const overallProgress = total > 0 ? completed / total : 0;
  const card = isDark ? 'rgba(20,5,5,0.62)' : '#ffffff';
  const track = isDark ? '#2c1717' : '#eadede';

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.bg }} edges={['top', 'left', 'right']}>
      <View style={{ paddingHorizontal: 18, paddingVertical: 12, flexDirection: 'row', alignItems: 'center' }}>
        <TouchableOpacity
          testID="quest-back"
          onPress={() => router.back()}
          style={{ width: 42, height: 42, alignItems: 'center', justifyContent: 'center' }}
        >
          <MaterialIcons name="arrow-back-ios-new" size={22} color={theme.text} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={{ fontFamily: 'Manrope_600SemiBold', fontSize: 15, color: theme.text, fontWeight: '900' }}>
            TYGODNIOWY TOR
          </Text>
          <LiveCountdownText
            targetIso={data?.nextResetAt ?? null}
            prefix="RESET ZA: "
            fallback="RESET: BRAK DANYCH"
            style={{ fontFamily: 'Manrope_600SemiBold', fontSize: 12, color: theme.textDim, marginTop: 4 }}
          />
        </View>
        <MaterialIcons name="emoji-events" size={25} color={RED} />
      </View>

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 18, paddingBottom: 34 }}
        refreshControl={(
          <RefreshControl
            refreshing={loading && !!data}
            onRefresh={() => void refresh()}
            tintColor={RED}
            colors={[RED]}
          />
        )}
      >
        <View style={{ backgroundColor: card, borderRadius: 20, borderWidth: 1, borderColor: 'rgba(227,56,53,0.25)', padding: 16, marginBottom: 14 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' }}>
            <View>
              <Text style={{ fontFamily: 'Manrope_600SemiBold', color: theme.textDim, fontSize: 12 }}>TEN TYDZIEŃ</Text>
              <Text style={{ fontFamily: 'Manrope_600SemiBold', color: RED, fontSize: 25, fontWeight: '900', marginTop: 4 }}>
                {data?.summary.earnedPoints ?? 0} pkt
              </Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={{ fontFamily: 'Manrope_600SemiBold', color: theme.text, fontSize: 13, fontWeight: '800' }}>
                {completed}/{total}
              </Text>
              <Text style={{ fontFamily: 'Manrope_600SemiBold', color: theme.textDim, fontSize: 12, marginTop: 4 }}>
                UKOŃCZONO
              </Text>
            </View>
          </View>
          <View style={{ height: 9, backgroundColor: track, borderRadius: 8, overflow: 'hidden', marginTop: 16 }}>
            <View
              style={{
                height: '100%',
                width: `${Math.min(100, Math.max(0, overallProgress * 100))}%`,
                backgroundColor: overallProgress >= 1 ? GREEN : RED,
                borderRadius: 8,
              }}
            />
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 10 }}>
            <Text style={{ fontFamily: 'Manrope_600SemiBold', color: theme.textDim, fontSize: 12 }}>
              DO ZDOBYCIA: {data?.summary.maxPoints ?? 0} PKT
            </Text>
            <Text style={{ fontFamily: 'Manrope_600SemiBold', color: theme.textDim, fontSize: 12 }}>
              MIESIĄC: {data?.monthlyRankPoints ?? 0} PKT
            </Text>
          </View>
        </View>

        {error ? (
          <TouchableOpacity
            onPress={() => void refresh()}
            style={{ borderRadius: 14, backgroundColor: `${RED}18`, borderWidth: 1, borderColor: `${RED}55`, padding: 13, marginBottom: 12, flexDirection: 'row', alignItems: 'center', gap: 9 }}
          >
            <MaterialIcons name="cloud-off" size={19} color={RED} />
            <Text style={{ flex: 1, fontFamily: 'Manrope_600SemiBold', color: theme.text, fontSize: 12 }}>
              {error}. DOTKNIJ, ABY PONOWIĆ.
            </Text>
          </TouchableOpacity>
        ) : null}

        {loading && !data ? (
          <ActivityIndicator color={RED} size="large" style={{ marginTop: 50 }} />
        ) : (
          tasks.map((task) => {
            const reward = data?.isPremium ? (task.premiumPoints ?? task.points) : task.points;
            return (
              <View
                testID={`quest-task-${task.key}`}
                key={task.key}
                style={{ backgroundColor: card, borderRadius: 17, borderWidth: 1, borderColor: task.done ? `${GREEN}42` : 'rgba(227,56,53,0.20)', padding: 14, marginBottom: 10 }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 11 }}>
                  <MaterialIcons
                    name={task.done ? 'check-circle' : 'radio-button-unchecked'}
                    size={24}
                    color={task.done ? GREEN : `${RED}99`}
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontFamily: 'Manrope_600SemiBold', fontSize: 12, lineHeight: 16, color: theme.text, fontWeight: '700' }}>
                      {task.label}
                    </Text>
                    <Text style={{ fontFamily: 'Manrope_600SemiBold', fontSize: 12, color: theme.textDim, marginTop: 5 }}>
                      {formatQuestProgress(task)}
                    </Text>
                  </View>
                  <Text style={{ fontFamily: 'Manrope_600SemiBold', fontSize: 12, color: task.done ? GREEN : RED, fontWeight: '900' }}>
                    +{task.done ? task.earned : Math.round(reward)}
                  </Text>
                </View>
                <View style={{ height: 6, backgroundColor: track, borderRadius: 5, overflow: 'hidden', marginTop: 12, marginLeft: 35 }}>
                  <View
                    style={{
                      width: `${Math.min(100, Math.max(0, task.progress * 100))}%`,
                      height: '100%',
                      backgroundColor: task.done ? GREEN : RED,
                      borderRadius: 5,
                    }}
                  />
                </View>
              </View>
            );
          })
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
