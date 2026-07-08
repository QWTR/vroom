import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  FlatList,
  Image,
  Keyboard,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useRouter } from 'expo-router';
import Toast from 'react-native-toast-message';
import { API_URL } from '../../../constants/config';
import { CommunityScreenHeader } from '../../../components/community';
import { useTheme } from '../../../contexts/ThemeContext';
import type { VroomkiPost } from '../community/communityShared';

const GRID_GAP = 1;
const { width: SCREEN_W } = Dimensions.get('window');
const getToken = () => AsyncStorage.getItem('token');

function formatCount(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (value >= 10_000) return `${Math.round(value / 1000)}k`;
  if (value >= 1000) return `${(value / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return String(value);
}

export default function VroomkiSearchScreen() {
  const { theme } = useTheme();
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [activeQuery, setActiveQuery] = useState('');
  const [results, setResults] = useState<VroomkiPost[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  const tileSize = useMemo(() => Math.floor((SCREEN_W - GRID_GAP * 2) / 3), []);

  const runSearch = useCallback(async () => {
    const q = query.trim();
    if (!q) {
      Toast.show({ type: 'info', text1: 'Wpisz frazę do wyszukania' });
      return;
    }
    Keyboard.dismiss();
    setLoading(true);
    setSearched(true);
    setActiveQuery(q);
    try {
      const token = await getToken();
      const res = await fetch(`${API_URL}/api/vroomki/search?q=${encodeURIComponent(q)}&limit=60`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('search failed');
      const json = await res.json();
      setResults(Array.isArray(json?.posts) ? json.posts : []);
    } catch {
      setResults([]);
      Toast.show({ type: 'error', text1: 'Błąd wyszukiwania VROOMKI' });
    } finally {
      setLoading(false);
    }
  }, [query]);

  const openPost = useCallback((postId: number) => {
    if (!activeQuery) return;
    router.push({
      pathname: '/Community/vroomki',
      params: { vroomkiId: String(postId), q: activeQuery },
    } as any);
  }, [activeQuery, router]);

  return (
    <View style={[styles.screen, { backgroundColor: theme.bg }]}>
      <CommunityScreenHeader title="SZUKAJ VROOMKI" breadcrumb="VROOMKI" />
      <View style={[styles.searchBar, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        <MaterialIcons name="search" size={22} color={theme.textDim} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Opis rolki lub nick użytkownika..."
          placeholderTextColor={theme.textDim}
          style={[styles.input, { color: theme.text }]}
          returnKeyType="search"
          onSubmitEditing={() => void runSearch()}
          autoCorrect={false}
          autoCapitalize="none"
        />
        {!!query.length && (
          <TouchableOpacity onPress={() => setQuery('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <MaterialIcons name="close" size={20} color={theme.textDim} />
          </TouchableOpacity>
        )}
        <TouchableOpacity style={styles.searchBtn} onPress={() => void runSearch()} disabled={loading}>
          <Text style={styles.searchBtnText}>Szukaj</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator color="#e33835" size="large" />
        </View>
      ) : (
        <FlatList
          data={results}
          numColumns={3}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={results.length ? styles.grid : styles.centered}
          ListHeaderComponent={
            searched && activeQuery ? (
              <Text style={[styles.resultHint, { color: theme.textDim }]}>
                Wyniki dla „{activeQuery}” ({results.length})
              </Text>
            ) : null
          }
          ListEmptyComponent={
            searched ? (
              <View style={styles.empty}>
                <MaterialCommunityIcons name="video-off-outline" size={42} color="#555" />
                <Text style={styles.emptyTitle}>Brak wyników</Text>
                <Text style={styles.emptyText}>Spróbuj innej frazy w opisie lub nicku</Text>
              </View>
            ) : (
              <View style={styles.empty}>
                <MaterialCommunityIcons name="magnify" size={42} color="#555" />
                <Text style={styles.emptyTitle}>Wyszukaj VROOMKI</Text>
                <Text style={styles.emptyText}>Wpisz dowolną frazę i kliknij Szukaj</Text>
              </View>
            )
          }
          renderItem={({ item }) => {
            const thumb = item.videoThumbnailUrl ?? item.photos?.[0] ?? item.car?.photos?.[0] ?? null;
            return (
              <Pressable
                onPress={() => openPost(item.id)}
                style={[styles.tile, { width: tileSize, height: Math.round(tileSize * 1.42) }]}
              >
                {thumb ? (
                  <Image source={{ uri: thumb }} style={StyleSheet.absoluteFillObject} />
                ) : (
                  <View style={[StyleSheet.absoluteFillObject, styles.tileFallback]}>
                    <MaterialCommunityIcons name="video" size={26} color="#777" />
                  </View>
                )}
                <View style={styles.tileShade} />
                <View style={styles.meta}>
                  <Text style={styles.username} numberOfLines={1}>@{item.author.username}</Text>
                  {!!item.caption && (
                    <Text style={styles.caption} numberOfLines={2}>{item.caption}</Text>
                  )}
                </View>
                <View style={styles.viewsBadge}>
                  <MaterialCommunityIcons name="play" size={12} color="#fff" />
                  <Text style={styles.viewsText}>{formatCount(item.viewsCount)}</Text>
                </View>
              </Pressable>
            );
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  searchBar: {
    marginHorizontal: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  input: { flex: 1, fontSize: 15, paddingVertical: 4 },
  searchBtn: {
    backgroundColor: '#e33835',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  searchBtnText: { color: '#fff', fontWeight: '800', fontSize: 13 },
  centered: { flexGrow: 1, justifyContent: 'center' },
  grid: { paddingHorizontal: 0, paddingBottom: 24 },
  resultHint: {
    width: '100%',
    paddingHorizontal: 16,
    paddingBottom: 10,
    fontSize: 13,
  },
  tile: { marginRight: GRID_GAP, marginBottom: GRID_GAP, backgroundColor: '#111', overflow: 'hidden' },
  tileFallback: { backgroundColor: '#141414', alignItems: 'center', justifyContent: 'center' },
  tileShade: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.18)' },
  meta: {
    position: 'absolute',
    left: 6,
    right: 6,
    bottom: 22,
  },
  username: { color: '#fff', fontSize: 10, fontWeight: '800', textShadowColor: '#000', textShadowRadius: 4 },
  caption: { color: '#f0f0f0', fontSize: 9, marginTop: 2, textShadowColor: '#000', textShadowRadius: 4 },
  viewsBadge: {
    position: 'absolute',
    left: 6,
    bottom: 5,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  viewsText: { color: '#fff', fontSize: 12, fontWeight: '700', textShadowColor: '#000', textShadowRadius: 4 },
  empty: { alignItems: 'center', paddingHorizontal: 28, paddingVertical: 48 },
  emptyTitle: { color: '#ddd', fontSize: 17, fontWeight: '800', marginTop: 12 },
  emptyText: { color: '#777', fontSize: 14, textAlign: 'center', marginTop: 6, lineHeight: 20 },
});
