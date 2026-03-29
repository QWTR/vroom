import React, { useState, useCallback } from 'react';
import {
  View, Text, TextInput, FlatList, TouchableOpacity,
  Image, StyleSheet, StatusBar, ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useChat, ChatUser } from '../../../hooks/useChats';

export default function NewChatScreen() {
  const router = useRouter();
  const { searchUsers, startConversation, friends } = useChat();

  const [query,    setQuery]    = useState('');
  const [results,  setResults]  = useState<ChatUser[]>([]);
  const [selected, setSelected] = useState<ChatUser[]>([]);
  const [loading,  setLoading]  = useState(false);
  const [groupMode, setGroupMode] = useState(false);
  const [groupName, setGroupName] = useState('');

  const search = useCallback(async (q: string) => {
    setQuery(q);
    if (q.length < 2) { setResults([]); return; }
    setLoading(true);
    const r = await searchUsers(q);
    setResults(r);
    setLoading(false);
  }, [searchUsers]);

  const toggleSelect = (user: ChatUser) => {
    setSelected(prev =>
      prev.find(u => u.id === user.id)
        ? prev.filter(u => u.id !== user.id)
        : [...prev, user]
    );
    if (!groupMode && selected.length === 0) setGroupMode(false);
  };

  const handleStart = async () => {
    if (!selected.length) return;
    const isGroup = selected.length > 1 || groupMode;
    const id = await startConversation(
      selected.map(u => u.id),
      isGroup,
      isGroup ? groupName || 'Grupa' : undefined,
    );
    if (id) router.replace(`/Community/chats/${id}`);
  };

  const renderUser = ({ item }: { item: ChatUser }) => {
    const isSelected = !!selected.find(u => u.id === item.id);
    return (
      <TouchableOpacity
        style={[s.userItem, isSelected && s.userItemSelected]}
        onPress={() => toggleSelect(item)}
        activeOpacity={0.75}
      >
        {item.avatarUrl
          ? <Image source={{ uri: item.avatarUrl }} style={s.avatar} />
          : (
            <View style={[s.avatar, s.avatarFallback]}>
              <Text style={s.avatarText}>{item.username?.slice(0, 2).toUpperCase()}</Text>
            </View>
          )
        }
        <View style={{ flex: 1 }}>
          <Text style={s.username}>{item.username}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <View style={[s.dot, { backgroundColor: item.online ? '#4de926' : '#ffffff30' }]} />
            <Text style={s.status}>{item.online ? 'Online' : 'Offline'}</Text>
          </View>
        </View>
        {isSelected && <Feather name="check-circle" size={20} color="#e33835" />}
      </TouchableOpacity>
    );
  };

  return (
    <View style={s.container}>
      <StatusBar barStyle="light-content" backgroundColor="#0a0a0a" />

      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
          <Feather name="arrow-left" size={20} color="#fff" />
        </TouchableOpacity>
        <Text style={s.headerTitle}>NOWY CZAT</Text>
        {selected.length > 0 && (
          <TouchableOpacity style={s.startBtn} onPress={handleStart}>
            <Text style={s.startBtnText}>
              {selected.length > 1 ? 'GRUPA' : 'CZAT'}
            </Text>
            <Feather name="arrow-right" size={14} color="#fff" />
          </TouchableOpacity>
        )}
      </View>

      {/* Wybrani */}
      {selected.length > 0 && (
        <View style={s.selectedWrap}>
          {selected.map(u => (
            <TouchableOpacity key={u.id} style={s.selectedChip} onPress={() => toggleSelect(u)}>
              <Text style={s.selectedChipText}>{u.username}</Text>
              <Feather name="x" size={12} color="#fff" />
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Nazwa grupy */}
      {selected.length > 1 && (
        <View style={s.groupNameWrap}>
          <TextInput
            style={s.groupNameInput}
            value={groupName}
            onChangeText={setGroupName}
            placeholder="Nazwa grupy (opcjonalnie)"
            placeholderTextColor="#ffffff30"
          />
        </View>
      )}

      {/* Search */}
      <View style={s.searchWrap}>
        <Feather name="search" size={16} color="#ffffff50" />
        <TextInput
          style={s.searchInput}
          value={query}
          onChangeText={search}
          placeholder="Szukaj użytkownika..."
          placeholderTextColor="#ffffff30"
          autoFocus
        />
        {loading && <ActivityIndicator size="small" color="#e33835" />}
      </View>

      {/* Znajomi (gdy brak query) */}
      {!query && (
        <Text style={s.sectionLabel}>ZNAJOMI</Text>
      )}

      <FlatList
        data={query ? results : friends}
        keyExtractor={i => String(i.id)}
        renderItem={renderUser}
        ListEmptyComponent={
          query.length >= 2 && !loading
            ? <Text style={s.emptyText}>Brak wyników</Text>
            : null
        }
        contentContainerStyle={{ paddingBottom: 100 }}
      />
    </View>
  );
}

const s = StyleSheet.create({
  container:      { flex: 1, backgroundColor: '#0a0a0a' },
  header:         { flexDirection: 'row', alignItems: 'center', paddingTop: 60, paddingHorizontal: 16, paddingBottom: 16, gap: 12 },
  backBtn:        { width: 36, height: 36, borderRadius: 18, backgroundColor: '#ffffff08', alignItems: 'center', justifyContent: 'center' },
  headerTitle:    { flex: 1, color: '#fff', fontFamily: 'Orbitron', fontSize: 16, fontWeight: '700', letterSpacing: 2 },
  startBtn:       { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#e33835', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20 },
  startBtnText:   { color: '#fff', fontFamily: 'Orbitron', fontSize: 10, fontWeight: '700' },
  selectedWrap:   { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 16, gap: 8, marginBottom: 8 },
  selectedChip:   { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#e3383525', borderWidth: 1, borderColor: '#e3383545', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 6 },
  selectedChipText:{ color: '#e33835', fontFamily: 'Orbitron', fontSize: 9 },
  groupNameWrap:  { paddingHorizontal: 16, marginBottom: 8 },
  groupNameInput: { backgroundColor: '#141414', borderRadius: 12, borderWidth: 1, borderColor: '#ffffff10', color: '#fff', paddingHorizontal: 14, paddingVertical: 10, fontFamily: 'Orbitron', fontSize: 11 },
  searchWrap:     { flexDirection: 'row', alignItems: 'center', marginHorizontal: 16, marginBottom: 8, backgroundColor: '#141414', borderRadius: 12, borderWidth: 1, borderColor: '#ffffff10', paddingHorizontal: 14, paddingVertical: 10, gap: 10 },
  searchInput:    { flex: 1, color: '#fff', fontSize: 13 },
  sectionLabel:   { color: '#ffffff30', fontFamily: 'Orbitron', fontSize: 9, letterSpacing: 2, paddingHorizontal: 16, marginBottom: 8 },
  userItem:       { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, gap: 12, borderBottomWidth: 1, borderBottomColor: '#ffffff06' },
  userItemSelected:{ backgroundColor: '#e3383508' },
  avatar:         { width: 46, height: 46, borderRadius: 23 },
  avatarFallback: { backgroundColor: '#e3383520', borderWidth: 1, borderColor: '#e3383540', alignItems: 'center', justifyContent: 'center' },
  avatarText:     { color: '#e33835', fontFamily: 'Orbitron', fontSize: 13, fontWeight: '700' },
  username:       { color: '#fff', fontFamily: 'Orbitron', fontSize: 11, fontWeight: '700' },
  status:         { color: '#ffffff40', fontSize: 10 },
  dot:            { width: 6, height: 6, borderRadius: 3 },
  emptyText:      { color: '#ffffff25', fontFamily: 'Orbitron', fontSize: 11, textAlign: 'center', paddingTop: 40 },
});