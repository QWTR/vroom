import React, { useState, useCallback } from 'react';
import {
  View, Text, TouchableOpacity,
  FlatList, Image, ActivityIndicator, TextInput,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { ModalKeyboardSheet } from '../layout/ModalKeyboardSheet';
import { useTheme }      from '../../contexts/ThemeContext';
import { useRouter }     from 'expo-router';
import AsyncStorage      from '@react-native-async-storage/async-storage';
import Toast             from 'react-native-toast-message';
import { API_URL }       from '../../constants/config';
import type { ChatUser } from '../../hooks/useChats';

const getToken = async () =>
  (await AsyncStorage.getItem('userToken')) ?? (await AsyncStorage.getItem('token'));

interface SearchUser {
  id:        number;
  username:  string;
  avatarUrl: string | null;
  online:    boolean;
}

interface Props {
  visible:   boolean;
  friends:   ChatUser[];
  loading:   boolean;
  onClose:   () => void;
  onRemove?: (friend: ChatUser) => void;
  isOwner:   boolean;
}

export function FriendsModal({ visible, friends, loading, onClose, onRemove, isOwner }: Props) {
  const { theme } = useTheme();
  const router    = useRouter();

  const [tab,            setTab]           = useState<'friends' | 'add'>('friends');
  const [searchQuery,    setSearchQuery]   = useState('');
  const [searchResults,  setSearchResults] = useState<SearchUser[]>([]);
  const [searching,      setSearching]     = useState(false);
  // id → 'none' | 'sending' | 'sent' | 'friend'
  const [sentMap,        setSentMap]       = useState<Record<number, string>>({});

  // ── zainicjuj sentMap na podstawie listy znajomych ────
  React.useEffect(() => {
    if (!visible) return;
    const map: Record<number, string> = {};
    friends.forEach(f => { map[f.id] = 'friend'; });
    setSentMap(map);
  }, [visible, friends]);

  // ── reset przy zamknięciu ─────────────────────────────
  const handleClose = () => {
    setTab('friends');
    setSearchQuery('');
    setSearchResults([]);
    onClose();
  };

  // ── szukaj użytkowników ───────────────────────────────
  const handleSearch = useCallback(async (q: string) => {
    setSearchQuery(q);
    if (q.trim().length < 2) { setSearchResults([]); return; }
    setSearching(true);
    try {
      const token = await getToken();
      const res   = await fetch(
        `${API_URL}/api/chat/users/search?q=${encodeURIComponent(q.trim())}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (res.ok) setSearchResults(await res.json());
    } catch {}
    finally { setSearching(false); }
  }, []);

  // ── wyślij zaproszenie ────────────────────────────────
  const handleSendRequest = useCallback(async (user: SearchUser) => {
    setSentMap(prev => ({ ...prev, [user.id]: 'sending' }));
    try {
      const token = await getToken();
      const res   = await fetch(`${API_URL}/api/chat/friends/request`, {
        method:  'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body:    JSON.stringify({ userId: user.id }),
      });
      const data = await res.json();
      if (res.ok) {
        setSentMap(prev => ({ ...prev, [user.id]: 'sent' }));
        Toast.show({ type: 'success', text1: `✅ Zaproszenie wysłane do ${user.username}` });
      } else {
        setSentMap(prev => ({ ...prev, [user.id]: 'none' }));
        Toast.show({ type: 'error', text1: 'BŁĄD', text2: data.error ?? 'Spróbuj ponownie' });
      }
    } catch {
      setSentMap(prev => ({ ...prev, [user.id]: 'none' }));
      Toast.show({ type: 'error', text1: 'BŁĄD', text2: 'Brak połączenia' });
    }
  }, []);

  // ── przycisk akcji dla wyniku wyszukiwania ────────────
  const renderActionBtn = (user: SearchUser) => {
    const state = sentMap[user.id] ?? 'none';

    if (state === 'friend') return (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: '#ff6b9d12', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 7, borderWidth: 1, borderColor: '#ff6b9d30' }}>
        <MaterialIcons name="favorite" size={13} color="#ff6b9d" />
        <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: '#ff6b9d' }}>ZNAJOMY</Text>
      </View>
    );

    if (state === 'sending') return (
      <View style={{ width: 36, height: 36, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="small" color={theme.primary} />
      </View>
    );

    if (state === 'sent') return (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: '#4de92612', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 7, borderWidth: 1, borderColor: '#4de92630' }}>
        <MaterialIcons name="check" size={13} color="#4de926" />
        <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: '#4de926' }}>WYSŁANO</Text>
      </View>
    );

    return (
      <TouchableOpacity
        style={{ flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: theme.primaryBg, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 7, borderWidth: 1, borderColor: theme.primaryBorder }}
        onPress={() => handleSendRequest(user)}
        activeOpacity={0.8}
      >
        <MaterialIcons name="person-add" size={13} color={theme.primary} />
        <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: theme.primary, fontWeight: '700' }}>DODAJ</Text>
      </TouchableOpacity>
    );
  };

  return (
    <ModalKeyboardSheet visible={visible} onClose={handleClose} maxHeight="85%">
          {/* Handle */}
          <View style={{ width: 40, height: 4, backgroundColor: theme.border3, borderRadius: 2, alignSelf: 'center', marginTop: 12, marginBottom: 8 }} />

          {/* Nagłówek */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, borderBottomWidth: 1, borderColor: theme.border, marginBottom: 4 }}>
            <MaterialIcons name="people" size={20} color={theme.primary} />
            <Text style={{ fontFamily: 'Orbitron', fontSize: 13, color: theme.text, letterSpacing: 2, flex: 1 }}>ZNAJOMI</Text>
            <View style={{ backgroundColor: theme.primaryBg, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 3, borderWidth: 1, borderColor: theme.primaryBorder }}>
              <Text style={{ fontFamily: 'Orbitron', fontSize: 10, color: theme.primary }}>{friends.length}</Text>
            </View>
            <TouchableOpacity onPress={handleClose} style={{ padding: 4 }}>
              <MaterialIcons name="close" size={20} color={theme.textDim} />
            </TouchableOpacity>
          </View>

          {/* Zakładki — tylko dla właściciela */}
          {isOwner && (
            <View style={{ flexDirection: 'row', backgroundColor: theme.surface2, borderRadius: 12, padding: 3, marginBottom: 12 }}>
              {([
                { key: 'friends', label: 'LISTA',   icon: 'people'     },
                { key: 'add',     label: 'DODAJ',    icon: 'person-add' },
              ] as { key: 'friends' | 'add'; label: string; icon: string }[]).map(t => (
                <TouchableOpacity
                  key={t.key}
                  style={[{
                    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
                    gap: 6, paddingVertical: 9, borderRadius: 9,
                  }, tab === t.key && { backgroundColor: theme.primary }]}
                  onPress={() => setTab(t.key)}
                  activeOpacity={0.8}
                >
                  <MaterialIcons name={t.icon as any} size={13} color={tab === t.key ? '#fff' : theme.textDim} />
                  <Text style={{ fontFamily: 'Orbitron', fontSize: 9, fontWeight: '700', color: tab === t.key ? '#fff' : theme.textDim }}>
                    {t.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          {/* ── ZAKŁADKA: LISTA ZNAJOMYCH ─────────────── */}
          {tab === 'friends' && (
            loading ? (
              <View style={{ paddingVertical: 40, alignItems: 'center' }}>
                <ActivityIndicator size="large" color={theme.primary} />
              </View>
            ) : friends.length === 0 ? (
              <View style={{ paddingVertical: 48, alignItems: 'center', gap: 12 }}>
                <MaterialIcons name="people-outline" size={48} color={theme.border3} />
                <Text style={{ fontFamily: 'Orbitron', color: theme.textDim, fontSize: 12 }}>Brak znajomych</Text>
                {isOwner && (
                  <TouchableOpacity
                    style={{ backgroundColor: theme.primaryBg, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 9, borderWidth: 1, borderColor: theme.primaryBorder, flexDirection: 'row', alignItems: 'center', gap: 7 }}
                    onPress={() => setTab('add')}
                  >
                    <MaterialIcons name="person-add" size={14} color={theme.primary} />
                    <Text style={{ fontFamily: 'Orbitron', fontSize: 9, color: theme.primary, fontWeight: '700' }}>DODAJ ZNAJOMEGO</Text>
                  </TouchableOpacity>
                )}
              </View>
            ) : (
              <FlatList
                data={friends}
                keyExtractor={f => String(f.id)}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{ paddingBottom: 40, paddingTop: 8 }}
                renderItem={({ item: f }) => (
                  <View style={{
                    flexDirection: 'row', alignItems: 'center',
                    backgroundColor: theme.surface2, borderRadius: 14,
                    padding: 12, marginBottom: 8,
                    borderWidth: 1, borderColor: theme.border2, gap: 12,
                  }}>
                    {/* Avatar */}
                    <TouchableOpacity onPress={() => { handleClose(); router.push(`/profile/${f.id}` as any); }} activeOpacity={0.8}>
                      <View style={{
                        width: 48, height: 48, borderRadius: 24,
                        backgroundColor: theme.surface3,
                        borderWidth: 2, borderColor: f.online ? '#4de926' : theme.border,
                        justifyContent: 'center', alignItems: 'center', overflow: 'hidden',
                      }}>
                        {f.avatarUrl
                          ? <Image source={{ uri: f.avatarUrl }} style={{ width: 48, height: 48 }} />
                          : <Text style={{ fontFamily: 'Orbitron', fontSize: 14, color: theme.primary }}>{f.username.slice(0, 2).toUpperCase()}</Text>
                        }
                      </View>
                      {f.online && (
                        <View style={{ position: 'absolute', bottom: 0, right: 0, width: 14, height: 14, borderRadius: 7, backgroundColor: '#4de926', borderWidth: 2, borderColor: theme.surface }} />
                      )}
                    </TouchableOpacity>

                    {/* Info */}
                    <TouchableOpacity style={{ flex: 1 }} onPress={() => { handleClose(); router.push(`/profile/${f.id}` as any); }} activeOpacity={0.8}>
                      <Text style={{ fontFamily: 'Orbitron', color: theme.text, fontSize: 12, fontWeight: '700' }}>{f.username}</Text>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 3 }}>
                        <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: f.online ? '#4de926' : theme.textDim }} />
                        <Text style={{ fontFamily: 'Orbitron', color: theme.textDim, fontSize: 9 }}>{f.online ? 'Online' : 'Offline'}</Text>
                      </View>
                    </TouchableOpacity>

                    {/* Akcje */}
                    <View style={{ flexDirection: 'row', gap: 8 }}>
                      <TouchableOpacity
                        style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: theme.primaryBg, borderWidth: 1, borderColor: theme.primaryBorder, justifyContent: 'center', alignItems: 'center' }}
                        onPress={() => { handleClose(); router.push(`/profile/${f.id}` as any); }}
                        activeOpacity={0.8}
                      >
                        <MaterialIcons name="person" size={16} color={theme.primary} />
                      </TouchableOpacity>
                      {isOwner && onRemove && (
                        <TouchableOpacity
                          style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: '#ff6b9d12', borderWidth: 1, borderColor: '#ff6b9d30', justifyContent: 'center', alignItems: 'center' }}
                          onPress={() => onRemove(f)}
                          activeOpacity={0.8}
                        >
                          <MaterialIcons name="person-remove" size={16} color="#ff6b9d" />
                        </TouchableOpacity>
                      )}
                    </View>
                  </View>
                )}
              />
            )
          )}

          {/* ── ZAKŁADKA: DODAJ ZNAJOMEGO ─────────────── */}
          {tab === 'add' && (
            <View style={{ paddingBottom: 40 }}>
              {/* Wyszukiwarka */}
              <View style={{
                flexDirection: 'row', alignItems: 'center', gap: 10,
                backgroundColor: theme.surface2, borderRadius: 14,
                paddingHorizontal: 14, paddingVertical: 10,
                borderWidth: 1, borderColor: theme.border2, marginBottom: 12,
              }}>
                <MaterialIcons name="search" size={18} color={theme.textDim} />
                <TextInput
                  style={{ flex: 1, fontFamily: 'Orbitron', color: theme.text, fontSize: 12 }}
                  value={searchQuery}
                  onChangeText={handleSearch}
                  placeholder="Szukaj po nazwie..."
                  placeholderTextColor={theme.textDim}
                  autoFocus
                  autoCapitalize="none"
                />
                {searchQuery.length > 0 && (
                  <TouchableOpacity onPress={() => { setSearchQuery(''); setSearchResults([]); }}>
                    <MaterialIcons name="close" size={16} color={theme.textDim} />
                  </TouchableOpacity>
                )}
              </View>

              {/* Wyniki */}
              {searching ? (
                <View style={{ paddingVertical: 30, alignItems: 'center' }}>
                  <ActivityIndicator color={theme.primary} />
                </View>
              ) : searchQuery.trim().length < 2 ? (
                <View style={{ paddingVertical: 40, alignItems: 'center', gap: 10 }}>
                  <MaterialIcons name="person-search" size={44} color={theme.border3} />
                  <Text style={{ fontFamily: 'Orbitron', color: theme.textDim, fontSize: 10, textAlign: 'center' }}>
                    Wpisz minimum 2 znaki{'\n'}aby wyszukać użytkownika
                  </Text>
                </View>
              ) : searchResults.length === 0 ? (
                <View style={{ paddingVertical: 40, alignItems: 'center', gap: 10 }}>
                  <MaterialIcons name="search-off" size={44} color={theme.border3} />
                  <Text style={{ fontFamily: 'Orbitron', color: theme.textDim, fontSize: 10 }}>Brak wyników</Text>
                </View>
              ) : (
                <FlatList
                  data={searchResults}
                  keyExtractor={u => String(u.id)}
                  showsVerticalScrollIndicator={false}
                  keyboardShouldPersistTaps="handled"
                  style={{ maxHeight: 420 }}
                  renderItem={({ item: u }) => (
                    <View style={{
                      flexDirection: 'row', alignItems: 'center', gap: 12,
                      backgroundColor: theme.surface2, borderRadius: 14,
                      padding: 12, marginBottom: 8,
                      borderWidth: 1, borderColor: theme.border2,
                    }}>
                      {/* Avatar */}
                      <TouchableOpacity onPress={() => { handleClose(); router.push(`/profile/${u.id}` as any); }} activeOpacity={0.8}>
                        <View style={{
                          width: 46, height: 46, borderRadius: 23,
                          backgroundColor: theme.surface3,
                          borderWidth: 2, borderColor: u.online ? '#4de926' : theme.border,
                          justifyContent: 'center', alignItems: 'center', overflow: 'hidden',
                        }}>
                          {u.avatarUrl
                            ? <Image source={{ uri: u.avatarUrl }} style={{ width: 46, height: 46 }} />
                            : <Text style={{ fontFamily: 'Orbitron', fontSize: 13, color: theme.primary }}>{u.username.slice(0, 2).toUpperCase()}</Text>
                          }
                        </View>
                        {u.online && (
                          <View style={{ position: 'absolute', bottom: 0, right: 0, width: 13, height: 13, borderRadius: 7, backgroundColor: '#4de926', borderWidth: 2, borderColor: theme.surface }} />
                        )}
                      </TouchableOpacity>

                      {/* Nazwa */}
                      <TouchableOpacity style={{ flex: 1 }} onPress={() => { handleClose(); router.push(`/profile/${u.id}` as any); }} activeOpacity={0.8}>
                        <Text style={{ fontFamily: 'Orbitron', color: theme.text, fontSize: 12, fontWeight: '700' }}>{u.username}</Text>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 3 }}>
                          <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: u.online ? '#4de926' : theme.textDim }} />
                          <Text style={{ fontFamily: 'Orbitron', color: theme.textDim, fontSize: 9 }}>{u.online ? 'Online' : 'Offline'}</Text>
                        </View>
                      </TouchableOpacity>

                      {/* Przycisk akcji */}
                      {renderActionBtn(u)}
                    </View>
                  )}
                />
              )}
            </View>
          )}
    </ModalKeyboardSheet>
  );
}