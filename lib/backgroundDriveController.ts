import { DeviceEventEmitter, NativeEventEmitter, NativeModules, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { API_URL } from '../constants/mapConfig';

export type BackgroundDriveMode = 'freeDrive' | 'navigation';
export type BackgroundDriveStopReason = 'app' | 'notification' | 'permission' | 'system';
export type BackgroundDriveRuntimeState = {
  state?: 'inactive' | 'starting' | 'active' | 'recovering' | 'idle' | 'blockedPermission' | 'blockedPremium' | string;
  reason?: string;
  errorCode?: number;
  recoverable?: boolean;
  authorizationStatus?: string;
  timestampMs?: number;
  lastFixTimestampMs?: number;
  lastFixAgeMs?: number;
  retryAttempt?: number;
};

export type BackgroundDriveFix = {
  latitude: number;
  longitude: number;
  speed: number | null;
  heading: number | null;
  accuracy: number | null;
  timestamp: number;
  mode?: BackgroundDriveMode | string;
  source?: 'live' | 'lastKnown' | 'buffer' | string;
  receivedAt?: number;
  elapsedRealtimeNanos?: number;
  isSeed?: boolean;
};

export type BackgroundDriveState = {
  active: boolean;
  mode?: BackgroundDriveMode | string | null;
  tripSessionId?: string | null;
  startedAt?: number | null;
  lastFix?: BackgroundDriveFix | null;
  endedBy?: BackgroundDriveStopReason | string | null;
  updatedAt?: number | null;
};

export type BackgroundDriveNativeStats = {
  distanceKm: number;
  tripSessionId?: string | null;
  routePoints: Array<{ latitude: number; longitude: number }>;
  speedSamples: number[];
  maxSpeedKmh: number;
  lastServerCheckpointKm?: number;
};

export type BackgroundDriveNativeProgress = Pick<
  BackgroundDriveNativeStats,
  'distanceKm' | 'tripSessionId' | 'maxSpeedKmh' | 'lastServerCheckpointKm'
>;

const STATE_KEY = 'wiroom_background_drive_state';
const BUFFER_KEY = 'wiroom_background_drive_buffer';
const BG_TRACKING_SETTING_KEY = 'bg_tracking_setting_enabled';
const EVENT_STOP = 'VROOM_BG_TRACKING_END';
const EVENT_STATE = 'VROOM_BG_TRACKING_STATE';
const EVENT_LOCATION = 'VROOM_BG_LOCATION';
export const IOS_DRIVE_NOTIFICATION_CATEGORY = 'wiroom_drive_tracking';
export const IOS_DRIVE_STOP_ACTION = 'WIROOM_DRIVE_STOP';
const IOS_DRIVE_NOTIFICATION_ID_KEY = 'wiroom_drive_notification_id';

const { VroomBgTracking, WiroomLocationService } = NativeModules as {
  VroomBgTracking?: {
    startDriveTracking?: (
      mode: BackgroundDriveMode,
      tripSessionId?: string,
      apiUrl?: string,
      authToken?: string,
    ) => Promise<boolean>;
    stopDriveTracking?: (reason: BackgroundDriveStopReason | string) => Promise<boolean>;
    getState?: () => Promise<BackgroundDriveState>;
    consumeBufferedLocations?: () => Promise<BackgroundDriveFix[]>;
    getNativeStats?: () => Promise<BackgroundDriveNativeStats>;
    getNativeProgress?: () => Promise<BackgroundDriveNativeProgress>;
    consumeNativeStats?: () => Promise<BackgroundDriveNativeStats>;
    getDiagnostics?: () => Promise<BackgroundDriveRuntimeState[]>;
  };
  WiroomLocationService?: {
    startDriveTracking?: (
      mode: BackgroundDriveMode,
      tripSessionId?: string,
      apiUrl?: string,
      authToken?: string,
    ) => Promise<boolean>;
    stopDriveTracking?: (reason: BackgroundDriveStopReason | string) => Promise<boolean>;
    getState?: () => Promise<BackgroundDriveState>;
    consumeBufferedLocations?: () => Promise<BackgroundDriveFix[]>;
    getNativeStats?: () => Promise<BackgroundDriveNativeStats>;
    getNativeProgress?: () => Promise<BackgroundDriveNativeProgress>;
    consumeNativeStats?: () => Promise<BackgroundDriveNativeStats>;
    getDiagnostics?: () => Promise<BackgroundDriveRuntimeState[]>;
  };
};

async function getAuthToken(): Promise<string | null> {
  return (
    (await AsyncStorage.getItem('userToken')) ??
    (await AsyncStorage.getItem('token'))
  );
}

function nativeModule() {
  return Platform.OS === 'ios' ? WiroomLocationService : VroomBgTracking;
}

function normalizeState(value: Partial<BackgroundDriveState> | null | undefined): BackgroundDriveState {
  return {
    active: value?.active === true,
    mode: value?.mode ?? null,
    tripSessionId: typeof value?.tripSessionId === 'string' ? value.tripSessionId : null,
    startedAt: typeof value?.startedAt === 'number' ? value.startedAt : null,
    lastFix: value?.lastFix ?? null,
    endedBy: value?.endedBy ?? null,
    updatedAt: typeof value?.updatedAt === 'number' ? value.updatedAt : Date.now(),
  };
}

async function persistState(state: BackgroundDriveState): Promise<void> {
  await AsyncStorage.setItem(STATE_KEY, JSON.stringify(normalizeState(state)));
}

async function showIosDriveNotification(mode: BackgroundDriveMode): Promise<void> {
  if (Platform.OS !== 'ios') return;
  try {
    await Notifications.setNotificationCategoryAsync(
      IOS_DRIVE_NOTIFICATION_CATEGORY,
      [
        {
          identifier: IOS_DRIVE_STOP_ACTION,
          buttonTitle: 'Zakończ',
          options: {
            isDestructive: true,
            opensAppToForeground: false,
          },
        },
      ],
    );
    const id = await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Wiroom - aktywna jazda',
        body: mode === 'navigation'
          ? 'Nawigacja i GPS dzialaja w tle.'
          : 'Free Drive i GPS dzialaja w tle.',
        data: { type: 'wiroom_drive_tracking' },
        categoryIdentifier: IOS_DRIVE_NOTIFICATION_CATEGORY,
        interruptionLevel: 'timeSensitive',
        sound: false,
      },
      trigger: null,
    });
    await AsyncStorage.setItem(IOS_DRIVE_NOTIFICATION_ID_KEY, id);
  } catch {
    // Notification actions are a UX layer; native CLLocationManager remains authoritative.
  }
}

