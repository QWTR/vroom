import AsyncStorage from '@react-native-async-storage/async-storage';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import SQLiteStorage from 'expo-sqlite/kv-store';
import React, { PropsWithChildren, useEffect, useMemo, useState } from 'react';
import { AppState } from 'react-native';
import { focusManager } from '@tanstack/react-query';
import { getAuthTokenCached } from '../../lib/api/authTokenMemory';
import { QUERY_CACHE_PREFIX, QUERY_CACHE_SCHEMA, queryClient } from '../../lib/query/client';

function readUserId(raw: string | null): string {
  if (!raw) return 'anonymous';
  try {
    const user = JSON.parse(raw);
    const id = Number(user.id ?? user.userId);
    return Number.isInteger(id) && id > 0 ? String(id) : 'anonymous';
  } catch {
    return 'anonymous';
  }
}

export function VroomQueryProvider({ children }: PropsWithChildren) {
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    void Promise.all([AsyncStorage.getItem('user'), getAuthTokenCached()]).then(([raw]) => setUserId(readUserId(raw)));
    const subscription = AppState.addEventListener('change', (state) => focusManager.setFocused(state === 'active'));
    return () => subscription.remove();
  }, []);

  const persister = useMemo(() => userId ? createAsyncStoragePersister({
    storage: SQLiteStorage,
    key: `${QUERY_CACHE_PREFIX}${userId}`,
    throttleTime: 1000,
  }) : null, [userId]);

  if (!persister || !userId) return null;
  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{ persister, buster: `${QUERY_CACHE_SCHEMA}:${userId}`, maxAge: 24 * 60 * 60_000 }}
    >
      {children}
    </PersistQueryClientProvider>
  );
}
