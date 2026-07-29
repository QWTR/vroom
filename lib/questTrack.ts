import { useCallback, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_URL } from '../constants/config';
export { formatQuestProgress, sortQuestTasks } from './questTrackUtils';

export type QuestTask = {
  key: string;
  label: string;
  kind: string;
  current: number;
  target: number;
  unit: string;
  progress: number;
  points: number;
  premiumPoints?: number;
  done: boolean;
  earned: number;
  completedAt: string | null;
};

export type QuestTrackData = {
  weekStart: string;
  weekEnd: string;
  nextResetAt: string;
  period?: { startAt: string; endAt: string; timeZone: string };
  tasks: QuestTask[];
  weeklyPoints: number;
  monthlyRankPoints: number;
  isPremium: boolean;
  weeklyTaskLimit: number;
  pointsMultiplier: number;
  summary: {
    completed: number;
    total: number;
    earnedPoints: number;
    maxPoints: number;
    monthlyPoints: number;
  };
};

type QuestTrackState = {
  data: QuestTrackData | null;
  loading: boolean;
  error: string | null;
  refreshedAt: number;
};

let state: QuestTrackState = {
  data: null,
  loading: false,
  error: null,
  refreshedAt: 0,
};
let request: Promise<void> | null = null;
let rerunAfterRequest = false;
let invalidateTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<(next: QuestTrackState) => void>();

function publish(next: Partial<QuestTrackState>) {
  state = { ...state, ...next };
  listeners.forEach((listener) => listener(state));
}

async function authToken() {
  return (await AsyncStorage.getItem('userToken'))
    ?? (await AsyncStorage.getItem('token'))
    ?? '';
}

function normalizeTask(task: Partial<QuestTask>): QuestTask {
  const target = Number(task.target ?? 0);
  const current = Number(task.current ?? (task.done ? target : 0));
  return {
    key: String(task.key ?? ''),
    label: String(task.label ?? ''),
    kind: String(task.kind ?? ''),
    current,
    target,
    unit: String(task.unit ?? ''),
    progress: Number.isFinite(task.progress)
      ? Math.min(1, Math.max(0, Number(task.progress)))
      : (target > 0 ? Math.min(1, current / target) : 0),
    points: Number(task.points ?? 0),
    premiumPoints: task.premiumPoints == null ? undefined : Number(task.premiumPoints),
    done: task.done === true,
    earned: Number(task.earned ?? 0),
    completedAt: typeof task.completedAt === 'string' ? task.completedAt : null,
  };
}

function normalizePayload(payload: any): QuestTrackData {
  const tasks: QuestTask[] = Array.isArray(payload?.tasks)
    ? payload.tasks.map((task: Partial<QuestTask>) => normalizeTask(task))
    : [];
  const completed = tasks.filter((task) => task.done).length;
  const weeklyPoints = Number(payload?.weeklyPoints ?? payload?.summary?.earnedPoints ?? 0);
  const monthlyRankPoints = Number(
    payload?.monthlyRankPoints ?? payload?.summary?.monthlyPoints ?? 0,
  );
  return {
    ...payload,
    tasks,
    weeklyPoints,
    monthlyRankPoints,
    isPremium: payload?.isPremium === true,
    weeklyTaskLimit: Number(payload?.weeklyTaskLimit ?? tasks.length),
    pointsMultiplier: Number(payload?.pointsMultiplier ?? 1),
    summary: {
      completed: Number(payload?.summary?.completed ?? completed),
      total: Number(payload?.summary?.total ?? tasks.length),
      earnedPoints: Number(payload?.summary?.earnedPoints ?? weeklyPoints),
      maxPoints: Number(
        payload?.summary?.maxPoints
          ?? tasks.reduce((sum, task) => sum + (payload?.isPremium
            ? (task.premiumPoints ?? task.points)
            : task.points), 0),
      ),
      monthlyPoints: Number(payload?.summary?.monthlyPoints ?? monthlyRankPoints),
    },
  };
}

export async function refreshQuestTrack(options: { force?: boolean } = {}): Promise<void> {
  if (request) {
    if (options.force) rerunAfterRequest = true;
    return request;
  }
  if (!options.force && state.data && Date.now() - state.refreshedAt < 15_000) return;

  request = (async () => {
    publish({ loading: true, error: null });
    try {
      const token = await authToken();
      if (!token) throw new Error('Brak aktywnej sesji');
      const response = await fetch(`${API_URL}/api/quest-track/current`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error('Nie udało się pobrać Tygodniowego Toru');
      publish({
        data: normalizePayload(await response.json()),
        loading: false,
        error: null,
        refreshedAt: Date.now(),
      });
    } catch (error) {
      publish({
        loading: false,
        error: error instanceof Error ? error.message : 'Brak połączenia z serwerem',
      });
    } finally {
      request = null;
      if (rerunAfterRequest) {
        rerunAfterRequest = false;
        queueMicrotask(() => {
          void refreshQuestTrack({ force: true });
        });
      }
    }
  })();
  return request;
}

export function invalidateQuestTrack() {
  publish({ refreshedAt: 0 });
  if (invalidateTimer) clearTimeout(invalidateTimer);
  invalidateTimer = setTimeout(() => {
    invalidateTimer = null;
    void refreshQuestTrack({ force: true });
  }, 350);
}

export function useQuestTrack() {
  const [snapshot, setSnapshot] = useState(state);
  useEffect(() => {
    listeners.add(setSnapshot);
    return () => {
      listeners.delete(setSnapshot);
    };
  }, []);
  const refresh = useCallback(() => refreshQuestTrack({ force: true }), []);
  return { ...snapshot, refresh };
}
