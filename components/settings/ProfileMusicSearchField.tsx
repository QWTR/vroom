import React, { memo, useCallback, useEffect, useState } from 'react';
import { View, TouchableOpacity, Image, ActivityIndicator, ScrollView, StyleSheet, Platform } from 'react-native';
import { AppText as Text, AppTextInput as TextInput } from '../ui/AppText';
import AsyncStorage from '@react-native-async-storage/async-storage';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import Toast from 'react-native-toast-message';
import type { ProfileMusicSource, SpotifyProfileTrack } from '../../constants/profile';

const SEARCH_DEBOUNCE_MS = 280;

const SOURCE_META: Record<ProfileMusicSource, { label: string; color: string; icon: string }> = {
  deezer: { label: 'Deezer', color: '#A238FF', icon: 'music-circle' },
  itunes: { label: 'Apple Music', color: '#FA243C', icon: 'apple' },
  spotify: { label: 'Spotify', color: '#1DB954', icon: 'spotify' },
  audius: { label: 'Audius', color: '#CC0FE0', icon: 'waveform' },
};

async function readAuthToken(): Promise<string | null> {
  return (await AsyncStorage.getItem('userToken')) ?? (await AsyncStorage.getItem('token'));
}

export type ProfileMusicSearchFieldProps = {
  apiUrl: string;
  onPickTrack: (sourceType: ProfileMusicSource, trackId: string) => Promise<boolean>;
  saving: boolean;
  textMain: string;
  textDim: string;
  inputBg: string;
  inputBorder: string;
  rowAlt: string;
};

