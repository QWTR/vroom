import { QueryClient } from '@tanstack/react-query';
import SQLiteStorage from 'expo-sqlite/kv-store';

export const QUERY_CACHE_SCHEMA = 'v2';
export const QUERY_CACHE_PREFIX = `vroom_query_cache_${QUERY_CACHE_SCHEMA}_user_`;

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 24 * 60 * 60_000,
      refetchOnMount: false,
      refetchOnReconnect: true,
      refetchOnWindowFocus: false,
      retry: 1,
    },
    mutations: { retry: false },
  },
});

export async function clearPersistedQueryCaches(): Promise<void> {
  queryClient.clear();
  const keys = await SQLiteStorage.getAllKeys();
  await SQLiteStorage.multiRemove(keys.filter((key) => key.startsWith(QUERY_CACHE_PREFIX)));
}
