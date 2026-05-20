import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, TextInput,
  ActivityIndicator, RefreshControl, Alert,
} from 'react-native';
import { SafeAreaView }       from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import MaterialIcons          from '@expo/vector-icons/MaterialIcons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Feather }            from '@expo/vector-icons';
import AsyncStorage           from '@react-native-async-storage/async-storage';
import Toast                  from 'react-native-toast-message';
import { useTheme }           from '../../../contexts/ThemeContext';
import { useEffectivePremium } from '../../../hooks/useEffectivePremium';
import { API_URL }            from '../../../constants/config';

import ClubCard               from '../../../components/clubs/ClubCard';
import CreateClubModal        from '../../../components/clubs/CreateClubModal';
import ClubDetailModal        from '../../../components/clubs/ClubDetailModal';
import { InviteModal }        from '../../../components/clubs/InviteModal';
import EditClubModal          from '../../../components/clubs/EditClubModal';
import RanksModal             from '../../../components/clubs/RanksModal';
import { Club }               from '../../../components/clubs/types';
import { MyInvitesModal }     from '../../../components/clubs/MyInvitesModal';
import { MyClubsModal }       from '../../../components/clubs/MyClubsModal';
import { syncProfileClubFromServer } from '../../../lib/profileClubSync';
import { getAuthToken } from '../../../lib/getAuthToken';
const PAGE     = 20;
type ClubSort  = 'created' | 'members';
/** iOS nie obsługuje dwóch Modal jednocześnie — zamknij szczegóły, potem otwórz drugi. */
const IOS_MODAL_SWAP_MS = 350;
type ClubDetailResult = {
  ok: boolean;
  status: number;
  club: Club | null;
  error?: string;
};

