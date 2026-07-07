import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, TouchableOpacity, Image, ActivityIndicator, Linking } from 'react-native';
import { Text } from 'react-native';
import { Audio } from 'expo-av';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import type { ProfileMusicSource, SpotifyProfileTrack } from '../../constants/profile';
import { GLASS_BORDER } from './profileCardTheme';

type ThemeBits = {
  text: string;
  textDim: string;
  surface: string;
  border?: string;
};

const SOURCE_META: Record<ProfileMusicSource, { label: string; color: string; icon: string }> = {
  deezer: { label: 'DEEZER', color: '#A238FF', icon: 'music-circle' },
  itunes: { label: 'APPLE MUSIC', color: '#FA243C', icon: 'apple' },
  spotify: { label: 'SPOTIFY', color: '#1DB954', icon: 'spotify' },
  audius: { label: 'AUDIUS', color: '#CC0FE0', icon: 'waveform' },
};

type Props = {
  track: SpotifyProfileTrack;
  theme: ThemeBits;
  label?: string;
  autoplayOnVisit?: boolean;
  visitorMuted?: boolean;
  showVisitorMuteBar?: boolean;
  onVisitorMute?: () => void;
  embedded?: boolean;
};

export function SpotifyProfileTrackRow({
  track,
  theme,
  label,
  autoplayOnVisit = false,
  visitorMuted = false,
  showVisitorMuteBar = false,
  onVisitorMute,
  embedded = false,
}: Props) {
  const source = (track.sourceType ?? 'spotify') as ProfileMusicSource;
  const meta = SOURCE_META[source] ?? SOURCE_META.spotify;
  const accent = meta.color;
  const displayLabel = label ?? meta.label;

  const [sound, setSound] = useState<Audio.Sound | null>(null);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);

  const effectiveAutoplay = autoplayOnVisit && !visitorMuted;

  const stopSound = useCallback(async () => {
    if (!sound) return;
    try {
      await sound.stopAsync();
      await sound.unloadAsync();
    } catch {
      /* ignore */
    }
    setSound(null);
    setPlaying(false);
  }, [sound]);

  useEffect(() => {
    return () => {
      sound?.unloadAsync().catch(() => {});
    };
  }, [sound]);

  useEffect(() => {
    if (visitorMuted) {
      stopSound().catch(() => {});
    }
  }, [visitorMuted, stopSound]);

  useEffect(() => {
    if (!effectiveAutoplay || !track.previewUrl) return;
    let cancelled = false;
    let created: Audio.Sound | null = null;
    (async () => {
      try {
        await Audio.setAudioModeAsync({
          playsInSilentModeIOS: true,
          staysActiveInBackground: false,
        });
        const { sound: s } = await Audio.Sound.createAsync(
          { uri: track.previewUrl! },
          { shouldPlay: true, isLooping: source === 'audius' },
          (st) => {
            if (!st.isLoaded) return;
            if (st.didJustFinish && source !== 'audius') setPlaying(false);
          },
        );
        if (cancelled) {
          await s.unloadAsync().catch(() => {});
          return;
        }
        created = s;
        setSound(s);
        setPlaying(true);
      } catch {
        /* brak autoodtwarzenia */
      }
    })();
    return () => {
      cancelled = true;
      if (created) {
        created.unloadAsync().catch(() => {});
        setSound((prev) => (prev === created ? null : prev));
      }
    };
  }, [effectiveAutoplay, track.previewUrl, track.trackId, source]);

  const openExternal = useCallback(() => {
    if (track.url) Linking.openURL(track.url).catch(() => {});
  }, [track.url]);

  const togglePreview = useCallback(async () => {
    const uri = track.previewUrl;
    if (!uri) {
      openExternal();
      return;
    }
    try {
      await Audio.setAudioModeAsync({
        playsInSilentModeIOS: true,
        staysActiveInBackground: false,
      });
    } catch {
      /* ignore */
    }

    if (sound) {
      try {
        const st = await sound.getStatusAsync();
        if (st.isLoaded) {
          if (st.isPlaying) {
            await sound.pauseAsync();
            setPlaying(false);
          } else {
            await sound.playAsync();
            setPlaying(true);
          }
          return;
        }
        await sound.unloadAsync();
        setSound(null);
      } catch {
        try {
          await sound.unloadAsync();
        } catch {
          /* ignore */
        }
        setSound(null);
      }
    }

    setLoading(true);
    try {
      const { sound: s } = await Audio.Sound.createAsync(
        { uri },
        { shouldPlay: true, isLooping: source === 'audius' },
        (st) => {
          if (!st.isLoaded) return;
          if (st.didJustFinish && source !== 'audius') setPlaying(false);
        },
      );
      setSound(s);
      setPlaying(true);
    } catch {
      openExternal();
    } finally {
      setLoading(false);
    }
  }, [sound, track.previewUrl, openExternal, source]);

  const handleVisitorMute = useCallback(() => {
    stopSound().catch(() => {});
    onVisitorMute?.();
  }, [stopSound, onVisitorMute]);

  const hasPreview = !!track.previewUrl;
  const showMuteBar = showVisitorMuteBar && effectiveAutoplay && hasPreview && !visitorMuted;

  const openHint = useMemo(() => {
    switch (source) {
      case 'deezer': return 'Brak podglądu · otwórz w Deezer';
      case 'itunes': return 'Brak podglądu · otwórz w Apple Music';
      case 'audius': return 'Brak podglądu · otwórz w Audius';
      default: return 'Brak podglądu · otwórz w Spotify';
    }
  }, [source]);

  return (
    <View style={{ marginBottom: embedded ? 0 : 16, marginTop: embedded ? 12 : 0 }}>
      {showMuteBar && (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 10,
            marginBottom: 8,
            paddingHorizontal: 12,
            paddingVertical: 10,
            borderRadius: 12,
            backgroundColor: `${accent}22`,
            borderWidth: 1,
            borderColor: `${accent}55`,
          }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
            <MaterialIcons name="volume-up" size={18} color={accent} />
            <Text style={{ fontFamily: 'Orbitron', fontSize: 9, color: theme.text, flex: 1 }}>
              Gra muzyka profilu
            </Text>
          </View>
          <TouchableOpacity
            onPress={handleVisitorMute}
            activeOpacity={0.8}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 4,
              paddingHorizontal: 10,
              paddingVertical: 6,
              borderRadius: 8,
              backgroundColor: 'rgba(0,0,0,0.35)',
            }}>
            <MaterialIcons name="volume-off" size={16} color="#fff" />
            <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: '#fff' }}>WYCISZ</Text>
          </TouchableOpacity>
        </View>
      )}

      <View
        style={{
          backgroundColor: embedded ? 'rgba(255,255,255,0.05)' : theme.surface,
          borderRadius: embedded ? 16 : 20,
          padding: embedded ? 12 : 16,
          borderWidth: 1,
          borderColor: embedded ? GLASS_BORDER : (theme.border ?? theme.textDim),
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
        }}>
        <TouchableOpacity
          onPress={togglePreview}
          activeOpacity={0.85}
          style={{
            width: 44,
            height: 44,
            borderRadius: 12,
            backgroundColor: 'rgba(255,255,255,0.06)',
            borderWidth: 1,
            borderColor: GLASS_BORDER,
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'hidden',
          }}>
          {track.thumbnailUrl ? (
            <Image source={{ uri: track.thumbnailUrl }} style={{ width: 44, height: 44 }} />
          ) : (
            <MaterialCommunityIcons name={meta.icon as any} size={22} color={accent} />
          )}
          {hasPreview && (
            <View
              style={{
                position: 'absolute',
                bottom: 2,
                right: 2,
                width: 18,
                height: 18,
                borderRadius: 9,
                backgroundColor: '#000c',
                alignItems: 'center',
                justifyContent: 'center',
              }}>
              {loading ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <MaterialIcons name={playing ? 'pause' : 'play-arrow'} size={14} color="#fff" />
              )}
            </View>
          )}
        </TouchableOpacity>
        <TouchableOpacity onPress={hasPreview ? togglePreview : openExternal} activeOpacity={0.85} style={{ flex: 1 }}>
          <Text style={{ fontFamily: 'Orbitron', fontSize: 10, color: accent, letterSpacing: 1.5, marginBottom: 4 }}>
            {displayLabel}
          </Text>
          <Text style={{ fontFamily: 'Orbitron', fontSize: 11, color: theme.text, fontWeight: '700' }} numberOfLines={1}>
            {track.trackName}
          </Text>
          {!!track.artistName && (
            <Text style={{ fontFamily: 'Orbitron', fontSize: 10, color: theme.textDim, letterSpacing: 1, marginTop: 3 }} numberOfLines={1}>
              {track.artistName}
            </Text>
          )}
          {hasPreview && (
            <View style={{ marginTop: 8, height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
              <View
                style={{
                  height: '100%',
                  width: playing ? '45%' : '0%',
                  backgroundColor: accent,
                  borderRadius: 2,
                }}
              />
            </View>
          )}
          {!hasPreview && (
            <Text style={{ fontFamily: 'Orbitron', fontSize: 10, color: theme.textDim, letterSpacing: 1, marginTop: 5, opacity: 0.85 }}>
              {openHint}
            </Text>
          )}
        </TouchableOpacity>
        <TouchableOpacity onPress={openExternal} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <MaterialIcons name="open-in-new" size={18} color={accent} />
        </TouchableOpacity>
      </View>
    </View>
  );
}
