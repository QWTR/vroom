import { AudioSession, audioDeviceModuleEvents } from '@livekit/react-native';
import {
  ConnectionState,
  LocalAudioTrack,
  Room,
  RoomEvent,
  createLocalAudioTrack,
} from 'livekit-client';
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AppState, Platform } from 'react-native';
import { apiRequest } from '../lib/api/client';
import {
  ensureSharedSocket,
  setSharedSocketBackgroundHold,
} from '../lib/sharedSocket';
import type {
  RadioCity,
  RadioConfig,
  RadioMode,
  RadioPreferences,
  RadioSnapshot,
} from '../types/radio';
import { startRadioForegroundService, stopRadioForegroundService } from '../lib/radioForegroundService';

type RadioJoinInput = {
  mode: RadioMode;
  radiusKm?: number;
  citySlug?: string;
  convoyId?: string;
  location?: { lat: number; lng: number };
};

type RadioContextValue = {
  config: RadioConfig | null;
  preferences: RadioPreferences;
  snapshot: RadioSnapshot | null;
  connectionState: ConnectionState | 'idle';
  isTransmitting: boolean;
  vadArmed: boolean;
  error: string | null;
  loadConfig: () => Promise<void>;
  searchCities: (query: string) => Promise<RadioCity[]>;
  updatePreferences: (patch: Partial<RadioPreferences>) => Promise<RadioPreferences>;
  connect: (input: RadioJoinInput) => Promise<boolean>;
  disconnect: () => Promise<void>;
  startTransmission: () => Promise<boolean>;
  stopTransmission: () => Promise<void>;
  setVadArmed: (armed: boolean) => Promise<void>;
  moderateSpeaker: (userId: number, approve: boolean) => Promise<boolean>;
  reportSpeaker: (userId: number, reason?: string) => Promise<boolean>;
  updateGlobalPosition: (location: { lat: number; lng: number }, radiusKm?: number) => Promise<boolean>;
  setParticipantMuted: (userId: number, muted: boolean) => void;
  blockParticipant: (userId: number) => Promise<boolean>;
  mutedUserIds: ReadonlySet<number>;
};

const DEFAULT_PREFERENCES: RadioPreferences = {
  radiusKm: 25,
  citySlug: null,
  transmitMode: 'ptt',
  vadSensitivity: 50,
};

const RadioContext = createContext<RadioContextValue | null>(null);

function socketAck<T>(event: string, payload: unknown): Promise<T> {
  return ensureSharedSocket().then((socket) => new Promise<T>((resolve, reject) => {
    if (!socket) return reject(new Error('Brak aktywnej sesji.'));
    const timer = setTimeout(() => reject(new Error('Serwer CB nie odpowiada.')), 8_000);
    socket.emit(event, payload, (result: T) => {
      clearTimeout(timer);
      resolve(result);
    });
  }));
}

function maxAudioLevel(report: any): number {
  let level = 0;
  if (!report) return level;
  const visit = (stat: any) => {
    const next = Number(stat?.audioLevel ?? stat?.audio_level ?? 0);
    if (Number.isFinite(next)) level = Math.max(level, next);
  };
  if (typeof report.forEach === 'function') report.forEach(visit);
  else if (Array.isArray(report)) report.forEach(visit);
  else Object.values(report).forEach(visit);
  return level;
}

