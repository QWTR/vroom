import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Modal, TouchableOpacity, Pressable, Dimensions, StyleSheet, ActivityIndicator } from 'react-native';
import { AppText as Text } from '../ui/AppText';
import { Audio, type AVPlaybackStatus } from 'expo-av';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import {
  clampTrimStartMs,
  effectiveTrimSelectionMs,
  isFullTrackSource,
  previewSourceHint,
  trimAudioDurationMs,
  type MusicTrimSource,
} from '../../utils/musicPreviewLimits';

const { width: SCREEN_W } = Dimensions.get('window');
const BAR_W = 3;
const BAR_GAP = 2;
const BAR_COUNT = 80;
const WAVEFORM_W = BAR_COUNT * (BAR_W + BAR_GAP);
const PREVIEW_DEBOUNCE_MS = 140;

function formatClock(ms: number) {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

function formatSelSec(ms: number) {
  const sec = Math.max(1, Math.round(ms / 1000));
  return `${sec} sek.`;
}

function seedBars(seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  const bars: number[] = [];
  for (let i = 0; i < BAR_COUNT; i++) {
    h = (h * 1664525 + 1013904223 + i) >>> 0;
    bars.push(0.15 + ((h % 1000) / 1000) * 0.85);
  }
  return bars;
}

export function MusicTrimSheet({
  visible,
  title,
  trackLabel,
  audioUrl,
  resolveAudioUrl,
  sourceType,
  startMs,
  trackDurationMs,
  fullSongDurationMs,
  selectionDurationMs,
  clipDurationMs,
  accent = '#e33835',
  onCancel,
  onConfirm,
  onPreviewChange,
}: {
  visible: boolean;
  title?: string;
  trackLabel?: string;
  audioUrl?: string | null;
  resolveAudioUrl?: () => Promise<string | null>;
  sourceType?: MusicTrimSource | null;
  startMs: number;
  trackDurationMs: number;
  fullSongDurationMs?: number | null;
  selectionDurationMs: number;
  /** Długość vroomki (np. 30 s) — do etykiety gdy różni się od zaznaczenia w podglądzie. */
  clipDurationMs?: number | null;
  accent?: string;
  onCancel: () => void;
  onConfirm: (startMs: number) => void;
  onPreviewChange?: (startMs: number) => void;
}) {
  const declaredAudioMs = trimAudioDurationMs(sourceType, trackDurationMs);
  const [loadedDurationMs, setLoadedDurationMs] = useState<number | null>(null);

  const safeTrackMs = Math.max(1000, loadedDurationMs ?? declaredAudioMs);
  const safeSelMs = effectiveTrimSelectionMs(sourceType, selectionDurationMs, safeTrackMs);
  const maxStartMs = Math.max(0, safeTrackMs - safeSelMs);

  const viewportW = Math.min(SCREEN_W - 40, 360);
  const selWidth = Math.max(56, (safeSelMs / safeTrackMs) * viewportW);
  const selLeft = (viewportW - selWidth) / 2;
  const travelPx = Math.max(1, (maxStartMs / safeTrackMs) * WAVEFORM_W);

  const [localStart, setLocalStart] = useState(startMs);
  const [playing, setPlaying] = useState(false);
  const [loadingAudio, setLoadingAudio] = useState(false);
  const [audioError, setAudioError] = useState(false);
  const [resolvedUrl, setResolvedUrl] = useState<string | null>(null);

  const localStartRef = useRef(localStart);
  const safeSelMsRef = useRef(safeSelMs);
  const safeTrackMsRef = useRef(safeTrackMs);
  const travelPxRef = useRef(travelPx);
  const maxStartMsRef = useRef(maxStartMs);
  const onPreviewRef = useRef(onPreviewChange);
  const resolveAudioUrlRef = useRef(resolveAudioUrl);
  const soundRef = useRef<Audio.Sound | null>(null);
  const dragOriginMs = useRef(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadGenRef = useRef(0);
  const wasVisibleRef = useRef(false);
  const schedulePreviewRef = useRef<(ms: number, immediate?: boolean) => void>(() => {});

  localStartRef.current = localStart;
  safeSelMsRef.current = safeSelMs;
  safeTrackMsRef.current = safeTrackMs;
  travelPxRef.current = travelPx;
  maxStartMsRef.current = maxStartMs;
  onPreviewRef.current = onPreviewChange;
  resolveAudioUrlRef.current = resolveAudioUrl;

  const bars = useMemo(() => seedBars(`${title ?? ''}-${trackLabel ?? ''}-${audioUrl ?? ''}`), [title, trackLabel, audioUrl]);
  const translateX = selLeft - (localStart / safeTrackMs) * WAVEFORM_W;
  const showFullSongNote = !isFullTrackSource(sourceType) && (fullSongDurationMs ?? trackDurationMs) > safeTrackMs + 500;
  const showClipNote = !!clipDurationMs && clipDurationMs > safeSelMs + 500;

  const stopPlayer = useCallback(async () => {
    const player = soundRef.current;
    if (!player) return;
    try {
      await player.stopAsync();
    } catch {
      /* ignore */
    }
    setPlaying(false);
  }, []);

  const unloadPlayer = useCallback(async () => {
    const player = soundRef.current;
    soundRef.current = null;
    if (!player) return;
    try {
      await player.stopAsync();
    } catch {}
    try {
      await player.unloadAsync();
    } catch {}
    setPlaying(false);
  }, []);

  const playFrom = useCallback(async (ms: number) => {
    const player = soundRef.current;
    if (!player) return;

    let cap = maxStartMsRef.current;
    try {
      const st = await player.getStatusAsync();
      if (st.isLoaded && st.durationMillis) {
        cap = Math.max(0, st.durationMillis - safeSelMsRef.current);
      }
    } catch {
      /* ignore */
    }

    const pos = clampTrimStartMs(ms, cap + safeSelMsRef.current, safeSelMsRef.current);
    try {
      await player.setPositionAsync(pos);
      await player.playAsync();
      setPlaying(true);
      setAudioError(false);
    } catch {
      setAudioError(true);
      setPlaying(false);
    }
  }, []);

  const handleStatus = useCallback((player: Audio.Sound) => (status: AVPlaybackStatus) => {
    if (!status.isLoaded) return;
    setPlaying(status.isPlaying);
    const pos = status.positionMillis ?? 0;
    const end = Math.min(
      localStartRef.current + safeSelMsRef.current,
      status.durationMillis ?? localStartRef.current + safeSelMsRef.current,
    );
    if (pos >= end - 80) {
      void player.setPositionAsync(localStartRef.current).then(() => player.playAsync()).catch(() => {});
    }
  }, []);

  useEffect(() => {
    if (!visible) {
      wasVisibleRef.current = false;
      setResolvedUrl(null);
      setLoadedDurationMs(null);
      return;
    }

    if (!wasVisibleRef.current) {
      wasVisibleRef.current = true;
      const clamped = clampTrimStartMs(startMs, declaredAudioMs, safeSelMs);
      setLocalStart(clamped);
      localStartRef.current = clamped;
      setAudioError(false);
    }
  }, [visible, startMs, declaredAudioMs, safeSelMs]);

  useEffect(() => {
    if (!visible) return undefined;

    let cancelled = false;
    setLoadingAudio(true);

    (async () => {
      let url = audioUrl ?? null;
      if (resolveAudioUrlRef.current) {
        try {
          const fresh = await resolveAudioUrlRef.current();
          if (fresh) url = fresh;
        } catch {
          /* fallback */
        }
      }
      if (cancelled) return;
      if (!url) {
        setResolvedUrl(null);
        setLoadingAudio(false);
        setAudioError(true);
        return;
      }
      setResolvedUrl(url);
    })();

    return () => {
      cancelled = true;
    };
  }, [visible, audioUrl]);

  useEffect(() => {
    if (!visible || !loadedDurationMs) return;
    const clamped = clampTrimStartMs(localStartRef.current, loadedDurationMs, safeSelMs);
    if (clamped !== localStartRef.current) {
      localStartRef.current = clamped;
      setLocalStart(clamped);
      void playFrom(clamped);
    }
  }, [visible, loadedDurationMs, safeSelMs, playFrom]);

  useEffect(() => {
    if (!visible || !resolvedUrl) {
      if (!visible) void unloadPlayer();
      return undefined;
    }

    let cancelled = false;
    const gen = ++loadGenRef.current;
    setLoadingAudio(true);
    setAudioError(false);

    const loadPlayer = async (uri: string) => {
      await unloadPlayer();
      await Audio.setAudioModeAsync({
        playsInSilentModeIOS: true,
        staysActiveInBackground: false,
        shouldDuckAndroid: true,
      });

      const initialPos = clampTrimStartMs(localStartRef.current, declaredAudioMs, safeSelMsRef.current);
      const { sound: player } = await Audio.Sound.createAsync(
        { uri },
        { shouldPlay: false, isLooping: false, positionMillis: initialPos },
      );
      if (cancelled || gen !== loadGenRef.current) {
        await player.unloadAsync().catch(() => {});
        return;
      }

      const st = await player.getStatusAsync();
      if (st.isLoaded && st.durationMillis) {
        setLoadedDurationMs(st.durationMillis);
        const clamped = clampTrimStartMs(localStartRef.current, st.durationMillis, safeSelMsRef.current);
        localStartRef.current = clamped;
        setLocalStart(clamped);
        if (clamped !== initialPos) {
          await player.setPositionAsync(clamped);
        }
      }

      player.setOnPlaybackStatusUpdate(handleStatus(player));
      soundRef.current = player;
      setLoadingAudio(false);
      setAudioError(false);
      await playFrom(localStartRef.current);
    };

    (async () => {
      try {
        await loadPlayer(resolvedUrl);
      } catch {
        if (cancelled) return;
        if (resolveAudioUrlRef.current) {
          try {
            const fresh = await resolveAudioUrlRef.current();
            if (fresh && fresh !== resolvedUrl) {
              setResolvedUrl(fresh);
              return;
            }
          } catch {
            /* ignore */
          }
        }
        setLoadingAudio(false);
        setAudioError(true);
      }
    })();

    return () => {
      cancelled = true;
      void unloadPlayer();
    };
  }, [visible, resolvedUrl, handleStatus, playFrom, unloadPlayer, declaredAudioMs]);

  const schedulePreview = useCallback((ms: number, immediate = false) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const run = () => {
      const clamped = clampTrimStartMs(ms, safeTrackMsRef.current, safeSelMsRef.current);
      localStartRef.current = clamped;
      setLocalStart(clamped);
      onPreviewRef.current?.(clamped);
      void playFrom(clamped);
    };
    if (immediate) {
      run();
      return;
    }
    debounceRef.current = setTimeout(run, PREVIEW_DEBOUNCE_MS);
  }, [playFrom]);

  schedulePreviewRef.current = schedulePreview;

  useEffect(() => () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
  }, []);

  const applyDrag = useCallback((translationX: number, immediate: boolean) => {
    const deltaMs = -(translationX / travelPxRef.current) * maxStartMsRef.current;
    const next = clampTrimStartMs(
      dragOriginMs.current + deltaMs,
      safeTrackMsRef.current,
      safeSelMsRef.current,
    );
    localStartRef.current = next;
    setLocalStart(next);
    schedulePreviewRef.current(next, immediate);
  }, []);

  const panGesture = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetX([-4, 4])
        .failOffsetY([-20, 20])
        .onBegin(() => {
          dragOriginMs.current = localStartRef.current;
        })
        .onUpdate((e) => {
          runOnJS(applyDrag)(e.translationX, false);
        })
        .onEnd((e) => {
          runOnJS(applyDrag)(e.translationX, true);
        }),
    [applyDrag],
  );

  const togglePlay = () => {
    const player = soundRef.current;
    if (!player) return;
    void (async () => {
      try {
        const st = await player.getStatusAsync();
        if (!st.isLoaded) return;
        if (st.isPlaying) {
          await player.pauseAsync();
          setPlaying(false);
        } else {
          await playFrom(localStartRef.current);
        }
      } catch {
        setAudioError(true);
      }
    })();
  };

  const handleCancel = () => {
    void stopPlayer();
    onCancel();
  };

  const handleConfirm = () => {
    void stopPlayer();
    onConfirm(localStartRef.current);
  };

  const selectionLabel = showClipNote
    ? `Klip ${formatSelSec(clipDurationMs!)} · fragment ${formatSelSec(safeSelMs)}`
    : `Wybrano ${formatSelSec(safeSelMs)}`;

  return (
    <Modal visible={visible} animationType="slide" transparent statusBarTranslucent onRequestClose={handleCancel}>
      <GestureHandlerRootView style={styles.backdropRoot}>
        <Pressable style={styles.backdrop} onPress={handleCancel}>
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
            {!!title && <Text style={styles.trackTitle} numberOfLines={1}>{title}</Text>}
            {!!trackLabel && <Text style={styles.trackArtist} numberOfLines={1}>{trackLabel}</Text>}

            <View style={styles.metaRow}>
              <Text style={[styles.metaLabel, { color: accent }]}>{selectionLabel}</Text>
              <Text style={styles.metaTime}>{formatClock(localStart)} / {formatClock(safeTrackMs)}</Text>
            </View>
            {showFullSongNote && (
              <Text style={styles.fullSongNote}>
                Utwór w serwisie: {formatClock(fullSongDurationMs ?? trackDurationMs)} · dostępny podgląd: {formatClock(safeTrackMs)}
              </Text>
            )}

            <TouchableOpacity
              onPress={togglePlay}
              disabled={!resolvedUrl || loadingAudio}
              activeOpacity={0.85}
              style={[styles.playRow, { borderColor: `${accent}55` }]}
            >
              {loadingAudio ? (
                <ActivityIndicator color={accent} size="small" />
              ) : (
                <MaterialIcons name={playing ? 'pause-circle-filled' : 'play-circle-filled'} size={28} color={accent} />
              )}
              <Text style={[styles.playLabel, { color: accent }]}>
                {loadingAudio
                  ? 'Ładowanie podglądu…'
                  : audioError
                    ? 'Błąd odtwarzania — przesuń falę na początek'
                    : playing
                      ? 'Gra podgląd…'
                      : 'Odtwórz podgląd'}
              </Text>
            </TouchableOpacity>

            <View style={[styles.viewport, { width: viewportW }]}>
              <View
                pointerEvents="none"
                style={[styles.selectionBox, { left: selLeft, width: selWidth, borderColor: accent }]}
              />
              <GestureDetector gesture={panGesture}>
                <View style={{ width: viewportW, height: 72 }}>
                  <View
                    style={{
                      flexDirection: 'row',
                      width: WAVEFORM_W,
                      height: 56,
                      alignItems: 'center',
                      transform: [{ translateX }],
                      marginTop: 8,
                    }}
                  >
                    {bars.map((h, i) => {
                      const barMs = (i / BAR_COUNT) * safeTrackMs;
                      const inSelection = barMs >= localStart && barMs <= localStart + safeSelMs;
                      return (
                        <View
                          key={i}
                          style={{
                            width: BAR_W,
                            height: 8 + h * 44,
                            marginRight: BAR_GAP,
                            borderRadius: 2,
                            backgroundColor: inSelection ? accent : 'rgba(255,255,255,0.32)',
                          }}
                        />
                      );
                    })}
                  </View>
                </View>
              </GestureDetector>
            </View>

            <Text style={styles.hint}>
              {maxStartMs < 500 && !isFullTrackSource(sourceType)
                ? 'Deezer ma tylko ~30 s podglądu. Pełna nuta i przewijanie po całym utworze: wybierz utwór z Audius.'
                : previewSourceHint(sourceType)}
            </Text>

            <View style={styles.actions}>
              <TouchableOpacity onPress={handleCancel} style={styles.cancelBtn} activeOpacity={0.8}>
                <Text style={styles.cancelText}>Anuluj</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={handleConfirm} style={[styles.doneBtn, { backgroundColor: accent }]} activeOpacity={0.85}>
                <Text style={styles.doneText}>Gotowe</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdropRoot: { flex: 1 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.82)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: '#141414',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 28,
  },
  trackTitle: { fontFamily: 'Manrope_600SemiBold', color: '#fff', fontSize: 13, fontWeight: '700', marginBottom: 4 },
  trackArtist: { color: '#ffffff99', fontSize: 12, marginBottom: 12 },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  metaLabel: { fontFamily: 'Manrope_600SemiBold', fontSize: 12, fontWeight: '700', flex: 1, marginRight: 8 },
  metaTime: { fontFamily: 'Manrope_600SemiBold', fontSize: 12, color: '#ffffffaa' },
  fullSongNote: {
    color: '#ffffff88',
    fontSize: 12,
    marginBottom: 10,
    lineHeight: 16,
    fontFamily: 'Manrope_600SemiBold',
  },
  playRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    backgroundColor: 'rgba(255,255,255,0.04)',
    marginBottom: 12,
  },
  playLabel: { fontFamily: 'Manrope_600SemiBold', fontSize: 12, fontWeight: '700', flex: 1 },
  viewport: { height: 80, alignSelf: 'center', justifyContent: 'center' },
  selectionBox: {
    position: 'absolute',
    top: 6,
    bottom: 6,
    borderWidth: 2,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.05)',
    zIndex: 2,
  },
  hint: { color: '#ffffff88', fontSize: 12, textAlign: 'center', marginTop: 10, marginBottom: 16, lineHeight: 16 },
  actions: { flexDirection: 'row', gap: 12 },
  cancelBtn: { flex: 1, paddingVertical: 14, alignItems: 'center', borderRadius: 14, backgroundColor: '#ffffff12' },
  cancelText: { fontFamily: 'Manrope_600SemiBold', color: '#fff', fontSize: 12 },
  doneBtn: { flex: 1, paddingVertical: 14, alignItems: 'center', borderRadius: 14 },
  doneText: { fontFamily: 'Manrope_600SemiBold', color: '#fff', fontSize: 12, fontWeight: '800' },
});
