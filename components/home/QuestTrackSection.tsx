import React, { useState, useCallback, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, ActivityIndicator, Animated,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_URL } from '../../constants/config';
import { useTheme } from '../../contexts/ThemeContext';

const getToken = async () =>
  (await AsyncStorage.getItem('userToken')) ?? (await AsyncStorage.getItem('token')) ?? '';

type TaskRow = { key: string; label: string; points: number; premiumPoints?: number; done: boolean; earned: number };

interface Props {
  theme: any;
  fadeAnim: Animated.Value;
  onSynced?: () => void;
}

export function QuestTrackSection({ theme: t, fadeAnim, onSynced }: Props) {
  const router = useRouter();
  const { theme: themeObj } = useTheme();
  const primary = themeObj.primary;
  const [loading, setLoading]       = useState(true);
  const [tasks, setTasks]           = useState<TaskRow[]>([]);
  const [weeklyPoints, setWeekly]   = useState(0);
  const [monthlySelf, setMonthly]   = useState(0);
  const [nextResetAt, setNextResetAt] = useState<string | null>(null);
  const [isPremium, setIsPremium] = useState(false);
  const [weeklyTaskLimit, setWeeklyTaskLimit] = useState(6);
  const [pointsMultiplier, setPointsMultiplier] = useState(1);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const formatCountdown = useCallback((targetIso: string | null) => {
    if (!targetIso) return null;
    const targetMs = new Date(targetIso).getTime();
    if (!Number.isFinite(targetMs)) return null;
    let leftSec = Math.floor((targetMs - nowMs) / 1000);
    if (leftSec <= 0) return 'za chwilę';
    const days = Math.floor(leftSec / 86400);
    leftSec -= days * 86400;
    const hours = Math.floor(leftSec / 3600);
    leftSec -= hours * 3600;
    const minutes = Math.floor(leftSec / 60);
    const seconds = leftSec - minutes * 60;
    const hh = String(hours).padStart(2, '0');
    const mm = String(minutes).padStart(2, '0');
    const ss = String(seconds).padStart(2, '0');
    return days > 0 ? `${days}d ${hh}:${mm}:${ss}` : `${hh}:${mm}:${ss}`;
  }, [nowMs]);

  const load = useCallback(async () => {
    try {
      const token = await getToken();
      if (!token) return;
      const r = await fetch(`${API_URL}/api/quest-track/current`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) return;
      const j = await r.json();
      setTasks(Array.isArray(j.tasks) ? j.tasks : []);
      setWeekly(typeof j.weeklyPoints === 'number' ? j.weeklyPoints : 0);
      setNextResetAt(typeof j.nextResetAt === 'string' ? j.nextResetAt : null);
      setIsPremium(j?.isPremium === true);
      setWeeklyTaskLimit(Number.isFinite(j?.weeklyTaskLimit) ? Number(j.weeklyTaskLimit) : 6);
      setPointsMultiplier(Number.isFinite(j?.pointsMultiplier) ? Number(j.pointsMultiplier) : 1);
      const mr = j.monthlyRankPoints ?? j.monthlyPointsSelf;
      setMonthly(typeof mr === 'number' ? mr : 0);
      onSynced?.();
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, [onSynced]);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      void load();
    }, [load]),
  );

  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const resetCountdown = formatCountdown(nextResetAt);

  return (
    <Animated.View style={{ opacity: fadeAnim, paddingHorizontal: 20, marginBottom: 18 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <View>
          <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: t.textDim, letterSpacing: 4 }}>
            TYGODNIOWY TOR VROOM
          </Text>
          <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: t.textDim, marginTop: 4 }}>
            {resetCountdown ? `Reset za: ${resetCountdown}` : 'Reset: brak danych'}
          </Text>
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
          <Text style={{ fontFamily: 'Orbitron', fontSize: 9, color: primary, fontWeight: '700' }}>RANKING MIES.</Text>
          <MaterialIcons name="emoji-events" size={14} color={primary} />
        </TouchableOpacity>
      </View>

      <View style={{
        backgroundColor: t.surface,
        borderRadius: 18,
        borderWidth: 1,
        borderColor: t.border,
        padding: 14,
      }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 }}>
          <Text style={{ fontFamily: 'Orbitron', fontSize: 10, color: t.textDim }}>Punkty w tym tygodniu</Text>
          <Text style={{ fontFamily: 'Orbitron', fontSize: 14, color: primary, fontWeight: '900' }}>{weeklyPoints} pkt</Text>
        </View>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 14 }}>
          <Text style={{ fontFamily: 'Orbitron', fontSize: 10, color: t.textDim }}>Punkty w tym miesiącu</Text>
          <Text style={{ fontFamily: 'Orbitron', fontSize: 12, color: t.text, fontWeight: '700' }}>{monthlySelf} pkt</Text>
        </View>

        {loading ? (
          <ActivityIndicator color={primary} style={{ marginVertical: 16 }} />
        ) : (
          tasks.map(task => (
            <View
              key={task.key}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                paddingVertical: 8,
                borderTopWidth: 1,
                borderTopColor: t.border2,
                gap: 10,
              }}
            >
              <MaterialIcons
                name={task.done ? 'check-circle' : 'radio-button-unchecked'}
                size={20}
                color={task.done ? '#4de926' : t.textDim}
              />
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: 'Orbitron', fontSize: 11, color: t.text, fontWeight: '600' }} numberOfLines={2}>
                  {task.label}
                </Text>
              </View>
              <Text style={{
                fontFamily: 'Orbitron',
                fontSize: 10,
                color: task.done ? '#4de926' : primary,
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
