import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  Pressable,
  ScrollView,
  TextInput,
  ActivityIndicator,
  Image,
  StyleSheet,
} from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Toast from 'react-native-toast-message';
import { useTheme } from '../../contexts/ThemeContext';
import { API_URL } from '../../constants/config';
import type { VroomkiSound } from '../../lib/vroomkiTypes';

const getToken = async () =>
  (await AsyncStorage.getItem('userToken')) ?? (await AsyncStorage.getItem('token'));

function isPlayableSound(sound: VroomkiSound) {
  if (sound.sourceType === 'original') return true;
  return !!sound.audioUrl;
}

function sourceBadge(sound: VroomkiSound) {
  if (sound.sourceType === 'deezer' || sound.sourceType === 'itunes' || sound.isPolish) return ' · PL';
  if (sound.sourceType === 'audius' || sound.isFullTrack) return ' · pełny utwór';
  if (sound.sourceType === 'spotify') return ' · preview 30s';
  return '';
}

export function VroomkiSoundChip({
  sound,
  onPress,
}: {
  sound: VroomkiSound;
  onPress?: () => void;
}) {
  const label = sound.sourceType === 'original'
    ? sound.title
    : `${sound.artist ? `${sound.artist} — ` : ''}${sound.title}`;

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.85}
      style={{
        alignSelf: 'flex-start',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        maxWidth: '92%',
        backgroundColor: '#00000078',
        borderRadius: 999,
        paddingHorizontal: 12,
        paddingVertical: 8,
        marginBottom: 8,
      }}
    >
      {sound.coverUrl ? (
        <Image source={{ uri: sound.coverUrl }} style={{ width: 22, height: 22, borderRadius: 6 }} />
      ) : (
        <MaterialIcons name="music-note" size={16} color="#fff" />
      )}
      <Text style={{ color: '#fff', fontSize: 12, fontFamily: 'Orbitron', flexShrink: 1 }} numberOfLines={1}>
        {label}
      </Text>
      <MaterialIcons name="chevron-right" size={16} color="#ffffffaa" />
    </TouchableOpacity>
  );
}

