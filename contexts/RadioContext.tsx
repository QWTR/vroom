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
  normalizeRadioCredentials,
  radioUserIdFromRelay,
  type RadioRoomCredential,
  type RadioTokenResponse,
} from '../lib/radioCredentials';
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

function snapshotFromJoin(joined: any): RadioSnapshot {
  return {
    selfUserId: joined.selfUserId,
    active: joined.active,
    participants: Array.isArray(joined.participants) ? joined.participants : [],
    speakers: Array.isArray(joined.speakers) ? joined.speakers : [],
    pendingSpeakerIds: Array.isArray(joined.pendingSpeakerIds) ? joined.pendingSpeakerIds : [],
    serverAt: Number(joined.serverAt) || Date.now(),
    generation: Number.isFinite(Number(joined.generation)) ? Number(joined.generation) : undefined,
    mutedOnConnect: joined.mutedOnConnect !== false,
  };
}

function createRadioRoom() {
  return new Room({
    adaptiveStream: false,
    dynacast: false,
    audioCaptureDefaults: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    publishDefaults: { audioPreset: { maxBitrate: 32_000 } },
  });
}

// Voice activation must not close the speaker lease between quiet syllables.
// A short attack keeps it responsive, while hysteresis and a longer release
// prevent the relay from chopping a sentence into many tiny audio bursts.
const VAD_SAMPLE_INTERVAL_MS = 120;
const VAD_ATTACK_SAMPLES = 1;
const VAD_RELEASE_HOLD_MS = 2_400;
const VAD_SUSTAIN_THRESHOLD_RATIO = 0.62;

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
  const listenerRoomsRef = useRef<Map<string, Room>>(new Map());
  const inputRef = useRef<RadioJoinInput | null>(null);
  const vadTrackRef = useRef<LocalAudioTrack | null>(null);
  const vadTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const vadHotSamplesRef = useRef(0);
  const vadLastVoiceAtRef = useRef(0);
  const vadNoiseFloorRef = useRef(0.01);
  const vadSampleBusyRef = useRef(false);
  const vadSampleErrorsRef = useRef(0);
  const transmitBusyRef = useRef(false);
  const transmittingRef = useRef(false);
  const awaitingModeratedGrantRef = useRef(false);
  const preferencesRef = useRef(preferences);
  const allowedParticipantIdsRef = useRef<Set<number>>(new Set());
  const mutedUserIdsRef = useRef<ReadonlySet<number>>(mutedUserIds);
  const listenerRefreshRef = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => { preferencesRef.current = preferences; }, [preferences]);
  useEffect(() => { transmittingRef.current = isTransmitting; }, [isTransmitting]);
  useEffect(() => { mutedUserIdsRef.current = mutedUserIds; }, [mutedUserIds]);
  useEffect(() => {
    const allowed = new Set((snapshot?.participants || [])
      .filter((participant) => participant.userId !== snapshot?.selfUserId)
      .map((participant) => participant.userId));
    allowedParticipantIdsRef.current = allowed;
    const rooms = [roomRef.current, ...listenerRoomsRef.current.values()].filter((room): room is Room => Boolean(room));
    rooms.forEach((room) => room.remoteParticipants.forEach((participant) => {
      participant.trackPublications.forEach((publication) => {
        const userId = radioUserIdFromRelay(participant.identity, publication.trackName);
        publication.setSubscribed(userId !== null && allowed.has(userId));
        if (userId !== null) participant.setVolume(mutedUserIds.has(userId) ? 0 : 1);
      });
    }));
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
    vadSampleBusyRef.current = false;
    vadSampleErrorsRef.current = 0;
  }, []);

  const forceLocalMute = useCallback(async () => {
    const room = roomRef.current;
    const vadTrack = vadTrackRef.current;
    vadTrackRef.current = null;
    if (vadTimerRef.current) clearInterval(vadTimerRef.current);
    vadTimerRef.current = null;
    if (room) {
      try { await room.localParticipant.setMicrophoneEnabled(false); } catch {}
    }
    if (vadTrack) {
      try { await room?.localParticipant.unpublishTrack(vadTrack, false); } catch {}
      vadTrack.stop();
    }
    setVadArmedState(false);
    await stopRadioForegroundService().catch(() => {});
    setIsTransmitting(false);
    transmittingRef.current = false;
    awaitingModeratedGrantRef.current = false;
  }, []);

  const finishLocalTransmission = useCallback(async () => {
    const room = roomRef.current;
    // During VAD the published track must remain alive so sender statistics
    // continue exposing the local microphone level. Redis leases at the relay
    // decide whether its frames are audible to anyone.
    if (room && !vadTrackRef.current) {
      try { await room.localParticipant.setMicrophoneEnabled(false); } catch {}
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
    const listenerRooms = [...listenerRoomsRef.current.values()];
    roomRef.current = null;
    listenerRoomsRef.current.clear();
    await Promise.all([
      room?.disconnect(true).catch(() => {}),
      ...listenerRooms.map((listenerRoom) => listenerRoom.disconnect(true).catch(() => {})),
    ]);
    await AudioSession.stopAudioSession().catch(() => {});
    await stopRadioForegroundService().catch(() => {});
    setSharedSocketBackgroundHold('vroom-cb', false);
    inputRef.current = null;
    setSnapshot(null);
    setConnectionState('idle');
  }, [forceLocalMute, stopVadMonitor]);

  const applyRemotePublication = useCallback((publication: any, participant: any) => {
    const userId = radioUserIdFromRelay(participant.identity, publication.trackName);
    const subscribed = userId !== null && allowedParticipantIdsRef.current.has(userId);
    publication.setSubscribed(subscribed);
    if (userId !== null) participant.setVolume(mutedUserIdsRef.current.has(userId) ? 0 : 1);
  }, []);

  const resumeRadioSession = useCallback(async () => {
    const input = inputRef.current;
    if (!input) return;
    try {
      const joined = await socketAck<any>('radio:join', {
        ...input,
        resume: true,
        transmitMode: preferencesRef.current.transmitMode,
      });
      if (!joined?.ok) throw new Error(joined?.message || 'Nie udało się wznowić kanału CB.');
      setSnapshot(snapshotFromJoin(joined));
    } catch (cause: any) {
      setError(cause?.message || 'Nie udało się wznowić kanału CB.');
    }
  }, []);

  const wirePublisherRoom = useCallback((room: Room, receivesAudio: boolean) => {
    room.on(RoomEvent.ConnectionStateChanged, setConnectionState);
    room.on(RoomEvent.Reconnecting, () => {
      void forceLocalMute();
      void socketAck('radio:speak-release', {}).catch(() => {});
    });
    room.on(RoomEvent.Reconnected, () => {
      void forceLocalMute();
      void resumeRadioSession();
    });
    room.on(RoomEvent.MediaDevicesChanged, () => {
      void forceLocalMute();
      void socketAck('radio:speak-release', {}).catch(() => {});
    });
    room.on(RoomEvent.Disconnected, () => {
      setIsTransmitting(false);
      transmittingRef.current = false;
    });
    if (receivesAudio) room.on(RoomEvent.TrackPublished, applyRemotePublication);
  }, [applyRemotePublication, forceLocalMute, resumeRadioSession]);

  const wireListenerRoom = useCallback((room: Room) => {
    room.on(RoomEvent.Reconnecting, () => {
      void forceLocalMute();
      void socketAck('radio:speak-release', {}).catch(() => {});
    });
    room.on(RoomEvent.TrackPublished, applyRemotePublication);
  }, [applyRemotePublication, forceLocalMute]);

  const connectListenerRoom = useCallback(async (credential: RadioRoomCredential) => {
    const roomName = credential.roomName;
    if (!roomName) throw new Error('Brak nazwy kanału odbiorczego CB.');
    const existing = listenerRoomsRef.current.get(roomName);
    if (existing) return existing;
    const room = createRadioRoom();
    wireListenerRoom(room);
    listenerRoomsRef.current.set(roomName, room);
    try {
      await room.connect(credential.serverUrl, credential.token, { autoSubscribe: false });
      room.remoteParticipants.forEach((participant) => {
        participant.trackPublications.forEach((publication) => applyRemotePublication(publication, participant));
      });
      return room;
    } catch (cause) {
      listenerRoomsRef.current.delete(roomName);
      await room.disconnect(true).catch(() => {});
      throw cause;
    }
  }, [applyRemotePublication, wireListenerRoom]);

  const reconcilePublicListeners = useCallback((input: RadioJoinInput) => {
    const nextTask = listenerRefreshRef.current.catch(() => {}).then(async () => {
      if (!inputRef.current || inputRef.current.mode === 'private') return;
      const response = await apiRequest<RadioTokenResponse>('/radio/token', {
        method: 'POST',
        body: { ...input, transmitMode: preferencesRef.current.transmitMode },
      });
      const credentials = normalizeRadioCredentials(response, input.mode);
      const desiredNames = new Set(credentials.listeners.map((row) => row.roomName as string));
      await Promise.all(credentials.listeners.map(connectListenerRoom));
      const obsolete = [...listenerRoomsRef.current.entries()].filter(([roomName]) => !desiredNames.has(roomName));
      obsolete.forEach(([roomName]) => listenerRoomsRef.current.delete(roomName));
      await Promise.all(obsolete.map(([, room]) => room.disconnect(true).catch(() => {})));
    });
    listenerRefreshRef.current = nextTask;
    return nextTask;
  }, [connectListenerRoom]);

  const connect = useCallback(async (input: RadioJoinInput) => {
    setError(null);
    let stage = 'resetowanie poprzedniego połączenia';
    try {
      await disconnect();
      stage = 'dołączanie do kanału sterującego';
      const joined = await socketAck<any>('radio:join', { ...input, transmitMode: preferencesRef.current.transmitMode });
      if (!joined?.ok) throw Object.assign(new Error(joined?.message || 'Nie udało się wejść na kanał.'), { code: joined?.code });
      setSnapshot(snapshotFromJoin(joined));
      inputRef.current = input;
      setSharedSocketBackgroundHold('vroom-cb', true);
      stage = 'pobieranie dostępu do audio';
      const tokenResponse = await apiRequest<RadioTokenResponse>('/radio/token', { method: 'POST', body: { ...input, transmitMode: preferencesRef.current.transmitMode } });
      stage = 'sprawdzanie danych kanału audio';
      const credentials = normalizeRadioCredentials(tokenResponse, input.mode);
      stage = 'konfiguracja dźwięku telefonu';
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
      stage = 'uruchamianie dźwięku telefonu';
      await AudioSession.startAudioSession();
      stage = 'tworzenie połączenia audio';
      const room = createRadioRoom();
      wirePublisherRoom(room, !credentials.usesPublicRelay);
      roomRef.current = room;
      stage = 'łączenie z serwerem głosowym';
      await room.connect(credentials.publisher.serverUrl, credentials.publisher.token, { autoSubscribe: false });
      stage = 'wyciszanie mikrofonu po połączeniu';
      await room.localParticipant.setMicrophoneEnabled(false);
      stage = 'łączenie kanałów odbiorczych';
      await Promise.all(credentials.listeners.map(connectListenerRoom));
      setConnectionState(room.state);
      return true;
    } catch (cause: any) {
      const detail = cause?.stack || cause?.message || String(cause);
      console.error('[VROOM_CB_CONNECT]', stage, detail);
      await disconnect();
      setError(`${stage}: ${cause?.message || 'Nie udało się połączyć z VROOM CB.'}`);
      return false;
    }
  }, [connectListenerRoom, disconnect, wirePublisherRoom]);

  const publishGrantedMicrophone = useCallback(async () => {
    const room = roomRef.current;
    if (!room) throw new Error('Brak połączenia audio.');
    if (vadTrackRef.current) {
      const publication = Array.from(room.localParticipant.audioTrackPublications.values())
        .find((candidate) => candidate.track === vadTrackRef.current);
      if (!publication) {
        await room.localParticipant.publishTrack(vadTrackRef.current, { source: 'microphone' as any, audioPreset: { maxBitrate: 32_000 } });
      }
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
    await finishLocalTransmission();
    await socketAck('radio:speak-release', {}).catch(() => {});
  }, [finishLocalTransmission]);

  const startVadMonitor = useCallback(async () => {
    if (!roomRef.current || vadTrackRef.current) return;
    const room = roomRef.current;
    const track = await createLocalAudioTrack({ echoCancellation: true, noiseSuppression: true, autoGainControl: true });
    await room.localParticipant.publishTrack(track, { source: 'microphone' as any, audioPreset: { maxBitrate: 32_000 } });
    vadTrackRef.current = track;
    vadTimerRef.current = setInterval(async () => {
      if (vadSampleBusyRef.current) return;
      const activeTrack = vadTrackRef.current;
      if (!activeTrack) return;
      vadSampleBusyRef.current = true;
      try {
        const statsLevel = maxAudioLevel(await activeTrack.getRTCStatsReport());
        const participantLevel = Number(roomRef.current?.localParticipant.audioLevel || 0);
        const level = Math.max(statsLevel, Number.isFinite(participantLevel) ? participantLevel : 0);
        vadSampleErrorsRef.current = 0;
        const sensitivity = preferencesRef.current.vadSensitivity;
        const threshold = Math.max(0.008, vadNoiseFloorRef.current * (2.5 - sensitivity * 0.012));
        const now = Date.now();
        const opensGate = level >= threshold;
        const sustainsGate = level >= Math.max(0.004, threshold * VAD_SUSTAIN_THRESHOLD_RATIO);
        if (opensGate) {
          vadHotSamplesRef.current += 1;
          vadLastVoiceAtRef.current = now;
          if (vadHotSamplesRef.current >= VAD_ATTACK_SAMPLES && !transmittingRef.current) void startTransmission();
        } else if (transmittingRef.current && sustainsGate) {
          // Once speech has opened the gate, keep it open for quieter phonemes.
          vadHotSamplesRef.current = 0;
          vadLastVoiceAtRef.current = now;
        } else {
          if (!transmittingRef.current && level < threshold * 0.8) {
            vadNoiseFloorRef.current = vadNoiseFloorRef.current * 0.92 + Math.max(0.002, level) * 0.08;
          }
          vadHotSamplesRef.current = 0;
          if (transmittingRef.current && vadLastVoiceAtRef.current > 0 && now - vadLastVoiceAtRef.current > VAD_RELEASE_HOLD_MS) void stopTransmission();
        }
      } catch (cause: any) {
        vadSampleErrorsRef.current += 1;
        if (vadSampleErrorsRef.current === 5) {
          console.error('[VROOM_CB_VAD]', cause?.stack || cause?.message || String(cause));
          setError('Wykrywanie mowy nie może odczytać poziomu mikrofonu.');
        }
      } finally {
        vadSampleBusyRef.current = false;
      }
    }, VAD_SAMPLE_INTERVAL_MS);
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
        await stopVadMonitor();
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
      const nextRadiusKm = radiusKm ?? preferencesRef.current.radiusKm;
      const result = await socketAck<any>('radio:position', { ...location, radiusKm: nextRadiusKm });
      if (!result?.ok) throw new Error(result?.message || 'Nie udało się zaktualizować zasięgu.');
      if (result.snapshot) setSnapshot(snapshotFromJoin(result.snapshot));
      const nextInput: RadioJoinInput = { ...inputRef.current, location, radiusKm: nextRadiusKm };
      inputRef.current = nextInput;
      const desiredRooms = new Set<string>(
        Array.isArray(result.snapshot?.active?.downlinkRooms)
          ? result.snapshot.active.downlinkRooms.filter((roomName: unknown): roomName is string => typeof roomName === 'string')
          : [],
      );
      const connectedRooms = new Set(listenerRoomsRef.current.keys());
      const roomsChanged = desiredRooms.size !== connectedRooms.size
        || [...desiredRooms].some((roomName) => !connectedRooms.has(roomName));
      if (roomsChanged) await reconcilePublicListeners(nextInput);
      return true;
    } catch (cause: any) {
      setError(cause?.message || 'Nie udało się zaktualizować zasięgu.');
      return false;
    }
  }, [reconcilePublicListeners]);

  const setParticipantMuted = useCallback((userId: number, muted: boolean) => {
    const rooms = [roomRef.current, ...listenerRoomsRef.current.values()].filter((room): room is Room => Boolean(room));
    rooms.forEach((room) => room.remoteParticipants.forEach((participant) => {
      const belongsToUser = [...participant.trackPublications.values()].some((publication) => (
        radioUserIdFromRelay(participant.identity, publication.trackName) === Number(userId)
      ));
      if (belongsToUser) participant.setVolume(muted ? 0 : 1);
    }));
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
      const onSnapshot = (next: RadioSnapshot | null) => setSnapshot(next ? snapshotFromJoin(next) : null);
      const onReleased = () => { void finishLocalTransmission(); };
      const onGranted = () => {
        if (!awaitingModeratedGrantRef.current) return;
        awaitingModeratedGrantRef.current = false;
        void publishGrantedMicrophone().catch((cause: any) => setError(cause?.message || 'Nie udało się włączyć mikrofonu.'));
      };
      const onClosed = () => { void disconnect(); };
      const onSocketConnected = () => {
        if (!inputRef.current || !roomRef.current) return;
        void forceLocalMute();
        void resumeRadioSession();
      };
      socket.on('connect', onSocketConnected);
      socket.on('radio:snapshot', onSnapshot);
      socket.on('radio:speak-released', onReleased);
      socket.on('radio:speak-granted', onGranted);
      socket.on('radio:closed', onClosed);
      socket.on('radio:state-invalidated', onClosed);
      cleanup = () => {
        socket.off('connect', onSocketConnected);
        socket.off('radio:snapshot', onSnapshot);
        socket.off('radio:speak-released', onReleased);
        socket.off('radio:speak-granted', onGranted);
        socket.off('radio:closed', onClosed);
        socket.off('radio:state-invalidated', onClosed);
      };
    });
    return () => cleanup();
  }, [disconnect, finishLocalTransmission, forceLocalMute, publishGrantedMicrophone, resumeRadioSession]);

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
    listenerRoomsRef.current.forEach((room) => { void room.disconnect(true); });
    listenerRoomsRef.current.clear();
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
