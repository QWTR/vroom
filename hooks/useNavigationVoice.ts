import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Speech from 'expo-speech';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DeviceEventEmitter } from 'react-native';
import {
  DEFAULT_VOICE_PREFERENCES,
  mergeVoicePreferences,
  resolvePreferredPolishVoice,
  voicePreferencesFromLegacySpeechValue,
  VOICE_PRIORITY,
  type NavigationVoiceCategory,
  type VoiceCandidate,
  type VoicePreferences,
} from '../lib/navigation/voiceGuidanceCore';

export const NAVIGATION_VOICE_PREFERENCES_KEY = 'navigation_voice_preferences_v1';
export const NAVIGATION_VOICE_PREFERENCES_CHANGED = 'navigationVoicePreferencesChanged';
const LEGACY_SPEECH_KEY = 'map_speech_enabled';
const NON_URGENT_GAP_MS = 6_000;

export type NavigationVoiceEvent = {
  id: string;
  text: string;
  category: NavigationVoiceCategory;
  onStart?: () => void;
};

type QueuedVoiceEvent = NavigationVoiceEvent & {
  priority: number;
  queuedAt: number;
  retryWithoutVoice?: boolean;
};

function asVoiceCandidates(voices: Speech.Voice[]): VoiceCandidate[] {
  return voices.map((voice) => ({
    identifier: voice.identifier,
    language: voice.language,
    name: voice.name,
    quality: String(voice.quality ?? ''),
  }));
}

async function loadPreferences(): Promise<VoicePreferences> {
  const stored = await AsyncStorage.getItem(NAVIGATION_VOICE_PREFERENCES_KEY);
  if (stored) {
    try {
      return mergeVoicePreferences(JSON.parse(stored));
    } catch {
      return DEFAULT_VOICE_PREFERENCES;
    }
  }

  const legacy = await AsyncStorage.getItem(LEGACY_SPEECH_KEY);
  const migrated = voicePreferencesFromLegacySpeechValue(legacy);
  await AsyncStorage.setItem(NAVIGATION_VOICE_PREFERENCES_KEY, JSON.stringify(migrated));
  return migrated;
}