export function RadioProvider({ children }: { children: React.ReactNode }) {
  const [config, setConfig] = useState<RadioConfig | null>(null);
  const [preferences, setPreferences] = useState(DEFAULT_PREFERENCES);
  const [snapshot, setSnapshot] = useState<RadioSnapshot | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState | 'idle'>('idle');
  const [isTransmitting, setIsTransmitting] = useState(false);
  const [vadArmed, setVadArmedState] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mutedUserIds, setMutedUserIds] = useState<ReadonlySet<number>>(() => new Set());
  const roomRef = useRef<Room | null>(null);
  const inputRef = useRef<RadioJoinInput | null>(null);
  const vadTrackRef = useRef<LocalAudioTrack | null>(null);
  const vadTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const vadHotSamplesRef = useRef(0);
  const vadLastVoiceAtRef = useRef(0);
  const vadNoiseFloorRef = useRef(0.01);
  const transmitBusyRef = useRef(false);
  const transmittingRef = useRef(false);
  const awaitingModeratedGrantRef = useRef(false);
  const preferencesRef = useRef(preferences);
  const allowedParticipantIdsRef = useRef<Set<number>>(new Set());

  useEffect(() => { preferencesRef.current = preferences; }, [preferences]);
  useEffect(() => { transmittingRef.current = isTransmitting; }, [isTransmitting]);
  useEffect(() => {
    const allowed = new Set((snapshot?.participants || []).map((participant) => participant.userId));
    allowedParticipantIdsRef.current = allowed;
    roomRef.current?.remoteParticipants.forEach((participant) => {
      const userId = Number(String(participant.identity).replace(/^user:/, ''));
      participant.trackPublications.forEach((publication) => publication.setSubscribed(allowed.has(userId)));
      if (mutedUserIds.has(userId)) participant.setVolume(0);
    });
  }, [mutedUserIds, snapshot]);

  const loadConfig = useCallback(async () => {
    try {
      const next = await apiRequest<RadioConfig>('/radio/config', { priority: 'visible' });
      setConfig(next);
      setPreferences(next.preferences);
    } catch (cause: any) {
      if (cause?.code !== 'AUTH_TOKEN_MISSING') setError(cause?.message || 'Nie udało się pobrać konfiguracji CB.');
    }
  }, []);

  const searchCities = useCallback((query: string) => apiRequest<RadioCity[]>(`/radio/cities?q=${encodeURIComponent(query)}`, { priority: 'visible' }), []);

  const updatePreferences = useCallback(async (patch: Partial<RadioPreferences>) => {
    const next = await apiRequest<RadioPreferences>('/radio/preferences', { method: 'PATCH', body: { ...preferencesRef.current, ...patch } });
    setPreferences(next);
    return next;
  }, []);

  const stopVadMonitor = useCallback(async () => {
    if (vadTimerRef.current) clearInterval(vadTimerRef.current);
    vadTimerRef.current = null;
    const track = vadTrackRef.current;
    vadTrackRef.current = null;
    if (track) {
      try { await roomRef.current?.localParticipant.unpublishTrack(track, false); } catch {}
      track.stop();
    }
    vadHotSamplesRef.current = 0;
    vadLastVoiceAtRef.current = 0;
    vadNoiseFloorRef.current = 0.01;
  }, []);

  const forceLocalMute = useCallback(async () => {
    const room = roomRef.current;
    if (!room) return;
    try { await room.localParticipant.setMicrophoneEnabled(false); } catch {}
    const vadTrack = vadTrackRef.current;
    if (vadTrack) {
      try { await room.localParticipant.unpublishTrack(vadTrack, false); } catch {}
    }
    setIsTransmitting(false);
    transmittingRef.current = false;
    awaitingModeratedGrantRef.current = false;
  }, []);

  const disconnect = useCallback(async () => {
    setVadArmedState(false);
    await forceLocalMute();
    await stopVadMonitor();
    try { await socketAck('radio:leave', {}); } catch {}
    const room = roomRef.current;
    roomRef.current = null;
    if (room) await room.disconnect(true).catch(() => {});
    await AudioSession.stopAudioSession().catch(() => {});
    await stopRadioForegroundService().catch(() => {});
    setSharedSocketBackgroundHold('vroom-cb', false);
    inputRef.current = null;
    setSnapshot(null);
    setConnectionState('idle');
  }, [forceLocalMute, stopVadMonitor]);

  const wireRoom = useCallback((room: Room) => {
    room.on(RoomEvent.ConnectionStateChanged, setConnectionState);
    room.on(RoomEvent.Reconnecting, () => {
      void forceLocalMute();
      void socketAck('radio:speak-release', {}).catch(() => {});
    });
    room.on(RoomEvent.Reconnected, () => {
      void forceLocalMute();
    });
    room.on(RoomEvent.MediaDevicesChanged, () => {
      void forceLocalMute();
      void socketAck('radio:speak-release', {}).catch(() => {});
    });
    room.on(RoomEvent.Disconnected, () => {
      setIsTransmitting(false);
      transmittingRef.current = false;
    });
    room.on(RoomEvent.TrackPublished, (publication, participant) => {
      const userId = Number(String(participant.identity).replace(/^user:/, ''));
      publication.setSubscribed(allowedParticipantIdsRef.current.has(userId));
    });
  }, [forceLocalMute]);

  const connect = useCallback(async (input: RadioJoinInput) => {
    setError(null);
    try {
      await disconnect();
      const joined = await socketAck<any>('radio:join', { ...input, transmitMode: preferencesRef.current.transmitMode });
      if (!joined?.ok) throw Object.assign(new Error(joined?.message || 'Nie udało się wejść na kanał.'), { code: joined?.code });
      setSnapshot({ selfUserId: joined.selfUserId, active: joined.active, participants: joined.participants, speakers: joined.speakers, pendingSpeakerIds: joined.pendingSpeakerIds || [], serverAt: joined.serverAt });
      inputRef.current = input;
      setSharedSocketBackgroundHold('vroom-cb', true);
      const credentials = await apiRequest<{
        token: string;
        serverUrl: string;
        roomName: string;
      }>('/radio/token', { method: 'POST', body: { ...input, transmitMode: preferencesRef.current.transmitMode } });
      await AudioSession.configureAudio({
        android: {
          preferredOutputList: ['bluetooth', 'headset', 'speaker', 'earpiece'],
          audioTypeOptions: {
            manageAudioFocus: true,
            audioMode: 'inCommunication',
            audioFocusMode: 'gainTransientMayDuck',
            audioStreamType: 'voiceCall',
            audioAttributesUsageType: 'voiceCommunication',
            audioAttributesContentType: 'speech',
            forceHandleAudioRouting: true,
          },
        },
        ios: { defaultOutput: 'earpiece' },
      });
      await AudioSession.startAudioSession();
      const room = new Room({
        adaptiveStream: false,
        dynacast: false,
        audioCaptureDefaults: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        publishDefaults: { audioPreset: { maxBitrate: 32_000 } },
      });
      wireRoom(room);
      roomRef.current = room;
      await room.connect(credentials.serverUrl, credentials.token, { autoSubscribe: false });
      await room.localParticipant.setMicrophoneEnabled(false);
      setConnectionState(room.state);
      return true;
    } catch (cause: any) {
      await disconnect();
      setError(cause?.message || 'Nie udało się połączyć z VROOM CB.');
      return false;
    }
  }, [disconnect, wireRoom]);

  const publishGrantedMicrophone = useCallback(async () => {
    const room = roomRef.current;
    if (!room) throw new Error('Brak połączenia audio.');
    if (vadTrackRef.current) {
      await room.localParticipant.publishTrack(vadTrackRef.current, { source: 'microphone' as any, audioPreset: { maxBitrate: 32_000 } });
    } else {
      await room.localParticipant.setMicrophoneEnabled(true, { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, { audioPreset: { maxBitrate: 32_000 } });
    }
    setIsTransmitting(true);
    transmittingRef.current = true;
  }, []);

  const startTransmission = useCallback(async () => {
    if (transmitBusyRef.current || transmittingRef.current || !roomRef.current) return false;
    transmitBusyRef.current = true;
    try {
      const result = await socketAck<any>('radio:speak-request', {});
      if (!result?.ok) {
        if (result?.code === 'WAITING_FOR_APPROVAL') awaitingModeratedGrantRef.current = true;
        else setError(result?.code === 'CHANNEL_BUSY' ? 'Kanał jest zajęty.' : result?.message || 'Nie można teraz nadawać.');
        return false;
      }
      await publishGrantedMicrophone();
      return true;
    } catch (cause: any) {
      await socketAck('radio:speak-release', {}).catch(() => {});
      setError(cause?.message || 'Nie udało się włączyć mikrofonu.');
      return false;
    } finally {
      transmitBusyRef.current = false;
    }
  }, [publishGrantedMicrophone]);

  const stopTransmission = useCallback(async () => {
    if (!roomRef.current) return;
    await forceLocalMute();
    await socketAck('radio:speak-release', {}).catch(() => {});
  }, [forceLocalMute]);

  const startVadMonitor = useCallback(async () => {
    if (!roomRef.current || vadTrackRef.current) return;
    const track = await createLocalAudioTrack({ echoCancellation: true, noiseSuppression: true, autoGainControl: true });
    vadTrackRef.current = track;
    vadTimerRef.current = setInterval(async () => {
      const activeTrack = vadTrackRef.current;
      if (!activeTrack) return;
      try {
        const level = maxAudioLevel(await activeTrack.getRTCStatsReport());
        const sensitivity = preferencesRef.current.vadSensitivity;
        const threshold = Math.max(0.008, vadNoiseFloorRef.current * (2.5 - sensitivity * 0.012));
        const now = Date.now();
        if (level >= threshold) {
          vadHotSamplesRef.current += 1;
          vadLastVoiceAtRef.current = now;
          if (vadHotSamplesRef.current >= 2 && !transmittingRef.current) void startTransmission();
        } else {
          if (!transmittingRef.current && level < threshold * 1.5) {
            vadNoiseFloorRef.current = vadNoiseFloorRef.current * 0.92 + Math.max(0.002, level) * 0.08;
          }
          vadHotSamplesRef.current = 0;
          if (transmittingRef.current && vadLastVoiceAtRef.current > 0 && now - vadLastVoiceAtRef.current > 1_200) void stopTransmission();
        }
      } catch {}
    }, 180);
  }, [startTransmission, stopTransmission]);

  const setVadArmed = useCallback(async (armed: boolean) => {
    setError(null);
    setVadArmedState(armed);
    if (armed) {
      await updatePreferences({ transmitMode: 'vad' });
      try {
        await startRadioForegroundService();
        await startVadMonitor();
      } catch (cause: any) {
        setVadArmedState(false);
        await stopRadioForegroundService().catch(() => {});
        setError(cause?.message || 'Brak dostępu do mikrofonu.');
      }
    } else {
      await updatePreferences({ transmitMode: 'ptt' });
      await stopTransmission();
      await stopVadMonitor();
      await stopRadioForegroundService().catch(() => {});
    }
  }, [startVadMonitor, stopTransmission, stopVadMonitor, updatePreferences]);

  const moderateSpeaker = useCallback(async (userId: number, approve: boolean) => {
    const result = await socketAck<any>('radio:speak-moderate', { userId, approve });
    if (!result?.ok) setError('Nie udało się zmienić dostępu do mikrofonu.');
    return Boolean(result?.ok);
  }, []);

  const reportSpeaker = useCallback(async (userId: number, reason = 'voice_abuse') => {
    try {
      await apiRequest('/radio/report', { method: 'POST', body: { offenderUserId: userId, reason } });
      return true;
    } catch (cause: any) {
      setError(cause?.message || 'Nie udało się wysłać zgłoszenia.');
      return false;
    }
  }, []);

  const updateGlobalPosition = useCallback(async (location: { lat: number; lng: number }, radiusKm?: number) => {
    if (inputRef.current?.mode !== 'global') return false;
    try {
      const result = await socketAck<any>('radio:position', { ...location, radiusKm: radiusKm ?? preferencesRef.current.radiusKm });
      if (!result?.ok) throw new Error(result?.message || 'Nie udało się zaktualizować zasięgu.');
      if (result.snapshot) setSnapshot(result.snapshot);
      inputRef.current = { ...inputRef.current, location, radiusKm: radiusKm ?? preferencesRef.current.radiusKm };
      return true;
    } catch (cause: any) {
      setError(cause?.message || 'Nie udało się zaktualizować zasięgu.');
      return false;
    }
  }, []);

  const setParticipantMuted = useCallback((userId: number, muted: boolean) => {
    const identity = `user:${Number(userId)}`;
    roomRef.current?.remoteParticipants.get(identity)?.setVolume(muted ? 0 : 1);
    setMutedUserIds((current) => {
      const next = new Set(current);
      if (muted) next.add(userId);
      else next.delete(userId);
      return next;
    });
  }, []);

  const blockParticipant = useCallback(async (userId: number) => {
    try {
      setParticipantMuted(userId, true);
      await apiRequest(`/moderation/block/${userId}`, { method: 'POST' });
      await socketAck('radio:block-refresh', {}).catch(() => {});
      return true;
    } catch (cause: any) {
      setParticipantMuted(userId, false);
      setError(cause?.message || 'Nie udało się zablokować użytkownika.');
      return false;
    }
  }, [setParticipantMuted]);

  useEffect(() => {
    let cleanup = () => {};
    void ensureSharedSocket().then((socket) => {
      if (!socket) return;
      const onSnapshot = (next: RadioSnapshot) => setSnapshot(next);
      const onReleased = () => { void forceLocalMute(); };
      const onGranted = () => {
        if (!awaitingModeratedGrantRef.current) return;
        awaitingModeratedGrantRef.current = false;
        void publishGrantedMicrophone().catch((cause: any) => setError(cause?.message || 'Nie udało się włączyć mikrofonu.'));
      };
      const onClosed = () => { void disconnect(); };
      socket.on('radio:snapshot', onSnapshot);
      socket.on('radio:speak-released', onReleased);
      socket.on('radio:speak-granted', onGranted);
      socket.on('radio:closed', onClosed);
      cleanup = () => {
        socket.off('radio:snapshot', onSnapshot);
        socket.off('radio:speak-released', onReleased);
        socket.off('radio:speak-granted', onGranted);
        socket.off('radio:closed', onClosed);
      };
    });
    return () => cleanup();
  }, [disconnect, forceLocalMute, publishGrantedMicrophone]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active' && preferencesRef.current.transmitMode === 'ptt' && transmittingRef.current) void stopTransmission();
    });
    return () => subscription.remove();
  }, [stopTransmission]);

  useEffect(() => {
    if (Platform.OS !== 'ios') return undefined;
    audioDeviceModuleEvents.setDidStopEngineHandler(async () => {
      await forceLocalMute();
      await socketAck('radio:speak-release', {}).catch(() => {});
    });
    return () => audioDeviceModuleEvents.setDidStopEngineHandler(null);
  }, [forceLocalMute]);

  useEffect(() => () => {
    if (vadTimerRef.current) clearInterval(vadTimerRef.current);
    setSharedSocketBackgroundHold('vroom-cb', false);
    void roomRef.current?.disconnect(true);
  }, []);

  const value = useMemo<RadioContextValue>(() => ({
    config,
    preferences,
    snapshot,
    connectionState,
    isTransmitting,
    vadArmed,
    error,
    loadConfig,
    searchCities,
    updatePreferences,
    connect,
    disconnect,
    startTransmission,
    stopTransmission,
    setVadArmed,
    moderateSpeaker,
    reportSpeaker,
    updateGlobalPosition,
    setParticipantMuted,
    blockParticipant,
    mutedUserIds,
  }), [config, preferences, snapshot, connectionState, isTransmitting, vadArmed, error, loadConfig, searchCities, updatePreferences, connect, disconnect, startTransmission, stopTransmission, setVadArmed, moderateSpeaker, reportSpeaker, updateGlobalPosition, setParticipantMuted, blockParticipant, mutedUserIds]);

  return <RadioContext.Provider value={value}>{children}</RadioContext.Provider>;
}

export function useRadio() {
  const value = useContext(RadioContext);
  if (!value) throw new Error('useRadio musi działać wewnątrz RadioProvider.');
  return value;
}
