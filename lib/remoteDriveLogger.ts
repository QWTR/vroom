import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState, Platform } from 'react-native';
import { API_URL } from '../constants/mapConfig';
import { subscribeVroomGpsLog, type VroomGpsLogEntry } from './vroomGpsLog';

const FLUSH_INTERVAL_MS = 5000;
const MAX_BATCH = 40;
const MAX_BUFFER = 240;
const MAX_PAYLOAD_JSON = 1800;

type InstallOptions = {
  sessionId: string;
  enabled: boolean;
};

function compactPayload(payload?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  try {
    const json = JSON.stringify(payload);
    if (json.length <= MAX_PAYLOAD_JSON) return payload;
    return {
      truncated: true,
      json: json.slice(0, MAX_PAYLOAD_JSON),
    };
  } catch {
    return { unserializable: true };
  }
}

async function getToken(): Promise<string | null> {
  return (
    await AsyncStorage.getItem('token')
    ?? await AsyncStorage.getItem('userToken')
  );
}

export function installRemoteDriveLogger({ sessionId, enabled }: InstallOptions): () => void {
  if (!enabled || !sessionId) return () => {};

  let disposed = false;
  let flushInFlight = false;
  let buffer: VroomGpsLogEntry[] = [];

  const flush = async () => {
    if (disposed || flushInFlight || buffer.length === 0) return;
    flushInFlight = true;
    const batch = buffer.slice(0, MAX_BATCH);
    buffer = buffer.slice(batch.length);
    try {
      const token = await getToken();
      if (!token) return;
      const res = await fetch(`${API_URL}/api/live/map-telemetry`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sessionId,
          appState: AppState.currentState,
          events: batch.map((entry) => ({
            at: entry.t,
            type: 'drive_log',
            payload: {
              tag: entry.tag,
              platform: Platform.OS,
              source: 'vroomGpsLog',
              logLine: `[VROOM-GPS] ${entry.tag}`,
              data: compactPayload(entry.payload),
            },
          })),
        }),
      });
      if (!res.ok) {
        buffer = [...batch, ...buffer].slice(-MAX_BUFFER);
      }
    } catch {
      buffer = [...batch, ...buffer].slice(-MAX_BUFFER);
    } finally {
      flushInFlight = false;
    }
  };

  const unsubscribe = subscribeVroomGpsLog((entry) => {
    if (disposed) return;
    buffer.push(entry);
    if (buffer.length > MAX_BUFFER) {
      buffer = buffer.slice(-MAX_BUFFER);
    }
    if (buffer.length >= MAX_BATCH) {
      void flush();
    }
  });

  const timer = setInterval(() => {
    void flush();
  }, FLUSH_INTERVAL_MS);

  return () => {
    disposed = true;
    unsubscribe();
    clearInterval(timer);
    void flush();
  };
}
