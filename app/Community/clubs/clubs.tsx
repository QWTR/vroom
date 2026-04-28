import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, TextInput,
  Image, ActivityIndicator, RefreshControl, Alert,
} from 'react-native';
import { SafeAreaView }       from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import MaterialIcons          from '@expo/vector-icons/MaterialIcons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Feather }            from '@expo/vector-icons';
import AsyncStorage           from '@react-native-async-storage/async-storage';
import Toast                  from 'react-native-toast-message';
import { useTheme }           from '../../../contexts/ThemeContext';
import { usePremium }         from '../../../contexts/PremiumContext';
import { API_URL }            from '../../../constants/config';

import ClubCard               from '../../../components/clubs/ClubCard';
import CreateClubModal        from '../../../components/clubs/CreateClubModal';
import ClubDetailModal        from '../../../components/clubs/ClubDetailModal';
import RanksModal             from '../../../components/clubs/RanksModal';
import { Club }               from '../../../components/clubs/types';
import { MyInvitesModal }     from '../../../components/clubs/MyInvitesModal';

const getToken = () => AsyncStorage.getItem('token');
const PAGE     = 20;

export default function ClubsScreen() {
  const router    = useRouter();
  const { theme } = useTheme();
  const { isPremium } = usePremium();

  const [myId, setMyId] = useState<number | null>(null);

  const [clubs,       setClubs]       = useState<Club[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [refreshing,  setRefreshing]  = useState(false);
  const [nextCursor,  setNextCursor]  = useState<number | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore,     setHasMore]     = useState(true);
  const [search,      setSearch]      = useState('');
  const [searchActive, setSearchActive] = useState(false);
  const [joining,     setJoining]     = useState<number | null>(null);

  // ── Mój owned klub (założony przeze mnie) ─────────────
  const [myOwnedClub, setMyOwnedClub] = useState<Club | null>(null);
  // ── Kluby w których jestem członkiem (nie owner) ──────
  const [myMemberClubs, setMyMemberClubs] = useState<Club[]>([]);

  const [createVisible, setCreateVisible] = useState(false);
  const [detailClub,    setDetailClub]    = useState<Club | null>(null);
  const [ranksClub,     setRanksClub]     = useState<Club | null>(null);

  const [invitesVisible, setInvitesVisible] = useState(false);
  const [inviteCount,    setInviteCount]    = useState(0);

  const searchTimer = useRef<any>(null);

  useEffect(() => {
    AsyncStorage.getItem('user').then(raw => {
      if (raw) setMyId(JSON.parse(raw).userId);
    });
  }, []);

  // ── Fetch clubs ────────────────────────────────────────
  const fetchClubs = useCallback(async (cursor?: number, q?: string) => {
    try {
      const token  = await getToken();
      const params = new URLSearchParams({ limit: String(PAGE) });
      if (cursor) params.append('cursor', String(cursor));
      if (q)      params.append('search', q);
      const res  = await fetch(`${API_URL}/api/clubs?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      const list: Club[] = data.clubs ?? [];
      if (cursor) setClubs(prev => [...prev, ...list]);
      else        setClubs(list);
      setNextCursor(data.nextCursor ?? null);
      setHasMore(!!data.nextCursor);
    } catch {
      Toast.show({ type: 'error', text1: 'Błąd ładowania klubów' });
    } finally {
      setLoading(false); setRefreshing(false); setLoadingMore(false);
    }
  }, []);

  const fetchMyInviteCount = useCallback(async () => {
    try {
      const token = await getToken();
      const res   = await fetch(`${API_URL}/api/clubs/invites/my`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) { const data = await res.json(); setInviteCount(data.length); }
    } catch {}
  }, []);

  // ── fetchMyClub — pobierz owned + member clubs ────────
  const fetchMyClub = useCallback(async () => {
    try {
      const token = await getToken();
      const res   = await fetch(`${API_URL}/api/clubs/my/all`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const clubs: Club[] = await res.json();

      const owned  = clubs.find(c => c.myRole === 'owner') ?? null;
      const member = clubs.filter(c => c.myRole !== 'owner');

      setMyOwnedClub(owned);
      setMyMemberClubs(member);
    } catch {}
  }, []);

  const fetchClubDetail = useCallback(async (clubId: number) => {
    const token = await getToken();
    const res   = await fetch(`${API_URL}/api/clubs/${clubId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return res.json() as Promise<Club>;
  }, []);

  useFocusEffect(useCallback(() => {
    setLoading(true); setHasMore(true);
    fetchClubs();
    fetchMyClub();
    fetchMyInviteCount();
  }, []));

  const openDetail = useCallback(async (club: Club) => {
    const detail = await fetchClubDetail(club.id);
    setDetailClub(detail);
  }, [fetchClubDetail]);

  const refreshDetail = useCallback(async () => {
    if (!detailClub) return;
    const detail = await fetchClubDetail(detailClub.id);
    setDetailClub(detail);
    await fetchMyClub();
    fetchClubs(undefined, search);
  }, [detailClub, fetchClubDetail, fetchMyClub, fetchClubs, search]);

  const handleSearch = (text: string) => {
    setSearch(text);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      setLoading(true); setHasMore(true); fetchClubs(undefined, text);
    }, 400);
  };

  // ── Join ───────────────────────────────────────────────
  const handleJoin = useCallback(async (clubId: number) => {
    setJoining(clubId);
    try {
      const token = await getToken();
      const res   = await fetch(`${API_URL}/api/clubs/${clubId}/join`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) { Toast.show({ type: 'error', text1: data.error }); return; }
      setClubs(prev => prev.map(c =>
        c.id === clubId
          ? { ...c, isMember: true, myRole: 'member', memberCount: data.memberCount }
          : c,
      ));
      setDetailClub(prev =>
        prev?.id === clubId
          ? { ...prev, isMember: true, myRole: 'member', memberCount: data.memberCount }
          : prev,
      );
      await fetchMyClub();
      Toast.show({ type: 'success', text1: '✅ DOŁĄCZONO' });
    } catch {
      Toast.show({ type: 'error', text1: 'Błąd' });
    } finally {
      setJoining(null);
    }
  }, [fetchMyClub]);

  // ── Leave ──────────────────────────────────────────────
  const handleLeave = useCallback(async (clubId: number) => {
    Alert.alert('Opuść klub', 'Na pewno chcesz opuścić ten klub?', [
      { text: 'Anuluj', style: 'cancel' },
      { text: 'Opuść', style: 'destructive', onPress: async () => {
        setJoining(clubId);
        const token = await getToken();
        const res   = await fetch(`${API_URL}/api/clubs/${clubId}/leave`, {
          method: 'POST', headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json();
        if (!res.ok) { Toast.show({ type: 'error', text1: data.error }); setJoining(null); return; }
        setClubs(prev => prev.map(c =>
          c.id === clubId
            ? { ...c, isMember: false, myRole: null, memberCount: data.memberCount }
            : c,
        ));
        setDetailClub(prev =>
          prev?.id === clubId
            ? { ...prev, isMember: false, myRole: null, memberCount: data.memberCount }
            : prev,
        );
        await fetchMyClub();
        setJoining(null);
        Toast.show({ type: 'info', text1: 'Opuszczono klub' });
      }},
    ]);
  }, [fetchMyClub]);

  // ── Delete ─────────────────────────────────────────────
  const handleDelete = useCallback(async (clubId: number) => {
    Alert.alert('Usuń klub', 'Tej operacji nie można cofnąć.', [
      { text: 'Anuluj', style: 'cancel' },
      { text: 'Usuń', style: 'destructive', onPress: async () => {
        const token = await getToken();
        const res   = await fetch(`${API_URL}/api/clubs/${clubId}`, {
          method: 'DELETE', headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) { Toast.show({ type: 'error', text1: 'Błąd usuwania' }); return; }
        setClubs(prev => prev.filter(c => c.id !== clubId));
        setDetailClub(null);
        setMyOwnedClub(null);
        await fetchMyClub();
        Toast.show({ type: 'success', text1: 'Klub usunięty' });
      }},
    ]);
  }, [fetchMyClub]);

  // ── Create ─────────────────────────────────────────────
  const handleCreate = useCallback(async ({
    name, description, isPrivate, avatarUri,
  }: { name: string; description: string; isPrivate: boolean; avatarUri: string | null }) => {
    const token = await getToken();
    const form  = new FormData();
    form.append('name', name);
    form.append('description', description);
    form.append('isPrivate', String(isPrivate));
    if (avatarUri) {
      const ext = avatarUri.split('.').pop() ?? 'jpg';
      form.append('avatar', { uri: avatarUri, name: `avatar.${ext}`, type: `image/${ext}` } as any);
    }
    const res  = await fetch(`${API_URL}/api/clubs`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form,
    });
    const data = await res.json();
    if (!res.ok) { Toast.show({ type: 'error', text1: data.error }); return; }
    setClubs(prev => [data, ...prev]);
    setMyOwnedClub(data);
    setCreateVisible(false);
    Toast.show({ type: 'success', text1: '🏁 KLUB STWORZONY!', text2: data.name });
  }, []);

  // ─────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.bg }} edges={['top']}>

      {/* ── HEADER ──────────────────────────────────────── */}
      <View style={{
        flexDirection: 'row', alignItems: 'center',
        paddingHorizontal: 14, paddingVertical: 11,
        borderBottomWidth: 1, borderBottomColor: theme.border, gap: 10,
      }}>
        <TouchableOpacity onPress={() => router.back()} style={{ padding: 4 }}>
          <MaterialIcons name="arrow-back" size={22} color={theme.text} />
        </TouchableOpacity>

        {/* Zaproszenia */}
        <TouchableOpacity
          style={{ padding: 4, position: 'relative' }}
          onPress={() => setInvitesVisible(true)}
        >
          <MaterialIcons name="mail-outline" size={22} color={theme.textDim} />
          {inviteCount > 0 && (
            <View style={{
              position: 'absolute', top: 0, right: 0,
              width: 14, height: 14, borderRadius: 7,
              backgroundColor: '#e33835',
              alignItems: 'center', justifyContent: 'center',
            }}>
              <Text style={{ fontFamily: 'Orbitron', fontSize: 7, color: '#fff', fontWeight: '700' }}>
                {inviteCount}
              </Text>
            </View>
          )}
        </TouchableOpacity>

        {searchActive ? (
          <View style={{
            flex: 1, flexDirection: 'row', alignItems: 'center',
            backgroundColor: theme.surface, borderRadius: 11,
            paddingHorizontal: 11, paddingVertical: 7,
            gap: 7, borderWidth: 1, borderColor: theme.border2,
          }}>
            <MaterialIcons name="search" size={15} color={theme.textDim} />
            <TextInput
              style={{ flex: 1, color: theme.text, fontSize: 14 }}
              value={search}
              onChangeText={handleSearch}
              placeholder="Szukaj klubu..."
              placeholderTextColor={theme.textDim}
              autoFocus
            />
            <TouchableOpacity onPress={() => {
              setSearch(''); setSearchActive(false); setLoading(true); fetchClubs();
            }}>
              <MaterialIcons name="close" size={15} color={theme.textDim} />
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <Text style={{ flex: 1, fontFamily: 'Orbitron', color: theme.text, fontSize: 14, letterSpacing: 2 }}>
              KLUBY
            </Text>
            <TouchableOpacity onPress={() => setSearchActive(true)} style={{ padding: 4 }}>
              <MaterialIcons name="search" size={21} color={theme.textDim} />
            </TouchableOpacity>
          </>
        )}

        <TouchableOpacity
          style={{
            backgroundColor: '#e33835', borderRadius: 9,
            paddingHorizontal: 11, paddingVertical: 7,
            flexDirection: 'row', alignItems: 'center', gap: 4,
          }}
          onPress={() => {
            if (!isPremium && myOwnedClub) {
              router.push('/premium' as any);
              return;
            }
            setCreateVisible(true);
          }}
        >
          <MaterialIcons name="add" size={15} color="#fff" />
          <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: '#fff', fontWeight: '700' }}>NOWY</Text>
        </TouchableOpacity>
      </View>

      {/* ── MÓJ OWNED KLUB ──────────────────────────────── */}
      {myOwnedClub && (
        <TouchableOpacity
          style={{
            flexDirection: 'row', alignItems: 'center', gap: 10,
            marginHorizontal: 12, marginTop: 12,
            marginBottom: myMemberClubs.length > 0 ? 4 : 12,
            backgroundColor: '#e3383512', borderRadius: 13,
            padding: 11, borderWidth: 1, borderColor: '#e3383530',
          }}
          onPress={() => openDetail(myOwnedClub)}
          activeOpacity={0.85}
        >
          <View style={{
            width: 38, height: 38, borderRadius: 10, overflow: 'hidden',
            backgroundColor: '#e3383520', alignItems: 'center', justifyContent: 'center',
          }}>
            {myOwnedClub.avatarUrl
              ? <Image source={{ uri: myOwnedClub.avatarUrl }} style={{ width: 38, height: 38 }} />
              : <MaterialCommunityIcons name="shield-crown" size={18} color="#e33835" />
            }
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontFamily: 'Orbitron', fontSize: 7, color: '#e33835', letterSpacing: 2, marginBottom: 1 }}>
              TWÓJ KLUB
            </Text>
            <Text style={{ fontFamily: 'Orbitron', fontSize: 12, color: theme.text, fontWeight: '700' }}>
              {myOwnedClub.name}
            </Text>
            <Text style={{ fontFamily: 'Orbitron', fontSize: 7, color: theme.textDim, marginTop: 1 }}>
              {myOwnedClub.memberCount} członków · ZAŁOŻYCIEL
            </Text>
          </View>
          <TouchableOpacity
            style={{
              backgroundColor: '#e33835', borderRadius: 9,
              paddingHorizontal: 10, paddingVertical: 7,
              flexDirection: 'row', alignItems: 'center', gap: 4,
            }}
            onPress={() => router.push(`/Community/clubs/${myOwnedClub.id}` as any)}
          >
            <MaterialCommunityIcons name="chat" size={13} color="#fff" />
            <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: '#fff', fontWeight: '700' }}>CZAT</Text>
          </TouchableOpacity>
          <Feather name="chevron-right" size={15} color={theme.textDim} />
        </TouchableOpacity>
      )}

      {/* ── KLUBY W KTÓRYCH JESTEM CZŁONKIEM ────────────── */}
      {myMemberClubs.length > 0 && (
        <View style={{ marginHorizontal: 12, marginBottom: 8, marginTop: myOwnedClub ? 0 : 12 }}>
          <Text style={{
            fontFamily: 'Orbitron', fontSize: 7, color: theme.textDim,
            letterSpacing: 2, marginBottom: 6, marginTop: 4,
          }}>
            MOJE KLUBY ({myMemberClubs.length})
          </Text>
          {myMemberClubs.map(c => (
            <TouchableOpacity
              key={c.id}
              style={{
                flexDirection: 'row', alignItems: 'center', gap: 10,
                backgroundColor: theme.surface, borderRadius: 13,
                padding: 10, borderWidth: 1, borderColor: theme.border2,
                marginBottom: 6,
              }}
              onPress={() => openDetail(c)}
              activeOpacity={0.85}
            >
              <View style={{
                width: 34, height: 34, borderRadius: 9, overflow: 'hidden',
                backgroundColor: '#e3383518', alignItems: 'center', justifyContent: 'center',
                borderWidth: 1, borderColor: '#e3383530',
              }}>
                {c.avatarUrl
                  ? <Image source={{ uri: c.avatarUrl }} style={{ width: 34, height: 34 }} />
                  : <MaterialCommunityIcons name="shield-crown-outline" size={15} color="#e33835" />
                }
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{
                  fontFamily: 'Orbitron', fontSize: 11,
                  color: theme.text, fontWeight: '700',
                }} numberOfLines={1}>
                  {c.name}
                </Text>
                <Text style={{ fontFamily: 'Orbitron', fontSize: 7, color: theme.textDim, marginTop: 1 }}>
                  {c.memberCount} członków · {c.myRank ? c.myRank.name.toUpperCase() : 'CZŁONEK'}
                </Text>
              </View>
              <TouchableOpacity
                style={{
                  backgroundColor: theme.surface2, borderRadius: 8,
                  paddingHorizontal: 9, paddingVertical: 6,
                  flexDirection: 'row', alignItems: 'center', gap: 3,
                  borderWidth: 1, borderColor: theme.border2,
                }}
                onPress={() => router.push(`/Community/clubs/${c.id}` as any)}
              >
                <MaterialCommunityIcons name="chat" size={12} color={theme.textDim} />
                <Text style={{ fontFamily: 'Orbitron', fontSize: 7, color: theme.textDim }}>CZAT</Text>
              </TouchableOpacity>
              <Feather name="chevron-right" size={14} color={theme.textDim} />
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* ── LISTA KLUBÓW ────────────────────────────────── */}
      {loading ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <ActivityIndicator color="#e33835" size="large" />
        </View>
      ) : (
        <FlatList
          data={clubs}
          keyExtractor={c => String(c.id)}
          contentContainerStyle={{ paddingHorizontal: 12, paddingTop: 4, paddingBottom: 20 }}
          renderItem={({ item }) => (
            <ClubCard
              club={item}
              onPress={openDetail}
              onJoin={handleJoin}
              onLeave={handleLeave}
              joining={joining}
            />
          )}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true); setHasMore(true);
                fetchClubs(undefined, search); fetchMyClub();
              }}
              tintColor="#e33835"
            />
          }
          onEndReached={() => {
            if (!nextCursor || loadingMore || !hasMore) return;
            setLoadingMore(true); fetchClubs(nextCursor, search);
          }}
          onEndReachedThreshold={0.4}
          ListFooterComponent={loadingMore
            ? <ActivityIndicator color="#e33835" style={{ padding: 20 }} />
            : null
          }
          ListEmptyComponent={
            <View style={{ alignItems: 'center', marginTop: 80, gap: 14 }}>
              <MaterialCommunityIcons name="shield-crown-outline" size={52} color={theme.border3} />
              <Text style={{ fontFamily: 'Orbitron', color: theme.textDim, fontSize: 10, letterSpacing: 2 }}>
                {search ? 'BRAK WYNIKÓW' : 'BRAK KLUBÓW'}
              </Text>
              {!search && (
                <TouchableOpacity
                  style={{
                    backgroundColor: '#e33835', borderRadius: 12,
                    paddingHorizontal: 20, paddingVertical: 11,
                    flexDirection: 'row', alignItems: 'center', gap: 7,
                  }}
                  onPress={() => {
                    if (!isPremium && myOwnedClub) {
                      router.push('/premium' as any);
                      return;
                    }
                    setCreateVisible(true);
                  }}
                >
                  <MaterialIcons name="add" size={15} color="#fff" />
                  <Text style={{ fontFamily: 'Orbitron', fontSize: 10, color: '#fff', fontWeight: '700' }}>
                    STWÓRZ PIERWSZY KLUB
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          }
        />
      )}

      {/* ── MODALS ──────────────────────────────────────── */}
      <CreateClubModal
        visible={createVisible}
        onClose={() => setCreateVisible(false)}
        onCreate={handleCreate}
      />

      <ClubDetailModal
        club={detailClub}
        myId={myId}
        onClose={() => setDetailClub(null)}
        onJoin={handleJoin}
        onLeave={handleLeave}
        onDelete={handleDelete}
        onChatOpen={c => { setDetailClub(null); router.push(`/Community/clubs/${c.id}` as any); }}
        onRanksOpen={c => { setDetailClub(null); setTimeout(() => setRanksClub(c), 300); }}
        joining={joining}
        onRefresh={refreshDetail}
      />

      {ranksClub && (
        <RanksModal
          visible={!!ranksClub}
          onClose={() => setRanksClub(null)}
          clubId={ranksClub.id}
          ranks={ranksClub.ranks ?? []}
          onRefresh={async () => {
            const detail = await fetchClubDetail(ranksClub.id);
            setRanksClub(detail);
          }}
        />
      )}

      <MyInvitesModal
        visible={invitesVisible}
        onClose={() => { setInvitesVisible(false); fetchMyInviteCount(); }}
        onAccepted={(clubId) => {
          router.push(`/Community/clubs/${clubId}` as any);
          fetchClubs();
          fetchMyClub();
        }}
      />
    </SafeAreaView>
  );
}