async function ensureAndroidNotificationPermission(): Promise<void> {
  if (Platform.OS !== 'android') return;
  try {
    const current = await Notifications.getPermissionsAsync();
    if (current.status !== 'granted') {
      await Notifications.requestPermissionsAsync();
    }
  } catch {
    // Foreground service still starts; Android may hide drawer notification if denied.
  }
}

async function dismissIosDriveNotification(): Promise<void> {
  if (Platform.OS !== 'ios') return;
  try {
    const id = await AsyncStorage.getItem(IOS_DRIVE_NOTIFICATION_ID_KEY);
    if (id) {
      await Notifications.dismissNotificationAsync(id);
      await AsyncStorage.removeItem(IOS_DRIVE_NOTIFICATION_ID_KEY);
    }
  } catch {
    // best effort
  }
}

export const BackgroundDriveController = {
  async start(mode: BackgroundDriveMode, tripSessionId?: string | null): Promise<boolean> {
    if ((await AsyncStorage.getItem(BG_TRACKING_SETTING_KEY)) !== 'true') return false;

    const state: BackgroundDriveState = {
      active: true,
      mode,
      tripSessionId: tripSessionId ?? null,
      startedAt: Date.now(),
      lastFix: null,
      endedBy: null,
      updatedAt: Date.now(),
    };
    const mod = nativeModule();
    if (!mod?.startDriveTracking) return false;
    try {
      await ensureAndroidNotificationPermission();
      const token = await getAuthToken();
      const ok = await (mod.startDriveTracking as any)(
        mode,
        tripSessionId ?? '',
        API_URL,
        token ?? '',
      );
      if (!ok) return false;
      await persistState(state);
      await showIosDriveNotification(mode);
      return ok;
    } catch {
      return false;
    }
  },

  async stop(reason: BackgroundDriveStopReason): Promise<boolean> {
    const current = await this.getState();
    await persistState({
      ...current,
      active: false,
      endedBy: reason,
      updatedAt: Date.now(),
    });
    const mod = nativeModule();
    await dismissIosDriveNotification();
    if (!mod?.stopDriveTracking) return false;
    try {
      return await mod.stopDriveTracking(reason);
    } catch {
      return false;
    }
  },

  async getState(): Promise<BackgroundDriveState> {
    const mod = nativeModule();
    if (mod?.getState) {
      try {
        const nativeState = normalizeState(await mod.getState());
        await persistState(nativeState);
        return nativeState;
      } catch {
        // fall through to persisted JS mirror
      }
    }
    try {
      const raw = await AsyncStorage.getItem(STATE_KEY);
      return normalizeState(raw ? JSON.parse(raw) : null);
    } catch {
      return { active: false };
    }
  },

  async consumeBufferedLocations(): Promise<BackgroundDriveFix[]> {
    const mod = nativeModule();
    let nativeLocations: BackgroundDriveFix[] = [];
    if (mod?.consumeBufferedLocations) {
      try {
        const result = await mod.consumeBufferedLocations();
        nativeLocations = Array.isArray(result) ? result : [];
      } catch {
        nativeLocations = [];
      }
    }

    let jsLocations: BackgroundDriveFix[] = [];
    try {
      const raw = await AsyncStorage.getItem(BUFFER_KEY);
      jsLocations = raw ? JSON.parse(raw) : [];
      await AsyncStorage.removeItem(BUFFER_KEY);
    } catch {
      jsLocations = [];
    }

    return [...jsLocations, ...nativeLocations]
      .filter((fix) => Number.isFinite(fix?.latitude) && Number.isFinite(fix?.longitude))
      .sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));
  },

  async getNativeStats(): Promise<BackgroundDriveNativeStats> {
    const mod = nativeModule();
    if (mod?.getNativeStats) {
      try {
        const stats = await mod.getNativeStats();
        const distanceKm = Number(stats?.distanceKm);
        const maxSpeedKmh = Number(stats?.maxSpeedKmh);
        const lastServerCheckpointKm = Number(stats?.lastServerCheckpointKm);
        return {
          distanceKm: Number.isFinite(distanceKm) ? distanceKm : 0,
          tripSessionId: typeof stats?.tripSessionId === 'string' ? stats.tripSessionId : null,
          routePoints: Array.isArray(stats?.routePoints) ? stats.routePoints : [],
          speedSamples: Array.isArray(stats?.speedSamples) ? stats.speedSamples : [],
          maxSpeedKmh: Number.isFinite(maxSpeedKmh) ? maxSpeedKmh : 0,
          lastServerCheckpointKm: Number.isFinite(lastServerCheckpointKm)
            ? lastServerCheckpointKm
            : undefined,
        };
      } catch {
        // fall through
      }
    }
    return { distanceKm: 0, routePoints: [], speedSamples: [], maxSpeedKmh: 0 };
  },

  async consumeNativeStats(): Promise<BackgroundDriveNativeStats> {
    const mod = nativeModule();
    if (mod?.consumeNativeStats) {
      try {
        const stats = await mod.consumeNativeStats();
        const distanceKm = Number(stats?.distanceKm);
        const maxSpeedKmh = Number(stats?.maxSpeedKmh);
        const lastServerCheckpointKm = Number(stats?.lastServerCheckpointKm);
        return {
          distanceKm: Number.isFinite(distanceKm) ? distanceKm : 0,
          tripSessionId: typeof stats?.tripSessionId === 'string' ? stats.tripSessionId : null,
          routePoints: Array.isArray(stats?.routePoints) ? stats.routePoints : [],
          speedSamples: Array.isArray(stats?.speedSamples) ? stats.speedSamples : [],
          maxSpeedKmh: Number.isFinite(maxSpeedKmh) ? maxSpeedKmh : 0,
          lastServerCheckpointKm: Number.isFinite(lastServerCheckpointKm)
            ? lastServerCheckpointKm
            : undefined,
        };
      } catch {
        // fall through
      }
    }
    return { distanceKm: 0, routePoints: [], speedSamples: [], maxSpeedKmh: 0 };
  },

  addStopListener(listener: (payload?: { reason?: string }) => void): () => void {
    const emitter = Platform.OS === 'ios' && WiroomLocationService
      ? new NativeEventEmitter(WiroomLocationService as any)
      : DeviceEventEmitter;
    const sub = emitter.addListener(EVENT_STOP, listener);
    return () => sub.remove();
  },

  async getNativeProgress(): Promise<BackgroundDriveNativeProgress> {
    const mod = nativeModule();
    if (mod?.getNativeProgress) {
      try {
        const progress = await mod.getNativeProgress();
        const distanceKm = Number(progress?.distanceKm);
        const maxSpeedKmh = Number(progress?.maxSpeedKmh);
        const lastServerCheckpointKm = Number(progress?.lastServerCheckpointKm);
        return {
          distanceKm: Number.isFinite(distanceKm) ? distanceKm : 0,
          tripSessionId: typeof progress?.tripSessionId === 'string' ? progress.tripSessionId : null,
          maxSpeedKmh: Number.isFinite(maxSpeedKmh) ? maxSpeedKmh : 0,
          lastServerCheckpointKm: Number.isFinite(lastServerCheckpointKm)
            ? lastServerCheckpointKm
            : undefined,
        };
      } catch {
        // Older binaries do not expose the lightweight method.
      }
    }
    const stats = await this.getNativeStats();
    return {
      distanceKm: stats.distanceKm,
      tripSessionId: stats.tripSessionId,
      maxSpeedKmh: stats.maxSpeedKmh,
      lastServerCheckpointKm: stats.lastServerCheckpointKm,
    };
  },

  addStateListener(listener: (payload: BackgroundDriveRuntimeState) => void): () => void {
    if (Platform.OS !== 'ios' || !WiroomLocationService) return () => {};
    const emitter = new NativeEventEmitter(WiroomLocationService as any);
    const sub = emitter.addListener(EVENT_STATE, listener);
    return () => sub.remove();
  },

  async getDiagnostics(): Promise<BackgroundDriveRuntimeState[]> {
    const mod = nativeModule();
    if (!mod?.getDiagnostics) return [];
    try {
      const value = await mod.getDiagnostics();
      return Array.isArray(value) ? value : [];
    } catch {
      return [];
    }
  },

  addLocationListener(listener: (fix: BackgroundDriveFix) => void): () => void {
    const emitter = Platform.OS === 'ios' && WiroomLocationService
      ? new NativeEventEmitter(WiroomLocationService as any)
      : DeviceEventEmitter;
    const sub = emitter.addListener(EVENT_LOCATION, (fix: BackgroundDriveFix) => {
      listener(fix);
    });
    return () => sub.remove();
  },
};

