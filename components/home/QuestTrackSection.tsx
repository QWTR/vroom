import React, { useState, useCallback, useRef } from 'react';
import {
  View, Text, TouchableOpacity, ActivityIndicator, Animated,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_URL } from '../../constants/config';
import { useTheme } from '../../contexts/ThemeContext';
import { LiveCountdownText } from './LiveCountdownText';

const getToken = async () =>
  (await AsyncStorage.getItem('userToken')) ?? (await AsyncStorage.getItem('token')) ?? '';

const VROOM_RED = '#e33835';

type TaskRow = { key: string; label: string; points: number; premiumPoints?: number; done: boolean; earned: number };

function tasksEqual(a: TaskRow[], b: TaskRow[]) {
  if (a.length !== b.length) return false;
  return a.every((t, i) => (
    t.key === b[i].key
    && t.done === b[i].done
    && t.earned === b[i].earned
    && t.label === b[i].label
    && t.points === b[i].points
  ));
}

interface Props {
  theme: any;
  fadeAnim: Animated.Value;
  onSynced?: () => void;
}

export function QuestTrackSection({ theme: t, fadeAnim, onSynced }: Props) {
  const router = useRouter();
  const { isDark } = useTheme();
  const glassBorder = 'rgba(227, 56, 53, 0.2)';
  const cardBg = isDark ? 'rgba(20, 5, 5, 0.4)' : 'rgba(255, 255, 255, 0.8)';
  const glassShadow = {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 10,
    elevation: 4,
  };
  const sectionAccent = {
    width: 3,
    height: 12,
    backgroundColor: VROOM_RED,
    borderRadius: 2,
    marginRight: 8,
  };
  const [loading, setLoading] = useState(true);
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [weeklyPoints, setWeekly] = useState(0);
  const [monthlySelf, setMonthly] = useState(0);
  const [nextResetAt, setNextResetAt] = useState<string | null>(null);
  const [isPremium, setIsPremium] = useState(false);
  const [weeklyTaskLimit, setWeeklyTaskLimit] = useState(6);
  const [pointsMultiplier, setPointsMultiplier] = useState(1);
  const initialLoadDone = useRef(false);
  const onSyncedRef = useRef(onSynced);
  onSyncedRef.current = onSynced;

  const load = useCallback(async () => {
    const showSpinner = !initialLoadDone.current;
    if (showSpinner) setLoading(true);
    try {
      const token = await getToken();
      if (!token) return;
      const r = await fetch(`${API_URL}/api/quest-track/current`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) return;
      const j = await r.json();
      const nextTasks: TaskRow[] = Array.isArray(j.tasks) ? j.tasks : [];
      setTasks(prev => (tasksEqual(prev, nextTasks) ? prev : nextTasks));
      const nextWeekly = typeof j.weeklyPoints === 'number' ? j.weeklyPoints : 0;
      setWeekly(prev => (prev === nextWeekly ? prev : nextWeekly));
      const nextReset = typeof j.nextResetAt === 'string' ? j.nextResetAt : null;
      setNextResetAt(prev => (prev === nextReset ? prev : nextReset));
      const nextPremium = j?.isPremium === true;
      setIsPremium(prev => (prev === nextPremium ? prev : nextPremium));
      const nextLimit = Number.isFinite(j?.weeklyTaskLimit) ? Number(j.weeklyTaskLimit) : 6;
      setWeeklyTaskLimit(prev => (prev === nextLimit ? prev : nextLimit));
      const nextMult = Number.isFinite(j?.pointsMultiplier) ? Number(j.pointsMultiplier) : 1;
      setPointsMultiplier(prev => (prev === nextMult ? prev : nextMult));
      const mr = j.monthlyRankPoints ?? j.monthlyPointsSelf;
      const nextMonthly = typeof mr === 'number' ? mr : 0;
      setMonthly(prev => (prev === nextMonthly ? prev : nextMonthly));
      initialLoadDone.current = true;
      onSyncedRef.current?.();
    } catch {
      /* ignore */
    } finally {
      if (showSpinner) setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  return (
    <Animated.View style={{ opacity: fadeAnim, paddingHorizontal: 20, marginBottom: 18 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <View>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
            <View style={sectionAccent} />
            <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: t.textDim, letterSpacing: 4 }}>
              TYGODNIOWY TOR VROOM
            </Text>
          </View>
          <LiveCountdownText
            targetIso={nextResetAt}
            prefix="Reset za: "
            fallback="Reset: brak danych"
            style={{ fontFamily: 'Orbitron', fontSize: 8, color: t.textDim, marginTop: 4 }}
          />
          <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: isPremium ? '#FFD700' : t.textDim, marginTop: 4 }}>
            {isPremium
              ? `PREMIUM: ${weeklyTaskLimit} zadań / +${Math.round((pointsMultiplier - 1) * 100)}% pkt`
              : `FREE: ${weeklyTaskLimit} zadań`}
          </Text>
        </View>
        <TouchableOpacity
          onPress={() =>
            router.push({
              pathname: '/Community/Ranks/stats',
              params: { rankPeriod: 'Miesiąc', rankCategory: 'points' },
            } as any)
          }
          style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}
        >
          <Text style={{ fontFamily: 'Orbitron', fontSize: 9, color: VROOM_RED, fontWeight: '700' }}>RANKING MIES.</Text>
          <MaterialIcons name="emoji-events" size={14} color={VROOM_RED} />
        </TouchableOpacity>
      </View>

      <View style={{
        backgroundColor: cardBg,
        borderRadius: 20,
        borderWidth: 1,
        borderColor: glassBorder,
        padding: 14,
        ...glassShadow,
      }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 }}>
          <Text style={{ fontFamily: 'Orbitron', fontSize: 10, color: t.textDim }}>Punkty w tym tygodniu</Text>
          <Text style={{ fontFamily: 'Orbitron', fontSize: 14, color: VROOM_RED, fontWeight: '900' }}>{weeklyPoints} pkt</Text>
        </View>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 14 }}>
          <Text style={{ fontFamily: 'Orbitron', fontSize: 10, color: t.textDim }}>Punkty w tym miesiącu</Text>
          <Text style={{ fontFamily: 'Orbitron', fontSize: 12, color: t.text, fontWeight: '700' }}>{monthlySelf} pkt</Text>
        </View>

        {loading && tasks.length === 0 ? (
          <ActivityIndicator color={VROOM_RED} style={{ marginVertical: 16 }} />
        ) : (
          tasks.map(task => (
            <View
              key={task.key}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                paddingVertical: 8,
                borderTopWidth: 1,
                borderTopColor: isDark ? 'rgba(227, 56, 53, 0.15)' : 'rgba(227, 56, 53, 0.1)',
                gap: 10,
              }}
            >
              <MaterialIcons
                name={task.done ? 'check-circle' : 'radio-button-unchecked'}
                size={20}
                color={task.done ? '#4de926' : 'rgba(227, 56, 53, 0.3)'}
              />
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: 'Orbitron', fontSize: 11, color: t.text, fontWeight: '600' }} numberOfLines={2}>
                  {task.label}
                </Text>
              </View>
              <Text style={{
                fontFamily: 'Orbitron',
                fontSize: 10,
                color: task.done ? '#4de926' : VROOM_RED,
                fontWeight: '800',
              }}>
                {task.done
                  ? `+${task.earned}`
                  : `+${Math.round(isPremium ? (task.premiumPoints ?? task.points) : task.points)}`}
              </Text>
            </View>
          ))
        )}
      </View>
    </Animated.View>
  );
}
