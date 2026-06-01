import React, { useState, useCallback, useRef } from 'react';
import {
  View, Text, TextInput, FlatList, TouchableOpacity,
  Image, StatusBar, ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../../contexts/ThemeContext';
import { useChat, ChatUser } from '../../../hooks/useChats';
import { CommunityScreenHeader } from '../../../components/community';

export default function NewChatScreen() {
  const router = useRouter();
  const { theme, isDark } = useTheme();
  const { searchUsers, startConversation, friends } = useChat();

  const [query,     setQuery]     = useState('');
  const [results,   setResults]   = useState<ChatUser[]>([]);
  const [selected,  setSelected]  = useState<ChatUser[]>([]);
  const [loading,   setLoading]   = useState(false);
  const [starting,  setStarting]  = useState(false); // blokada podwójnego tworzenia
  const [groupName, setGroupName] = useState('');

  const searchTimer = useRef<any>(null); // debounce wyszukiwania

  // ── Wyszukiwanie z debounce ────────────────────────────
  const search = useCallback((q: string) => {
    setQuery(q);
    clearTimeout(searchTimer.current);
    if (q.length < 2) { setResults([]); return; }
    setLoading(true);
    searchTimer.current = setTimeout(async () => {
      const r = await searchUsers(q);
      setResults(r);
      setLoading(false);
    }, 350);
  }, [searchUsers]);

  const toggleSelect = (user: ChatUser) => {
    setSelected(prev =>
      prev.find(u => u.id === user.id)
        ? prev.filter(u => u.id !== user.id)
        : [...prev, user]
    );
  };

  // ── Utwórz konwersację — blokada podwójnego kliknięcia ─
  const handleStart = async () => {
    if (!selected.length || starting) return;
    setStarting(true);
    try {
      const isGroup = selected.length > 1;
      const id = await startConversation(
        selected.map(u => u.id),
        isGroup,
        isGroup ? groupName.trim() || 'Grupa' : undefined,
      );
      if (id) router.replace(`/Community/chats/${id}` as any);
    } finally {
      setStarting(false);
    }
  };

  const renderUser = ({ item }: { item: ChatUser }) => {
    const isSelected = !!selected.find(u => u.id === item.id);
    return (
      <TouchableOpacity
        style={[{
          flexDirection: 'row', alignItems: 'center',
          paddingHorizontal: 16, paddingVertical: 12, gap: 12,
          borderBottomWidth: 1, borderBottomColor: theme.border,
        }, isSelected && { backgroundColor: `${theme.primary}08` }]}
        onPress={() => toggleSelect(item)}
        activeOpacity={0.75}
      >
        {item.avatarUrl
          ? <Image source={{ uri: item.avatarUrl }} style={{ width: 46, height: 46, borderRadius: 23 }} />
          : (
            <View style={{ width: 46, height: 46, borderRadius: 23, backgroundColor: theme.primaryBg, borderWidth: 1, borderColor: theme.primaryBorder, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ color: theme.primary, fontFamily: 'Orbitron', fontSize: 13, fontWeight: '700' }}>
                {item.username?.slice(0, 2).toUpperCase()}
              </Text>
            </View>
          )
        }
        <View style={{ flex: 1 }}>
          <Text style={{ color: theme.text, fontFamily: 'Orbitron', fontSize: 11, fontWeight: '700' }}>{item.username}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: item.online ? '#4de926' : theme.textDim }} />
            <Text style={{ color: theme.textDim, fontSize: 10 }}>{item.online ? 'Online' : 'Offline'}</Text>
          </View>
        </View>
        {isSelected && <Feather name="check-circle" size={20} color={theme.primary} />}
      </TouchableOpacity>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={theme.bg} />

      <CommunityScreenHeader
        breadcrumb="WIADOMOŚCI"
        title="NOWY CZAT"
        right={selected.length > 0 ? (
          <TouchableOpacity
            style={[{
              flexDirection: 'row', alignItems: 'center', gap: 6,
              backgroundColor: theme.primary, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20,
            }, starting && { opacity: 0.6 }]}
            onPress={handleStart}
            disabled={starting}
            activeOpacity={0.8}
          >
            {starting
              ? <ActivityIndicator size="small" color="#fff" />
              : <>
                  <Text style={{ color: '#fff', fontFamily: 'Orbitron', fontSize: 10, fontWeight: '700' }}>
                    {selected.length > 1 ? 'UTWÓRZ GRUPĘ' : 'ROZPOCZNIJ'}
                  </Text>
                  <Feather name="arrow-right" size={14} color="#fff" />
                </>
            }
          </TouchableOpacity>
        ) : undefined}
      />

      {/* WYBRANI */}
      {selected.length > 0 && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 16, gap: 8, marginBottom: 8 }}>
          {selected.map(u => (
            <TouchableOpacity
              key={u.id}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: theme.primaryBg, borderWidth: 1, borderColor: theme.primaryBorder, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 6 }}
              onPress={() => toggleSelect(u)}
            >
              <Text style={{ color: theme.primary, fontFamily: 'Orbitron', fontSize: 9 }}>{u.username}</Text>
              <Feather name="x" size={12} color={theme.primary} />
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* NAZWA GRUPY */}
      {selected.length > 1 && (
        <View style={{ paddingHorizontal: 16, marginBottom: 8 }}>
          <TextInput
            style={{ backgroundColor: theme.surface, borderRadius: 12, borderWidth: 1, borderColor: theme.border2, color: theme.text, paddingHorizontal: 14, paddingVertical: 10, fontFamily: 'Orbitron', fontSize: 11 }}
            value={groupName}
            onChangeText={setGroupName}
            placeholder="Nazwa grupy (opcjonalnie)"
            placeholderTextColor={theme.textDim}
          />
        </View>
      )}

      {/* SZUKAJ */}
      <View style={{ flexDirection: 'row', alignItems: 'center', marginHorizontal: 16, marginBottom: 8, backgroundColor: theme.surface, borderRadius: 12, borderWidth: 1, borderColor: theme.border2, paddingHorizontal: 14, paddingVertical: 10, gap: 10 }}>
        <Feather name="search" size={16} color={theme.textDim} />
        <TextInput
          style={{ flex: 1, color: theme.text, fontSize: 13 }}
          value={query}
          onChangeText={search}
          placeholder="Szukaj użytkownika..."
          placeholderTextColor={theme.textDim}
          autoFocus
        />
        {loading && <ActivityIndicator size="small" color={theme.primary} />}
        {query.length > 0 && !loading && (
          <TouchableOpacity onPress={() => { setQuery(''); setResults([]); }}>
            <Feather name="x" size={15} color={theme.textDim} />
          </TouchableOpacity>
        )}
      </View>

      {!query && (
        <Text style={{ color: theme.textDim, fontFamily: 'Orbitron', fontSize: 9, letterSpacing: 2, paddingHorizontal: 16, marginBottom: 8 }}>
          ZNAJOMI
        </Text>
      )}

      <FlatList
        data={query ? results : friends}
        keyExtractor={i => String(i.id)}
        renderItem={renderUser}
        ListEmptyComponent={
          query.length >= 2 && !loading
            ? <Text style={{ color: theme.textDim, fontFamily: 'Orbitron', fontSize: 11, textAlign: 'center', paddingTop: 40 }}>Brak wyników</Text>
            : null
        }
        contentContainerStyle={{ paddingBottom: 100 }}
      />
    </View>
  );
}