export type NativeDistanceOwnership = {
  nativeOwnsSession: boolean;
  nativeDistanceKm: number;
  tripSessionId: string | null;
};

/** Returns whether the native BG module owns distance for the current (or expected) session. */
export async function resolveNativeDistanceOwnership(
  expectedSessionId?: string | null,
): Promise<NativeDistanceOwnership> {
  const [state, stats] = await Promise.all([
    BackgroundDriveController.getState(),
    BackgroundDriveController.getNativeStats(),
  ]);
  const sessionId = typeof state.tripSessionId === 'string' ? state.tripSessionId : null;
  const nativeKm = Number(stats.distanceKm);
  const sessionMatches = !expectedSessionId || sessionId === expectedSessionId;
  const statsMatch = !stats.tripSessionId || stats.tripSessionId === sessionId;
  const nativeOwnsSession = state.active
    && !!sessionId
    && sessionMatches
    && statsMatch
    && Number.isFinite(nativeKm)
    && nativeKm > 0;
  return {
    nativeOwnsSession,
    nativeDistanceKm: nativeOwnsSession ? nativeKm : 0,
    tripSessionId: sessionId,
  };
}

export { EVENT_LOCATION as BACKGROUND_DRIVE_LOCATION_EVENT, EVENT_STOP as BACKGROUND_DRIVE_STOP_EVENT };