export function useNavigationVoice() {
  const [preferences, setPreferencesState] = useState<VoicePreferences>(DEFAULT_VOICE_PREFERENCES);
  const [voices, setVoices] = useState<VoiceCandidate[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const preferencesRef = useRef(preferences);
  const voicesRef = useRef(voices);
  const queueRef = useRef<QueuedVoiceEvent[]>([]);
  const speakingRef = useRef<QueuedVoiceEvent | null>(null);
  const lastStartedAtRef = useRef(0);
  const startedIdsRef = useRef<Set<string>>(new Set());
  const queuedIdsRef = useRef<Set<string>>(new Set());
  const pumpTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const pumpRef = useRef<() => void>(() => {});

  preferencesRef.current = preferences;
  voicesRef.current = voices;

  const selectedVoice = useMemo(
    () => resolvePreferredPolishVoice(voices, preferences),
    [preferences, voices],
  );

  const refresh = useCallback(async () => {
    const [loadedPreferences, availableVoices] = await Promise.all([
      loadPreferences(),
      Speech.getAvailableVoicesAsync().catch(() => [] as Speech.Voice[]),
    ]);
    if (!mountedRef.current) return;
    const candidates = asVoiceCandidates(availableVoices);
    const manualVoiceAvailable = candidates.length === 0
      || loadedPreferences.mode !== 'manual'
      || candidates.some((voice) => voice.identifier === loadedPreferences.voiceIdentifier);
    const nextPreferences = manualVoiceAvailable
      ? loadedPreferences
      : { ...loadedPreferences, mode: 'auto' as const, voiceIdentifier: null };
    if (!manualVoiceAvailable) {
      await AsyncStorage.setItem(
        NAVIGATION_VOICE_PREFERENCES_KEY,
        JSON.stringify(nextPreferences),
      );
    }
    setPreferencesState(nextPreferences);
    setVoices(candidates);
    setHydrated(true);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void refresh();
    const sub = DeviceEventEmitter.addListener(NAVIGATION_VOICE_PREFERENCES_CHANGED, refresh);
    return () => {
      mountedRef.current = false;
      sub.remove();
      if (pumpTimerRef.current) clearTimeout(pumpTimerRef.current);
      void Speech.stop().catch(() => {});
    };
  }, [refresh]);

  const updatePreferences = useCallback(async (patch: Partial<VoicePreferences>) => {
    const next = mergeVoicePreferences({ ...preferencesRef.current, ...patch });
    preferencesRef.current = next;
    setPreferencesState(next);
    await AsyncStorage.setItem(NAVIGATION_VOICE_PREFERENCES_KEY, JSON.stringify(next));
    await AsyncStorage.setItem(
      LEGACY_SPEECH_KEY,
      next.guidanceEnabled || next.alertsEnabled ? '1' : '0',
    );
    DeviceEventEmitter.emit(NAVIGATION_VOICE_PREFERENCES_CHANGED);
  }, []);

  const schedulePump = useCallback((delayMs: number) => {
    if (pumpTimerRef.current) clearTimeout(pumpTimerRef.current);
    pumpTimerRef.current = setTimeout(() => {
      pumpTimerRef.current = null;
      pumpRef.current();
    }, Math.max(0, delayMs));
  }, []);

  const pump = useCallback(() => {
    if (!mountedRef.current || speakingRef.current || !queueRef.current.length) return;
    queueRef.current.sort((a, b) => b.priority - a.priority || a.queuedAt - b.queuedAt);
    const next = queueRef.current.shift()!;
    queuedIdsRef.current.delete(next.id);

    const prefs = preferencesRef.current;
    const categoryEnabled = next.category === 'critical' || next.category === 'warning'
      ? prefs.alertsEnabled
      : prefs.guidanceEnabled;
    if (!categoryEnabled) {
      schedulePump(0);
      return;
    }

    const urgent = next.priority >= VOICE_PRIORITY['maneuver-now'];
    const elapsed = Date.now() - lastStartedAtRef.current;
    if (!urgent && elapsed < NON_URGENT_GAP_MS) {
      queueRef.current.push(next);
      queuedIdsRef.current.add(next.id);
      schedulePump(NON_URGENT_GAP_MS - elapsed);
      return;
    }

    const chosen = resolvePreferredPolishVoice(voicesRef.current, prefs);
    speakingRef.current = next;
    let didStart = false;
    Speech.speak(next.text, {
      language: 'pl-PL',
      voice: next.retryWithoutVoice ? undefined : chosen?.identifier,
      pitch: 1,
      rate: 0.95,
      useApplicationAudioSession: false,
      onStart: () => {
        didStart = true;
        lastStartedAtRef.current = Date.now();
        startedIdsRef.current.add(next.id);
        if (startedIdsRef.current.size > 500) startedIdsRef.current.clear();
        next.onStart?.();
      },
      onDone: () => {
        speakingRef.current = null;
        schedulePump(0);
      },
      onStopped: () => {
        speakingRef.current = null;
        schedulePump(0);
      },
      onError: () => {
        speakingRef.current = null;
        if (!didStart && chosen && !next.retryWithoutVoice) {
          queueRef.current.unshift({ ...next, retryWithoutVoice: true, queuedAt: Date.now() });
          queuedIdsRef.current.add(next.id);
        }
        schedulePump(0);
      },
    });
  }, [schedulePump]);
  pumpRef.current = pump;

  const enqueue = useCallback((event: NavigationVoiceEvent): boolean => {
    const text = event.text.replace(/\s+/g, ' ').trim();
    if (!text || startedIdsRef.current.has(event.id) || queuedIdsRef.current.has(event.id)) return false;
    const prefs = preferencesRef.current;
    const isAlert = event.category === 'critical' || event.category === 'warning';
    if ((isAlert && !prefs.alertsEnabled) || (!isAlert && !prefs.guidanceEnabled)) return false;

    const queued: QueuedVoiceEvent = {
      ...event,
      text,
      priority: VOICE_PRIORITY[event.category],
      queuedAt: Date.now(),
    };
    if (event.category === 'maneuver-now') {
      const retained = queueRef.current.filter((item) => item.category !== 'maneuver');
      queueRef.current
        .filter((item) => item.category === 'maneuver')
        .forEach((item) => queuedIdsRef.current.delete(item.id));
      queueRef.current = retained;
    }
    const active = speakingRef.current;
    if (
      active
      && queued.priority > active.priority
      && (event.category === 'critical' || event.category === 'maneuver-now')
    ) {
      queueRef.current.unshift(queued);
      queuedIdsRef.current.add(event.id);
      void Speech.stop().catch(() => {});
      return true;
    }
    queueRef.current.push(queued);
    queuedIdsRef.current.add(event.id);
    pumpRef.current();
    return true;
  }, []);

  const stop = useCallback(() => {
    queueRef.current = [];
    queuedIdsRef.current.clear();
    speakingRef.current = null;
    if (pumpTimerRef.current) clearTimeout(pumpTimerRef.current);
    pumpTimerRef.current = null;
    void Speech.stop().catch(() => {});
  }, []);

  const clearSessionDedupe = useCallback(() => {
    startedIdsRef.current.clear();
    queuedIdsRef.current.clear();
  }, []);

  const toggleMaster = useCallback(() => {
    const anyEnabled = preferencesRef.current.guidanceEnabled || preferencesRef.current.alertsEnabled;
    return updatePreferences({
      guidanceEnabled: !anyEnabled,
      alertsEnabled: !anyEnabled,
    });
  }, [updatePreferences]);

  const previewVoice = useCallback((voiceIdentifier?: string | null) => {
    void Speech.stop().catch(() => {});
    Speech.speak(
      'Za 150 metrów skręć w prawo. Potem na rondzie zjedź drugim zjazdem.',
      {
        language: 'pl-PL',
        voice: voiceIdentifier ?? selectedVoice?.identifier,
        pitch: 1,
        rate: 0.95,
        useApplicationAudioSession: false,
      },
    );
  }, [selectedVoice?.identifier]);

  return {
    hydrated,
    preferences,
    voices,
    selectedVoice,
    masterEnabled: preferences.guidanceEnabled || preferences.alertsEnabled,
    enqueue,
    stop,
    clearSessionDedupe,
    toggleMaster,
    updatePreferences,
    previewVoice,
    refresh,
  };
}
