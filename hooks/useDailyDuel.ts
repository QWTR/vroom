import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useIsFocused } from '@react-navigation/native';
import { useCallback, useEffect, useMemo } from 'react';
import Toast from 'react-native-toast-message';
import type {
  DailyDuelCarSide,
  DailyDuelData,
  DailyDuelSubmission,
} from '../components/community/dailyDuelTypes';
import { usePerformance } from '../contexts/PerformanceContext';
import { apiRequest } from '../lib/api/client';

type DuelCardResponse = { duel: DailyDuelData | null };
type DuelHistoryResponse = { history: DailyDuelData[] };
type DuelSubmissionResponse = { submission: DailyDuelSubmission | null; cars: DailyDuelCarSide[] };
type UseDailyDuelOptions = { includeHistory?: boolean; includeSubmission?: boolean };

export const dailyDuelKeys = {
  card: ['daily-duel', 'card'] as const,
  history: ['daily-duel', 'history'] as const,
  submission: ['daily-duel', 'submission'] as const,
};

function operationId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function toast(type: 'success' | 'error', text1: string) {
  Toast.show({ type, text1 } as Parameters<typeof Toast.show>[0]);
}

export function useDailyDuel(pollMs = 30000, options: UseDailyDuelOptions = {}) {
  const isFocused = useIsFocused();
  const { appActive } = usePerformance();
  const queryClient = useQueryClient();
  const enabled = isFocused && appActive;
  const includeHistory = options.includeHistory !== false;
  const includeSubmission = options.includeSubmission !== false;

  const cardQuery = useQuery({
    queryKey: dailyDuelKeys.card,
    queryFn: ({ signal }) => apiRequest<DuelCardResponse>('/api/v2/daily-duel/card', { signal, priority: 'critical' }),
    enabled,
    staleTime: 20_000,
    refetchInterval: enabled ? pollMs : false,
    refetchOnMount: 'always',
    refetchOnWindowFocus: 'always',
  });
  const historyQuery = useQuery({
    queryKey: dailyDuelKeys.history,
    queryFn: ({ signal }) => apiRequest<DuelHistoryResponse>('/api/daily-duel/history?limit=10', { signal, priority: 'visible' }),
    enabled: enabled && includeHistory,
    staleTime: 60_000,
  });
  const submissionQuery = useQuery({
    queryKey: dailyDuelKeys.submission,
    queryFn: ({ signal }) => apiRequest<DuelSubmissionResponse>('/api/daily-duel/submission', { signal, priority: 'visible' }),
    enabled: enabled && includeSubmission,
    staleTime: 60_000,
  });

  // The query cache is persisted between launches. Refresh immediately whenever
  // this screen becomes visible or the app returns from the background so a
  // duel from yesterday can never sit at 00:00:00 until a manual reload.
  useEffect(() => {
    if (!enabled) return;
    void queryClient.refetchQueries({
      queryKey: dailyDuelKeys.card,
      exact: true,
      type: 'active',
    });
  }, [enabled, queryClient]);

  const voteMutation = useMutation({
    networkMode: 'online',
    mutationFn: async (carId: number) => {
      const duel = queryClient.getQueryData<DuelCardResponse>(dailyDuelKeys.card)?.duel;
      if (!duel) throw new Error('Brak aktywnego pojedynku');
      const id = operationId('duel-vote');
      return apiRequest<{ entity: { duelId: number; myVoteCarId: number } }>(`/api/v2/daily-duel/${duel.id}/vote`, {
        method: 'PUT',
        body: { carId },
        idempotencyKey: id,
        priority: 'mutation',
      });
    },
    onMutate: async (carId) => {
      await queryClient.cancelQueries({ queryKey: dailyDuelKeys.card });
      const previous = queryClient.getQueryData<DuelCardResponse>(dailyDuelKeys.card);
      queryClient.setQueryData<DuelCardResponse>(dailyDuelKeys.card, (current) => ({
        duel: current?.duel ? { ...current.duel, myVoteCarId: carId } : null,
      }));
      return { previous };
    },
    onError: (_error, _carId, context) => {
      if (context?.previous) queryClient.setQueryData(dailyDuelKeys.card, context.previous);
    },
  });

  const submitMutation = useMutation({
    mutationFn: (carId: number) => apiRequest<{ submission: DailyDuelSubmission }>('/api/daily-duel/submission', {
      method: 'POST', body: { carId }, priority: 'mutation',
    }),
    onSuccess: (data) => queryClient.setQueryData<DuelSubmissionResponse>(dailyDuelKeys.submission, (current) => ({
      cars: current?.cars || [], submission: data.submission,
    })),
  });
  const cancelMutation = useMutation({
    mutationFn: () => apiRequest<{ success: boolean }>('/api/daily-duel/submission', { method: 'DELETE', priority: 'mutation' }),
    onSuccess: () => queryClient.setQueryData<DuelSubmissionResponse>(dailyDuelKeys.submission, (current) => ({
      cars: current?.cars || [], submission: null,
    })),
  });

  const vote = useCallback(async (carId: number) => {
    try {
      await voteMutation.mutateAsync(carId);
      toast('success', 'Głos oddany!');
      return true;
    } catch (error) {
      toast('error', error instanceof Error ? error.message : 'Nie udało się zagłosować');
      return false;
    }
  }, [voteMutation]);
  const submitCar = useCallback(async (carId: number) => {
    try {
      await submitMutation.mutateAsync(carId);
      toast('success', 'Auto zgłoszone do pojedynku!');
      return true;
    } catch (error) {
      toast('error', error instanceof Error ? error.message : 'Nie udało się zgłosić auta');
      return false;
    }
  }, [submitMutation]);
  const cancelSubmission = useCallback(async () => {
    try {
      await cancelMutation.mutateAsync();
      toast('success', 'Zgłoszenie wycofane');
      return true;
    } catch {
      toast('error', 'Błąd połączenia');
      return false;
    }
  }, [cancelMutation]);

  return useMemo(() => ({
    duel: cardQuery.data?.duel ?? null,
    history: historyQuery.data?.history ?? [],
    historyLoading: historyQuery.isPending,
    loading: cardQuery.isPending && !cardQuery.data,
    voting: voteMutation.isPending,
    submission: submissionQuery.data?.submission ?? null,
    eligibleCars: submissionQuery.data?.cars ?? [],
    submissionLoading: submissionQuery.isPending,
    submitting: submitMutation.isPending || cancelMutation.isPending,
    refresh: () => cardQuery.refetch(),
    refreshHistory: () => historyQuery.refetch(),
    refreshSubmission: () => submissionQuery.refetch(),
    vote,
    submitCar,
    cancelSubmission,
  }), [
    cancelMutation.isPending, cancelSubmission, cardQuery, historyQuery, submissionQuery,
    submitCar, submitMutation.isPending, vote, voteMutation.isPending,
  ]);
}