export default function ClubsScreen() {
  const router    = useRouter();
  const { theme } = useTheme();
  const { isPremium, refresh: refreshPremiumAccess } = useEffectivePremium();

  const [myId, setMyId] = useState<number | null>(null);

  const [clubs,       setClubs]       = useState<Club[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [refreshing,  setRefreshing]  = useState(false);
  const [nextCursor,  setNextCursor]  = useState<number | null>(null);
  const [nextSkip,    setNextSkip]    = useState<number | null>(null);
  const [clubSort,    setClubSort]    = useState<ClubSort>('created');
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore,     setHasMore]     = useState(true);
  const [search,      setSearch]      = useState('');
  const [searchActive, setSearchActive] = useState(false);
  const [joining,     setJoining]     = useState<number | null>(null);

  const [myOwnedClubs,   setMyOwnedClubs]   = useState<Club[]>([]);
  const [myMemberClubs,  setMyMemberClubs]  = useState<Club[]>([]);
  const [myClubsVisible, setMyClubsVisible] = useState(false);

  const [createVisible, setCreateVisible] = useState(false);
  const [detailClub,    setDetailClub]    = useState<Club | null>(null);
  const [ranksClub,     setRanksClub]     = useState<Club | null>(null);
  const [inviteClubId,  setInviteClubId]  = useState<number | null>(null);
  const [editClub,      setEditClub]      = useState<Club | null>(null);

  const [invitesVisible, setInvitesVisible] = useState(false);
  const [inviteCount,    setInviteCount]    = useState(0);

  const searchTimer = useRef<any>(null);

  useEffect(() => {
    AsyncStorage.getItem('user').then(raw => {
      if (!raw) return;
      try {
        const parsed = JSON.parse(raw);
        const id = Number(parsed?.userId ?? parsed?.id);
        if (Number.isFinite(id)) setMyId(id);
      } catch {
        setMyId(null);
      }
    }).catch(() => {});
  }, []);

  const applyClubList = useCallback((
    list: Club[],
    append: boolean,
    sortMode: ClubSort,
    data: { nextCursor?: number | null; nextSkip?: number | null },
  ) => {
    if (append) setClubs(prev => [...prev, ...list]);
    else setClubs(list);
    if (sortMode === 'members') {
      setNextCursor(null);
      setNextSkip(data.nextSkip ?? null);
      setHasMore(data.nextSkip != null);
    } else {
      setNextSkip(null);
      setNextCursor(data.nextCursor ?? null);
      setHasMore(!!data.nextCursor);
    }
  }, []);

  const fetchClubs = useCallback(async (opts?: {
    cursor?: number;
    skip?: number;
    q?: string;
    sortMode?: ClubSort;
    append?: boolean;
  }) => {
    const sortMode = opts?.sortMode ?? clubSort;
    const q = opts?.q ?? search;
    const append = !!opts?.append;
    try {
      const token  = await getAuthToken();
      const params = new URLSearchParams({ limit: String(PAGE), sort: sortMode });
      if (q) params.append('search', q);
      if (sortMode === 'members') {
        if (opts?.skip) params.append('skip', String(opts.skip));
      } else if (opts?.cursor) {
        params.append('cursor', String(opts.cursor));
      }
      const res  = await fetch(`${API_URL}/api/clubs?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      const list: Club[] = data.clubs ?? [];
      applyClubList(list, append, sortMode, data);
    } catch {
      Toast.show({ type: 'error', text1: 'Błąd ładowania klubów' });
    } finally {
      setLoading(false); setRefreshing(false); setLoadingMore(false);
    }
  }, [clubSort, search, applyClubList]);

  const reloadAllClubs = useCallback((sortMode?: ClubSort) => {
    setLoading(true);
    setHasMore(true);
    fetchClubs({ q: search, sortMode: sortMode ?? clubSort, append: false });
  }, [clubSort, search, fetchClubs]);

  const changeClubSort = useCallback((next: ClubSort) => {
    if (next === clubSort) return;
    setClubSort(next);
    setClubs([]);
    setLoading(true);
    setHasMore(true);
    fetchClubs({ q: search, sortMode: next, append: false });
  }, [clubSort, search, fetchClubs]);

  const fetchMyInviteCount = useCallback(async () => {
    try {
      const token = await getAuthToken();
      const res   = await fetch(`${API_URL}/api/clubs/invites/my`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) { const data = await res.json(); setInviteCount(data.length); }
    } catch {}
  }, []);

  // ── fetchMyClub — pobierz owned + member clubs ────────
  const fetchMyClub = useCallback(async () => {
    try {
      const token = await getAuthToken();
      const res   = await fetch(`${API_URL}/api/clubs/my/all`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const clubs: Club[] = await res.json();

      setMyOwnedClubs(clubs.filter(c => c.myRole === 'owner'));
      setMyMemberClubs(clubs.filter(c => c.myRole !== 'owner'));
    } catch {}
  }, []);

  const fetchClubDetail = useCallback(async (clubId: number) => {
    try {
      const token = await getAuthToken();
      if (!token) {
        return {
          ok: false,
          status: 401,
          club: null,
          error: 'Zaloguj się ponownie',
        } as ClubDetailResult;
      }

      const res = await fetch(`${API_URL}/api/clubs/${clubId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({} as any));
      if (!res.ok) {
        return {
          ok: false,
          status: res.status,
          club: null,
          error: typeof data?.error === 'string' ? data.error : 'Nie można otworzyć klubu',
        } as ClubDetailResult;
      }
      return {
        ok: true,
        status: res.status,
        club: data as Club,
      } as ClubDetailResult;
    } catch {
      return {
        ok: false,
        status: 0,
        club: null,
        error: 'Nie można połączyć się z serwerem',
      } as ClubDetailResult;
    }
  }, []);

  useFocusEffect(useCallback(() => {
    void refreshPremiumAccess();
    setLoading(true); setHasMore(true);
    reloadAllClubs('created');
    fetchMyClub();
    fetchMyInviteCount();
  }, [refreshPremiumAccess]));

  const openDetail = useCallback(async (club: Club) => {
    const isOwner = club.myRole === 'owner';
    if (club.isPrivate && !club.isMember && !isOwner) {
      Toast.show({
        type: 'info',
        text1: 'Klub prywatny',
        text2: 'Dołączenie wymaga zaproszenia od członka klubu',
      });
      return;
    }
    const detail = await fetchClubDetail(club.id);
    if (!detail.ok || !detail.club) {
      Toast.show({
        type: 'info',
        text1: 'Brak dostępu',
        text2: detail.error ?? 'Nie możesz otworzyć tego klubu',
      });
      return;
    }
    setDetailClub(detail.club);
  }, [fetchClubDetail]);

  const refreshDetail = useCallback(async () => {
    if (!detailClub) return;
    const detail = await fetchClubDetail(detailClub.id);
    if (!detail.ok || !detail.club) {
      setDetailClub(null);
      Toast.show({
        type: 'info',
        text1: 'Odświeżanie klubu',
        text2: detail.error ?? 'Nie można odświeżyć szczegółów',
      });
      return;
    }
    setDetailClub(detail.club);
    await fetchMyClub();
    fetchClubs({ q: search, append: false });
  }, [detailClub, fetchClubDetail, fetchMyClub, fetchClubs, search]);

  const handleSearch = (text: string) => {
    setSearch(text);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      setLoading(true); setHasMore(true); fetchClubs({ q: text, sortMode: clubSort, append: false });
    }, 400);
  };

  // ── Join ───────────────────────────────────────────────
  const handleJoin = useCallback(async (clubId: number) => {
    setJoining(clubId);
    try {
      const token = await getAuthToken();
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
      await Promise.all([fetchMyClub(), syncProfileClubFromServer()]);
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
        const token = await getAuthToken();
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
        await Promise.all([fetchMyClub(), syncProfileClubFromServer()]);
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
        const token = await getAuthToken();
        const res   = await fetch(`${API_URL}/api/clubs/${clubId}`, {
          method: 'DELETE', headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) { Toast.show({ type: 'error', text1: 'Błąd usuwania' }); return; }
        setClubs(prev => prev.filter(c => c.id !== clubId));
        setDetailClub(null);
        await Promise.all([fetchMyClub(), syncProfileClubFromServer()]);
        Toast.show({ type: 'success', text1: 'Klub usunięty' });
      }},
    ]);
  }, [fetchMyClub]);

  // ── Create ─────────────────────────────────────────────
  const handleCreate = useCallback(async ({
    name, description, isPrivate, avatarUri,
  }: { name: string; description: string; isPrivate: boolean; avatarUri: string | null }) => {
    const token = await getAuthToken();
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
    setCreateVisible(false);
    void fetchMyClub();
    await syncProfileClubFromServer();
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
              setSearch(''); setSearchActive(false); reloadAllClubs();
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
            if (!isPremium && myOwnedClubs.length > 0) {
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

      {/* ── MOJE KLUBY (przycisk → modal) ───────────────── */}
      <TouchableOpacity
        style={{
          flexDirection: 'row', alignItems: 'center', gap: 8,
          marginHorizontal: 12, marginTop: 10, marginBottom: 4,
          backgroundColor: theme.surface, borderRadius: 12,
          paddingVertical: 11, paddingHorizontal: 14,
          borderWidth: 1, borderColor: theme.border2,
        }}
        onPress={() => setMyClubsVisible(true)}
        activeOpacity={0.88}
      >
        <MaterialCommunityIcons name="shield-account" size={18} color="#e33835" />
        <Text style={{ flex: 1, fontFamily: 'Orbitron', fontSize: 10, color: theme.text, fontWeight: '700', letterSpacing: 1 }}>
          MOJE KLUBY
        </Text>
        <View style={{
          backgroundColor: '#e3383520', borderRadius: 8,
          paddingHorizontal: 8, paddingVertical: 3,
          borderWidth: 1, borderColor: '#e3383540',
        }}>
          <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: '#e33835', fontWeight: '700' }}>
            {myOwnedClubs.length + myMemberClubs.length}
          </Text>
        </View>
        <Feather name="chevron-right" size={16} color={theme.textDim} />
      </TouchableOpacity>

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
          ListHeaderComponent={(
            <View style={{ marginBottom: 10 }}>
              <Text style={{
                fontFamily: 'Orbitron', fontSize: 7, color: theme.textDim,
                letterSpacing: 2, marginBottom: 8,
              }}>
                WSZYSTKIE KLUBY
              </Text>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {([
                  { key: 'created' as ClubSort, label: 'DATA UTWORZENIA' },
                  { key: 'members' as ClubSort, label: 'CZŁONKOWIE' },
                ]).map(({ key, label }) => {
                  const active = clubSort === key;
                  return (
                    <TouchableOpacity
                      key={key}
                      onPress={() => changeClubSort(key)}
                      style={{
                        flex: 1, paddingVertical: 9, borderRadius: 10, alignItems: 'center',
                        backgroundColor: active ? '#e33835' : theme.surface2,
                        borderWidth: 1,
                        borderColor: active ? '#e33835' : theme.border2,
                      }}
                    >
                      <Text style={{
                        fontFamily: 'Orbitron', fontSize: 7, fontWeight: '700',
                        color: active ? '#fff' : theme.textDim,
                        letterSpacing: 0.5,
                      }}>
                        {label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          )}
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
                fetchClubs({ q: search, sortMode: clubSort, append: false });
                fetchMyClub();
              }}
              tintColor="#e33835"
            />
          }
          onEndReached={() => {
            if (loadingMore || !hasMore) return;
            if (clubSort === 'members') {
              if (nextSkip == null) return;
              setLoadingMore(true);
              fetchClubs({ skip: nextSkip, q: search, sortMode: 'members', append: true });
              return;
            }
            if (!nextCursor) return;
            setLoadingMore(true);
            fetchClubs({ cursor: nextCursor, q: search, sortMode: 'created', append: true });
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
                    if (!isPremium && myOwnedClubs.length > 0) {
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
        onRanksOpen={c => { setDetailClub(null); setTimeout(() => setRanksClub(c), IOS_MODAL_SWAP_MS); }}
        onInviteRequest={c => {
          setDetailClub(null);
          setTimeout(() => setInviteClubId(c.id), IOS_MODAL_SWAP_MS);
        }}
        onEditRequest={async c => {
          setDetailClub(null);
          const detail = await fetchClubDetail(c.id);
          if (!detail.ok || !detail.club) {
            Toast.show({
              type: 'error',
              text1: 'Błąd',
              text2: detail.error ?? 'Nie można otworzyć ustawień klubu',
            });
            return;
          }
          setTimeout(() => setEditClub(detail.club), IOS_MODAL_SWAP_MS);
        }}
        joining={joining}
        onRefresh={refreshDetail}
      />

      <InviteModal
        visible={inviteClubId != null}
        clubId={inviteClubId ?? 0}
        onClose={() => {
          setInviteClubId(null);
          fetchMyClub();
          fetchClubs({ q: search, sortMode: clubSort, append: false });
        }}
      />

      <EditClubModal
        visible={!!editClub}
        club={editClub}
        channels={editClub?.channels ?? []}
        onClose={() => setEditClub(null)}
        onUpdated={(updated) => {
          setEditClub(null);
          if (detailClub?.id === updated.id) setDetailClub(updated);
          fetchMyClub();
          fetchClubs({ q: search, sortMode: clubSort, append: false });
        }}
      />

      {ranksClub && (
        <RanksModal
          visible={!!ranksClub}
          onClose={() => setRanksClub(null)}
          clubId={ranksClub.id}
          ranks={ranksClub.ranks ?? []}
          onRefresh={async () => {
            const detail = await fetchClubDetail(ranksClub.id);
            if (!detail.ok || !detail.club) {
              setRanksClub(null);
              Toast.show({
                type: 'info',
                text1: 'Brak dostępu',
                text2: detail.error ?? 'Nie można odświeżyć rang',
              });
              return;
            }
            setRanksClub(detail.club);
          }}
        />
      )}

      <MyInvitesModal
        visible={invitesVisible}
        onClose={() => { setInvitesVisible(false); fetchMyInviteCount(); }}
        onAccepted={(clubId) => {
          router.push(`/Community/clubs/${clubId}` as any);
          reloadAllClubs();
          fetchMyClub();
        }}
      />

      <MyClubsModal
        visible={myClubsVisible}
        ownedClubs={myOwnedClubs}
        memberClubs={myMemberClubs}
        onClose={() => setMyClubsVisible(false)}
        onOpenClub={(club) => {
          setMyClubsVisible(false);
          void openDetail(club);
        }}
        onOpenChat={(clubId) => {
          setMyClubsVisible(false);
          router.push(`/Community/clubs/${clubId}` as any);
        }}
      />
    </SafeAreaView>
  );
}