export const ProfileMusicSearchField = memo(function ProfileMusicSearchField({
  apiUrl,
  onPickTrack,
  saving,
  textMain,
  textDim,
  inputBg,
  inputBorder,
  rowAlt,
}: ProfileMusicSearchFieldProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SpotifyProfileTrack[]>([]);
  const [loading, setLoading] = useState(false);
  const [resolvedFor, setResolvedFor] = useState('');

  const runSearch = useCallback(
    async (q: string, signal: AbortSignal) => {
      const token = await readAuthToken();
      if (!token || signal.aborted) return;
      const res = await fetch(
        `${apiUrl}/api/settings/music-search?q=${encodeURIComponent(q)}`,
        { headers: { Authorization: `Bearer ${token}` }, signal },
      );
      const json = await res.json().catch(() => ({}));
      if (signal.aborted) return;
      if (!res.ok) {
        setResults([]);
        setResolvedFor(q);
        Toast.show({
          type: 'error',
          text1: 'Muzyka',
          text2: typeof json?.error === 'string' ? json.error : 'Błąd wyszukiwania',
        });
        return;
      }
      setResults(Array.isArray(json.tracks) ? json.tracks : []);
      setResolvedFor(q);
    },
    [apiUrl],
  );

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults((prev) => (prev.length === 0 ? prev : []));
      setLoading(false);
      setResolvedFor('');
      return;
    }
    const ac = new AbortController();
    const timer = setTimeout(() => {
      setLoading(true);
      runSearch(q, ac.signal)
        .catch(() => {
          if (ac.signal.aborted) return;
          setResults([]);
          setResolvedFor(q);
          Toast.show({ type: 'error', text1: 'Muzyka', text2: 'Brak połączenia' });
        })
        .finally(() => {
          setLoading(false);
        });
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      ac.abort();
    };
  }, [query, runSearch]);

  const onRowPress = useCallback(
    async (sourceType: ProfileMusicSource, trackId: string) => {
      if (saving) return;
      const ok = await onPickTrack(sourceType, trackId);
      if (ok) {
        setQuery('');
        setResults([]);
        setResolvedFor('');
      }
    },
    [onPickTrack, saving],
  );

  return (
    <View style={styles.wrap}>
      <Text style={[styles.hint, { color: textDim }]}>
        Szukaj na Deezer, Apple Music PL, Audius i Spotify. Dotknij wynik z podglądem audio.
      </Text>

      <View style={[styles.inputShell, { backgroundColor: inputBg, borderColor: inputBorder }]}>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Szukaj utworu…"
          placeholderTextColor={textDim}
          autoCapitalize="none"
          autoCorrect={false}
          blurOnSubmit={false}
          returnKeyType="search"
          importantForAutofill="no"
          showSoftInputOnFocus
          style={[styles.input, { color: textMain }]}
          underlineColorAndroid="transparent"
        />
        <View style={styles.inputSpinner} pointerEvents="none">
          {loading ? <ActivityIndicator size="small" color="#A238FF" /> : null}
        </View>
      </View>

      {!loading && query.trim().length >= 1 && query.trim() === resolvedFor && results.length === 0 ? (
        <Text style={[styles.empty, { color: textDim }]}>Brak wyników z podglądem — spróbuj innej frazy.</Text>
      ) : null}

      {results.length > 0 ? (
        <View style={[styles.listOuter, { borderColor: inputBorder, backgroundColor: rowAlt }]}>
          <ScrollView
            nestedScrollEnabled
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="none"
            style={styles.listScroll}
            showsVerticalScrollIndicator={false}
          >
            {results.map((t, idx) => {
              const source = (t.sourceType ?? 'spotify') as ProfileMusicSource;
              const meta = SOURCE_META[source] ?? SOURCE_META.spotify;
              return (
                <TouchableOpacity
                  key={`${source}:${t.trackId}`}
                  onPress={() => onRowPress(source, t.trackId)}
                  disabled={saving}
                  activeOpacity={0.75}
                  style={[
                    styles.row,
                    idx === results.length - 1 ? styles.rowLast : null,
                    { borderBottomColor: inputBorder, opacity: saving ? 0.55 : 1 },
                  ]}>
                  <View style={[styles.thumbWrap, { borderColor: `${meta.color}44`, backgroundColor: `${meta.color}22` }]}>
                    {t.thumbnailUrl ? (
                      <Image source={{ uri: t.thumbnailUrl }} style={styles.thumb} />
                    ) : (
                      <View style={styles.thumbPlaceholder}>
                        <MaterialCommunityIcons name={meta.icon as any} size={18} color={meta.color} />
                      </View>
                    )}
                  </View>
                  <View style={styles.rowText}>
                    <Text style={[styles.sourceBadge, { color: meta.color }]}>{meta.label.toUpperCase()}</Text>
                    <Text style={[styles.trackTitle, { color: textMain }]} numberOfLines={2}>
                      {t.trackName}
                    </Text>
                    {!!t.artistName && (
                      <Text style={[styles.artist, { color: textDim }]} numberOfLines={1}>
                        {t.artistName}
                      </Text>
                    )}
                    <Text style={[styles.previewOk, { color: meta.color }]}>Podgląd w profilu</Text>
                  </View>
                  <MaterialIcons name="add-circle-outline" size={22} color={meta.color} />
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: { gap: 10 },
  hint: { fontFamily: 'Manrope_600SemiBold', fontSize: 12, lineHeight: 16 },
  inputShell: {
    minHeight: 46,
    borderRadius: 10,
    borderWidth: 1,
    justifyContent: 'center',
    paddingRight: 40,
  },
  input: {
    fontFamily: 'Manrope_600SemiBold',
    fontSize: 12,
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === 'ios' ? 12 : 10,
  },
  inputSpinner: {
    position: 'absolute',
    right: 10,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    width: 28,
  },
  empty: { fontFamily: 'Manrope_600SemiBold', fontSize: 12 },
  listOuter: {
    maxHeight: 280,
    borderRadius: 10,
    borderWidth: 1,
    overflow: 'hidden',
  },
  listScroll: { maxHeight: 280 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  rowLast: { borderBottomWidth: 0 },
  thumbWrap: {
    width: 40,
    height: 40,
    borderRadius: 8,
    overflow: 'hidden',
    borderWidth: 1,
  },
  thumb: { width: 40, height: 40 },
  thumbPlaceholder: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  rowText: { flex: 1 },
  sourceBadge: { fontFamily: 'Manrope_600SemiBold', fontSize: 12, letterSpacing: 1, marginBottom: 3 },
  trackTitle: { fontFamily: 'Manrope_600SemiBold', fontSize: 12, fontWeight: '600' },
  artist: { fontFamily: 'Manrope_600SemiBold', fontSize: 12, marginTop: 3 },
  previewOk: { fontFamily: 'Manrope_600SemiBold', fontSize: 12, marginTop: 4 },
});