export function VroomkiSoundPicker({
  visible,
  onClose,
  hasVideo,
  selected,
  onSelect,
}: {
  visible: boolean;
  onClose: () => void;
  hasVideo: boolean;
  selected: VroomkiSound | null;
  onSelect: (sound: VroomkiSound | null, opts?: { useOriginalAudio?: boolean }) => void;
}) {
  const { theme } = useTheme();
  const [tab, setTab] = useState<'trending' | 'search'>('trending');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [trending, setTrending] = useState<VroomkiSound[]>([]);
  const [results, setResults] = useState<VroomkiSound[]>([]);
  const [searchHint, setSearchHint] = useState('');

  const loadTrending = useCallback(async () => {
    setLoading(true);
    try {
      const token = await getToken();
      const res = await fetch(`${API_URL}/api/vroomki/sounds/trending?limit=16`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof json?.error === 'string' ? json.error : 'Błąd ładowania sugestii');
      const sounds: VroomkiSound[] = Array.isArray(json.sounds) ? json.sounds : [];
      setTrending(sounds.filter(isPlayableSound));
    } catch (e: any) {
      setTrending([]);
      Toast.show({ type: 'error', text1: 'Muzyka', text2: e?.message ?? 'Nie udało się załadować sugestii' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!visible) return;
    void loadTrending();
  }, [visible, loadTrending]);

  useEffect(() => {
    if (!visible || tab !== 'search') return undefined;
    const q = query.trim();
    if (q.length < 1) {
      setResults([]);
      setSearchHint('');
      return undefined;
    }
    const timer = setTimeout(async () => {
      setLoading(true);
      setSearchHint('');
      try {
        const token = await getToken();

        const res = await fetch(`${API_URL}/api/vroomki/sounds/search?q=${encodeURIComponent(q)}&limit=16`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(typeof json?.error === 'string' ? json.error : 'Błąd wyszukiwania');

        const sounds: VroomkiSound[] = Array.isArray(json.sounds) ? json.sounds : [];
        const playable = sounds.filter(isPlayableSound);
        setResults(playable);
        if (playable.length === 0) {
          setSearchHint('Brak wyników — spróbuj np. quebonafide, sanah, bedoes, phonk.');
        }
      } catch (e: any) {
        setResults([]);
        setSearchHint('');
        Toast.show({ type: 'error', text1: 'Szukaj', text2: e?.message ?? 'Błąd wyszukiwania' });
      } finally {
        setLoading(false);
      }
    }, 280);
    return () => clearTimeout(timer);
  }, [visible, tab, query]);

  const list = tab === 'trending' ? trending : results;

  const renderRow = (sound: VroomkiSound) => {
    const key = `${sound.sourceType}:${sound.sourceId}`;
    const selectedKey = selected ? `${selected.sourceType}:${selected.sourceId}` : null;
    const isSelected = selectedKey === key;
    const playable = isPlayableSound(sound);

    return (
      <TouchableOpacity
        key={key}
        onPress={() => {
          if (!playable) {
            Toast.show({ type: 'info', text1: 'Brak audio', text2: 'Ten utwór nie ma dostępnego podglądu.' });
            return;
          }
          onSelect(sound, { useOriginalAudio: false });
        }}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          paddingVertical: 10,
          opacity: playable ? 1 : 0.45,
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: theme.border,
          backgroundColor: isSelected ? '#e3383518' : 'transparent',
        }}
      >
        {sound.coverUrl ? (
          <Image source={{ uri: sound.coverUrl }} style={{ width: 48, height: 48, borderRadius: 10 }} />
        ) : (
          <View style={{ width: 48, height: 48, borderRadius: 10, backgroundColor: theme.surface2, justifyContent: 'center', alignItems: 'center' }}>
            <MaterialIcons name="music-note" size={22} color="#e33835" />
          </View>
        )}
        <View style={{ flex: 1 }}>
          <Text style={{ color: theme.text, fontFamily: 'Orbitron', fontSize: 12 }} numberOfLines={1}>{sound.title}</Text>
          <Text style={{ color: theme.textDim, fontSize: 11, marginTop: 3 }} numberOfLines={1}>
            {sound.artist || 'VROOM'}
            {sourceBadge(sound)}
            {!playable ? ' · brak audio' : ''}
          </Text>
        </View>
        {isSelected && <MaterialIcons name="check-circle" size={20} color="#e33835" />}
      </TouchableOpacity>
    );
  };

  return (
    <Modal visible={visible} animationType="slide" transparent statusBarTranslucent onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: '#000000aa', justifyContent: 'flex-end' }}>
        <Pressable style={{ flex: 1 }} onPress={onClose} />
        <View style={{ maxHeight: '78%', backgroundColor: theme.surface, borderTopLeftRadius: 26, borderTopRightRadius: 26, padding: 16, paddingBottom: 28 }}>
          <View style={{ width: 42, height: 4, borderRadius: 2, backgroundColor: theme.border3, alignSelf: 'center', marginBottom: 14 }} />
          <Text style={{ fontFamily: 'Orbitron', color: theme.text, fontSize: 13, letterSpacing: 2, marginBottom: 12 }}>DŹWIĘK</Text>
          <Text style={{ color: theme.textDim, fontSize: 11, marginBottom: 12, lineHeight: 16 }}>
            Deezer + iTunes PL = polskie hity. Audius = pełne utwory. Spotify = 30s preview.
          </Text>

          {hasVideo && (
            <TouchableOpacity
              onPress={() => onSelect(null, { useOriginalAudio: true })}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 10,
                padding: 12,
                borderRadius: 14,
                backgroundColor: selected?.sourceType === 'original' || (!selected && hasVideo) ? '#e3383518' : theme.surface2,
                borderWidth: 1,
                borderColor: '#e3383540',
                marginBottom: 12,
              }}
            >
              <MaterialIcons name="mic" size={22} color="#e33835" />
              <View style={{ flex: 1 }}>
                <Text style={{ color: theme.text, fontFamily: 'Orbitron', fontSize: 12 }}>Oryginalny dźwięk</Text>
                <Text style={{ color: theme.textDim, fontSize: 11, marginTop: 2 }}>Audio z Twojego filmu</Text>
              </View>
            </TouchableOpacity>
          )}

          <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
            {(['trending', 'search'] as const).map((item) => (
              <TouchableOpacity
                key={item}
                onPress={() => setTab(item)}
                style={{
                  paddingHorizontal: 14,
                  paddingVertical: 8,
                  borderRadius: 999,
                  backgroundColor: tab === item ? '#e33835' : theme.surface2,
                }}
              >
                <Text style={{ color: tab === item ? '#fff' : theme.textDim, fontFamily: 'Orbitron', fontSize: 10 }}>
                  {item === 'trending' ? 'SUGEROWANE' : 'SZUKAJ'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {tab === 'search' && (
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Szukaj utworu (PL, rap, phonk...)"
              placeholderTextColor={theme.textDim}
              style={{
                borderRadius: 14,
                borderWidth: 1,
                borderColor: theme.border,
                backgroundColor: theme.surface2,
                color: theme.text,
                paddingHorizontal: 12,
                paddingVertical: 10,
                marginBottom: 10,
              }}
            />
          )}

          {loading ? <ActivityIndicator color="#e33835" style={{ marginVertical: 20 }} /> : (
            <ScrollView style={{ maxHeight: 320 }}>
              {list.length === 0 ? (
                <Text style={{ color: theme.textDim, textAlign: 'center', marginVertical: 24, fontSize: 12 }}>
                  {tab === 'search'
                    ? (searchHint || (query.trim().length < 1 ? 'Wpisz nazwę utworu lub artysty' : 'Brak wyników'))
                    : 'Ładowanie sugestii...'}
                </Text>
              ) : list.map(renderRow)}
            </ScrollView>
          )}

          <TouchableOpacity onPress={onClose} style={{ marginTop: 12, alignSelf: 'center' }}>
            <Text style={{ color: theme.textDim, fontFamily: 'Orbitron', fontSize: 11 }}>GOTOWE</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}
