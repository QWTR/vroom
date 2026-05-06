import React, { useCallback, useEffect, useState } from 'react';
import { View, TouchableOpacity, Image, ActivityIndicator, Linking } from 'react-native';
import { Text } from 'react-native';
import { Audio } from 'expo-av';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import type { SpotifyProfileTrack } from '../../constants/profile';

type ThemeBits = {
  text: string;
  textDim: string;
  surface: string;
};

type Props = {
  track: SpotifyProfileTrack;
  theme: ThemeBits;
  /** Spotify section label (e.g. "SPOTIFY W PROFILU") */
  label?: string;
  /**
   * Gdy true (np. publiczny profil) — po wejściu automatycznie odtwarzany jest podgląd (~30 s).
   * Na własnym profilu zostaw false / nie ustawiaj — żeby nie grało przy każdym otwarciu „konto”.
   */
  autoplayOnVisit?: boolean;
};

export function SpotifyProfileTrackRow({
  track,
  theme,
  label = 'SPOTIFY W PROFILU',
  autoplayOnVisit = false,
}: Props) {
  const [sound, setSound] = useState<Audio.Sound | null>(null);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    return () => {
      sound?.unloadAsync().catch(() => {});
    };
  }, [sound]);

  /** Autoodtwarzanie dla gości (publiczny profil). */
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
        /* brak autoodtwarzenia — użytkownik może nacisnąć play */
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
        marginBottom: 20,
        backgroundColor: theme.surface,
        borderRadius: 16,
        padding: 14,
        borderWidth: 1,
        borderColor: '#1DB95455',
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
          borderRadius: 10,
          backgroundColor: '#1DB95422',
          borderWidth: 1,
          borderColor: '#1DB95455',
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
        <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: '#1DB954', letterSpacing: 2, marginBottom: 4 }}>
          {label}
        </Text>
        <Text style={{ fontFamily: 'Orbitron', fontSize: 10, color: theme.text, fontWeight: '700' }} numberOfLines={1}>
          {track.trackName}
        </Text>
        {!!track.artistName && (
          <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: theme.textDim, marginTop: 3 }} numberOfLines={1}>
            {track.artistName}
          </Text>
        )}
        {hasPreview ? (
          <Text style={{ fontFamily: 'Orbitron', fontSize: 7, color: theme.textDim, marginTop: 5, opacity: 0.85 }}>
            {autoplayOnVisit
              ? 'Podgląd ~30 s · start dla gości · dotknij pause/play'
              : 'Podgląd ~30 s · dotknij aby odtworzyć'}
          </Text>
        ) : (
          <Text style={{ fontFamily: 'Orbitron', fontSize: 7, color: theme.textDim, marginTop: 5, opacity: 0.85 }}>
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
