import React, { useCallback, useEffect, useState } from 'react';
import { View, TouchableOpacity, Image, ActivityIndicator, Linking } from 'react-native';
import { Text } from 'react-native';
import { Audio } from 'expo-av';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import type { SpotifyProfileTrack } from '../../constants/profile';
import { GLASS_BORDER } from './profileCardTheme';

type ThemeBits = {
  text: string;
  textDim: string;
  surface: string;
  border?: string;
};

type Props = {
  track: SpotifyProfileTrack;
  theme: ThemeBits;
  label?: string;
  autoplayOnVisit?: boolean;
  /** Wewnątrz karty Bio — rozmyta pod-karta bez własnego cienia. */
  embedded?: boolean;
};

export function SpotifyProfileTrackRow({
  track,
  theme,
  label = 'SPOTIFY',
  autoplayOnVisit = false,
  embedded = false,
}: Props) {
  const [sound, setSound] = useState<Audio.Sound | null>(null);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    return () => {
      sound?.unloadAsync().catch(() => {});
    };
  }, [sound]);

  useEffect(() => {
    if (!autoplayOnVisit || !track.previewUrl) return;
    let cancelled = false;
    let created: Audio.Sound | null = null;
    (async () => {
      try {
        await Audio.setAudioModeAsync({
          playsInSilentModeIOS: true,
          staysActiveInBackground: false,
        });
        const { sound: s } = await Audio.Sound.createAsync(
          { uri: track.previewUrl },
          { shouldPlay: true },
          (st) => {
            if (!st.isLoaded) return;
            if (st.didJustFinish) setPlaying(false);
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
  }, [autoplayOnVisit, track.previewUrl, track.trackId]);

  const openSpotify = useCallback(() => {
    if (track.url) Linking.openURL(track.url).catch(() => {});
  }, [track.url]);

  const togglePreview = useCallback(async () => {
    const uri = track.previewUrl;
    if (!uri) {
      openSpotify();
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
        { shouldPlay: true },
        (st) => {
          if (!st.isLoaded) return;
          if (st.didJustFinish) setPlaying(false);
        },
      );
      setSound(s);
      setPlaying(true);
    } catch {
      openSpotify();
    } finally {
      setLoading(false);
    }
  }, [sound, track.previewUrl, openSpotify]);

  const hasPreview = !!track.previewUrl;

  return (
    <View
      style={{
        marginBottom: embedded ? 0 : 16,
        marginTop: embedded ? 12 : 0,
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
          <MaterialCommunityIcons name="spotify" size={22} color="#1DB954" />
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
      <TouchableOpacity onPress={hasPreview ? togglePreview : openSpotify} activeOpacity={0.85} style={{ flex: 1 }}>
        <Text style={{ fontFamily: 'Orbitron', fontSize: 10, color: '#1DB954', letterSpacing: 1.5, marginBottom: 4 }}>
          {label}
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
                backgroundColor: '#1DB954',
                borderRadius: 2,
              }}
            />
          </View>
        )}
        {!hasPreview && (
          <Text style={{ fontFamily: 'Orbitron', fontSize: 10, color: theme.textDim, letterSpacing: 1, marginTop: 5, opacity: 0.85 }}>
            Brak podglądu · otwórz w Spotify
          </Text>
        )}
      </TouchableOpacity>
      <TouchableOpacity onPress={openSpotify} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
        <MaterialIcons name="open-in-new" size={18} color="#1DB954" />
      </TouchableOpacity>
    </View>
  );
}
