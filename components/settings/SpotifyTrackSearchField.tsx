import React, { memo, useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Platform,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import Toast from 'react-native-toast-message';
import type { SpotifyProfileTrack } from '../../constants/profile';

const SEARCH_DEBOUNCE_MS = 280;

async function readAuthToken(): Promise<string | null> {
  return (await AsyncStorage.getItem('userToken')) ?? (await AsyncStorage.getItem('token'));
}

export type SpotifyTrackSearchFieldProps = {
  apiUrl: string;
  /** Zwróć true gdy utwór zapisany — komponent wyczyści pole i wyniki. */
  onPickTrack: (trackId: string) => Promise<boolean>;
  saving: boolean;
  textMain: string;
  textDim: string;
  inputBg: string;
  inputBorder: string;
  rowAlt: string;
};

/**
 * Wyszukiwanie Spotify w osobnym drzewie (memo), żeby rodzic (np. cały settings + ScrollView)
 * nie przeładowywał TextInput przy każdym fetchu — klawiatura zostaje, live search z debounce.
 */
export const SpotifyTrackSearchField = memo(function SpotifyTrackSearchField({
  apiUrl,
  onPickTrack,
  saving,
  textMain,
  textDim,
  inputBg,
  inputBorder,
  rowAlt,
}: SpotifyTrackSearchFieldProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SpotifyProfileTrack[]>([]);
  const [loading, setLoading] = useState(false);
  const [resolvedFor, setResolvedFor] = useState('');

  const runSearch = useCallback(
    async (q: string, signal: AbortSignal) => {
      const token = await readAuthToken();
      if (!token || signal.aborted) return;
      const res = await fetch(
        `${apiUrl}/api/settings/spotify-search?q=${encodeURIComponent(q)}`,
        { headers: { Authorization: `Bearer ${token}` }, signal },
      );
      const json = await res.json().catch(() => ({}));
      if (signal.aborted) return;
      if (!res.ok) {
        setResults([]);
        setResolvedFor(q);
        Toast.show({
          type: 'error',
          text1: 'Spotify',
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
          Toast.show({ type: 'error', text1: 'Spotify', text2: 'Brak połączenia' });
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
    async (trackId: string) => {
      if (saving) return;
      const ok = await onPickTrack(trackId);
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
        Pisz — wyszukiwanie odświeża się automatycznie. Dotknij wynik, aby ustawić w profilu.
      </Text>

      <View style={[styles.inputShell, { backgroundColor: inputBg, borderColor: inputBorder }]}>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Szukaj na Spotify…"
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
          {loading ? <ActivityIndicator size="small" color="#1DB954" /> : null}
        </View>
      </View>

      {!loading && query.trim().length >= 1 && query.trim() === resolvedFor && results.length === 0 ? (
        <Text style={[styles.empty, { color: textDim }]}>Brak wyników — spróbuj innej frazy.</Text>
      ) : null}

      {results.length > 0 ? (
        <View
          style={[
            styles.listOuter,
            { borderColor: inputBorder, backgroundColor: rowAlt },
          ]}>
          <ScrollView
            nestedScrollEnabled
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="none"
            style={styles.listScroll}
            showsVerticalScrollIndicator={false}
          >
            {results.map((t, idx) => (
              <TouchableOpacity
                key={t.trackId}
                onPress={() => onRowPress(t.trackId)}
                disabled={saving}
                activeOpacity={0.75}
                style={[
                  styles.row,
                  idx === results.length - 1 ? styles.rowLast : null,
                  { borderBottomColor: inputBorder, opacity: saving ? 0.55 : 1 },
                ]}>
                <View style={styles.thumbWrap}>
                  {t.thumbnailUrl ? (
                    <Image source={{ uri: t.thumbnailUrl }} style={styles.thumb} />
                  ) : (
                    <View style={styles.thumbPlaceholder}>
                      <MaterialCommunityIcons name="spotify" size={18} color="#1DB954" />
                    </View>
                  )}
                </View>
                <View style={styles.rowText}>
                  <Text style={[styles.trackTitle, { color: textMain }]} numberOfLines={2}>
                    {t.trackName}
                  </Text>
                  {!!t.artistName && (
                    <Text style={[styles.artist, { color: textDim }]} numberOfLines={1}>
                      {t.artistName}
                    </Text>
                  )}
                  {t.previewUrl ? (
                    <Text style={styles.previewOk}>Podgląd w profilu</Text>
                  ) : (
                    <Text style={[styles.previewNo, { color: textDim }]}>Bez podglądu audio</Text>
                  )}
                </View>
                <MaterialIcons name="add-circle-outline" size={22} color="#1DB954" />
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: { gap: 10 },
  hint: { fontFamily: 'Orbitron', fontSize: 8, lineHeight: 14 },
  inputShell: {
    minHeight: 46,
    borderRadius: 10,
    borderWidth: 1,
    justifyContent: 'center',
    paddingRight: 40,
  },
  input: {
    fontFamily: 'Orbitron',
    fontSize: 9,
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
  empty: { fontFamily: 'Orbitron', fontSize: 8 },
  listOuter: {
    maxHeight: 240,
    borderRadius: 10,
    borderWidth: 1,
    overflow: 'hidden',
  },
  listScroll: { maxHeight: 240 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  rowLast: {
    borderBottomWidth: 0,
  },
  thumbWrap: {
    width: 40,
    height: 40,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: '#1DB95422',
    borderWidth: 1,
    borderColor: '#1DB95444',
  },
  thumb: { width: 40, height: 40 },
  thumbPlaceholder: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  rowText: { flex: 1 },
  trackTitle: { fontFamily: 'Orbitron', fontSize: 9, fontWeight: '600' },
  artist: { fontFamily: 'Orbitron', fontSize: 8, marginTop: 3 },
  previewOk: { fontFamily: 'Orbitron', fontSize: 7, color: '#1DB954', marginTop: 4 },
  previewNo: { fontFamily: 'Orbitron', fontSize: 7, marginTop: 4, opacity: 0.85 },
});
