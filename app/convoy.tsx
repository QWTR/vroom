import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, AppState, ScrollView, Share, StyleSheet, TouchableOpacity, View } from 'react-native';
import { AppText as Text, AppTextInput as TextInput } from '../components/ui/AppText';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Linking from 'expo-linking';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Toast from 'react-native-toast-message';
import { useTheme } from '../contexts/ThemeContext';
import { usePremium } from '../contexts/PremiumContext';
import { apiRequest } from '../lib/api/client';
import { ensureSharedSocket } from '../lib/sharedSocket';
import { BG_ACTIVE_CONVOY_HOST_KEY, BG_ACTIVE_CONVOY_ID_KEY } from '../hooks/useBackgroundTracking';
import { PremiumAvatar, PremiumName } from '../components/user/PremiumIdentity';
import type { ConvoyParticipant as Participant, ConvoySnapshot as Snapshot } from '../lib/convoyLive';

type RouteOption = { id: number; name: string };
type FriendOption = { id: number; username: string; avatarUrl?: string | null };
type VoiceMode = 'open' | 'cb' | 'moderated';
type AdmissionMode = 'instant' | 'lobby';
const STATUSES = [['ok', 'OK'], ['fuel', 'TANKOWANIE'], ['stop', 'POSTÓJ'], ['lost', 'ZGUBIŁEM GRUPĘ'], ['problem', 'PROBLEM']] as const;

function readStoredUserId(raw: string | null) {
  try { const value = raw ? JSON.parse(raw) : null; return Number(value?.userId ?? value?.id) || null; } catch { return null; }
}

export default function ConvoyScreen() {
  const { theme } = useTheme();
  const { isPremium } = usePremium();
  const router = useRouter();
  const params = useLocalSearchParams<{ code?: string }>();
  const [myId, setMyId] = useState<number | null>(null);
  const [name, setName] = useState('Mój konwój');
  const [code, setCode] = useState(String(params.code || '').toUpperCase());
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [routes, setRoutes] = useState<RouteOption[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [voiceMode, setVoiceMode] = useState<VoiceMode>('open');
  const [admissionMode, setAdmissionMode] = useState<AdmissionMode>('instant');
  const [friends, setFriends] = useState<FriendOption[]>([]);
  const [waitingApproval, setWaitingApproval] = useState(false);
  const watcher = useRef<Location.LocationSubscription | null>(null);
  const lastPosition = useRef<any>(null);
  const socketCleanup = useRef<(() => void) | null>(null);

  const stopForegroundLocation = useCallback(() => { watcher.current?.remove(); watcher.current = null; }, []);
  const startForegroundLocation = useCallback(async () => {
    if (watcher.current) return;
    const permission = await Location.requestForegroundPermissionsAsync();
    if (!permission.granted) return;
    const socket = await ensureSharedSocket();
    watcher.current = await Location.watchPositionAsync({ accuracy: Location.Accuracy.Balanced, distanceInterval: 10, timeInterval: 1000 }, (location) => {
      const payload = { lat: location.coords.latitude, lng: location.coords.longitude, heading: location.coords.heading, speedKmh: Math.max(0, Number(location.coords.speed || 0) * 3.6), foreground: true };
      lastPosition.current = payload;
      socket?.emit('convoy:position', payload);
    });
  }, []);

  const connect = useCallback(async (value: Snapshot) => {
    setSnapshot(value);
    const host = myId === value.convoy.hostId;
    if (value.convoy.status === 'active' && (isPremium || host)) {
      await AsyncStorage.multiSet([[BG_ACTIVE_CONVOY_ID_KEY, value.convoy.id], [BG_ACTIVE_CONVOY_HOST_KEY, host ? 'true' : 'false']]);
    }
    const socket = await ensureSharedSocket();
    if (!socket || value.convoy.status !== 'active') return;
    socket.emit('convoy:join', { convoyId: value.convoy.id });
    const onSnapshot = (next: Snapshot) => setSnapshot(next);
    const onPosition = (position: any) => setSnapshot((prev) => prev ? { ...prev, participants: prev.participants.map((p) => p.userId === position.userId ? { ...p, position, connection: 'live' } : p) } : prev);
    const onStatus = (status: any) => setSnapshot((prev) => prev ? { ...prev, participants: prev.participants.map((p) => p.userId === status.userId ? { ...p, ...(status.status ? { quickStatus: status.status } : {}), ...(status.connection ? { connection: status.connection } : {}) } : p) } : prev);
    const onLeave = ({ userId }: any) => {
      if (Number(userId) === myId) {
        stopForegroundLocation();
        void AsyncStorage.multiRemove([BG_ACTIVE_CONVOY_ID_KEY, BG_ACTIVE_CONVOY_HOST_KEY]);
        setSnapshot(null);
        Toast.show({ type: 'info', text1: 'Nie jesteś już w konwoju' });
        return;
      }
      setSnapshot((prev) => prev ? { ...prev, participants: prev.participants.filter((p) => p.userId !== Number(userId)) } : prev);
    };
    const onEnd = () => { stopForegroundLocation(); void AsyncStorage.multiRemove([BG_ACTIVE_CONVOY_ID_KEY, BG_ACTIVE_CONVOY_HOST_KEY]); setSnapshot((prev) => prev ? { ...prev, convoy: { ...prev.convoy, status: 'ended' } } : prev); };
    socket.on('convoy:snapshot', onSnapshot); socket.on('convoy:position', onPosition); socket.on('convoy:status', onStatus); socket.on('convoy:leave', onLeave); socket.on('convoy:kick', onLeave); socket.on('convoy:end', onEnd);
    socketCleanup.current?.();
    socketCleanup.current = () => { socket.off('convoy:snapshot', onSnapshot); socket.off('convoy:position', onPosition); socket.off('convoy:status', onStatus); socket.off('convoy:leave', onLeave); socket.off('convoy:kick', onLeave); socket.off('convoy:end', onEnd); };
    await startForegroundLocation();
  }, [isPremium, myId, startForegroundLocation, stopForegroundLocation]);

  useEffect(() => {
    AsyncStorage.getItem('user').then((raw) => setMyId(readStoredUserId(raw)));
    apiRequest<RouteOption[]>('/routes/my').then(setRoutes).catch(() => setRoutes([]));
    apiRequest<FriendOption[]>('/chat/friends').then(setFriends).catch(() => setFriends([]));
  }, []);
  useEffect(() => {
    const incomingCode = Array.isArray(params.code) ? params.code[0] : params.code;
    if (incomingCode) setCode(String(incomingCode).trim().toUpperCase());
  }, [params.code]);
  useEffect(() => {
    if (myId == null) return;
    apiRequest<Snapshot>('/convoys/active/me').then(connect).catch(() => {});
  }, [connect, myId]);
  useEffect(() => {
    if (!waitingApproval || myId == null) return;
    const timer = setInterval(() => {
      void apiRequest<Snapshot>('/convoys/active/me').then((next) => {
        setWaitingApproval(false);
        void connect(next);
      }).catch(() => {});
    }, 4_000);
    return () => clearInterval(timer);
  }, [connect, myId, waitingApproval]);
  useEffect(() => {
    const sub = AppState.addEventListener('change', async (state) => {
      if (!snapshot || snapshot.convoy.status !== 'active') return;
      if (state === 'active') await startForegroundLocation();
      else if (!isPremium && myId !== snapshot.convoy.hostId) {
        const socket = await ensureSharedSocket();
        if (lastPosition.current) socket?.emit('convoy:position', { ...lastPosition.current, foreground: false });
        stopForegroundLocation();
      }
    });
    return () => sub.remove();
  }, [isPremium, myId, snapshot, startForegroundLocation, stopForegroundLocation]);
  useEffect(() => () => { stopForegroundLocation(); socketCleanup.current?.(); }, [stopForegroundLocation]);

  const create = async (routeId?: number) => {
    setBusy(true); setError('');
    try { const created = await apiRequest<{ convoy: { id: string } }>('/convoys', { method: 'POST', body: { name, routeId, voiceEnabled: true, voiceMode, admissionMode } }); await connect(await apiRequest<Snapshot>(`/convoys/${created.convoy.id}`)); }
    catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };
  const joinConfirmed = async () => {
    setBusy(true); setError('');
    try {
      const joined = await apiRequest<{ convoy: { id: string }; waiting?: boolean }>('/convoys/join', { method: 'POST', body: { code: code.trim().toUpperCase(), shareLocationConsent: true } });
      if (joined.waiting) {
        setWaitingApproval(true);
        Alert.alert('Jesteś w poczekalni', 'Prowadzący lub moderator musi zaakceptować Twoje wejście. Ekran odświeży się automatycznie.');
      } else await connect(await apiRequest<Snapshot>(`/convoys/${joined.convoy.id}`));
    }
    catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };
  const join = () => Alert.alert('Udostępnianie pozycji', 'Po dołączeniu uczestnicy tego konwoju zobaczą Twoją bieżącą pozycję. Opuszczenie konwoju natychmiast zatrzyma publikację.', [{ text: 'Anuluj', style: 'cancel' }, { text: 'Zgadzam się i dołączam', onPress: () => void joinConfirmed() }]);
  const sendStatus = async (status: string) => (await ensureSharedSocket())?.emit('convoy:status', { status });
  const leave = async () => { if (!snapshot) return; await apiRequest(`/convoys/${snapshot.convoy.id}/leave`, { method: 'POST' }); stopForegroundLocation(); await AsyncStorage.multiRemove([BG_ACTIVE_CONVOY_ID_KEY, BG_ACTIVE_CONVOY_HOST_KEY]); setSnapshot(null); };
  const end = () => snapshot && Alert.alert('Zakończyć konwój?', 'Pozycje wszystkich uczestników przestaną być publikowane.', [{ text: 'Anuluj', style: 'cancel' }, { text: 'Zakończ', style: 'destructive', onPress: async () => { await apiRequest(`/convoys/${snapshot.convoy.id}/end`, { method: 'POST' }); stopForegroundLocation(); await AsyncStorage.multiRemove([BG_ACTIVE_CONVOY_ID_KEY, BG_ACTIVE_CONVOY_HOST_KEY]); setSnapshot(null); Toast.show({ type: 'success', text1: 'Konwój zakończony' }); } }]);
  const kick = (participant: Participant) => snapshot && Alert.alert('Usuń uczestnika?', participant.user.username, [{ text: 'Anuluj', style: 'cancel' }, { text: 'Usuń', style: 'destructive', onPress: () => apiRequest(`/convoys/${snapshot.convoy.id}/kick/${participant.userId}`, { method: 'POST' }).then(() => setSnapshot((prev) => prev ? { ...prev, participants: prev.participants.filter((p) => p.userId !== participant.userId) } : prev)) }]);
  const setMeetingHere = async () => { if (!snapshot) return; const current = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }); await apiRequest(`/convoys/${snapshot.convoy.id}`, { method: 'PATCH', body: { meetingLat: current.coords.latitude, meetingLng: current.coords.longitude } }); Toast.show({ type: 'success', text1: 'Punkt zbiórki ustawiony' }); };
  const selectRoute = (routeId: number | null) => snapshot && apiRequest(`/convoys/${snapshot.convoy.id}`, { method: 'PATCH', body: { routeId } }).then(() => apiRequest<Snapshot>(`/convoys/${snapshot.convoy.id}`)).then(connect);
  const refreshSnapshot = () => snapshot ? apiRequest<Snapshot>(`/convoys/${snapshot.convoy.id}`).then(connect) : Promise.resolve();
  const updateRadioSettings = async (patch: { voiceMode?: VoiceMode; admissionMode?: AdmissionMode; voiceEnabled?: boolean }) => {
    if (!snapshot) return;
    await apiRequest(`/convoys/${snapshot.convoy.id}/radio`, { method: 'PATCH', body: patch });
    await refreshSnapshot();
  };
  const admit = async (userId: number, approve: boolean) => {
    if (!snapshot) return;
    await apiRequest(`/convoys/${snapshot.convoy.id}/admission/${userId}`, { method: 'POST', body: { approve } });
    await refreshSnapshot();
  };
  const inviteFriend = async (friend: FriendOption) => {
    if (!snapshot) return;
    await apiRequest(`/convoys/${snapshot.convoy.id}/invites`, { method: 'POST', body: { userId: friend.id } });
    Toast.show({ type: 'success', text1: `Zaproszono: ${friend.username}` });
  };
  const setModerator = async (participant: Participant, moderator: boolean) => {
    if (!snapshot) return;
    await apiRequest(`/convoys/${snapshot.convoy.id}/moderators/${participant.userId}`, { method: 'POST', body: { moderator } });
    await refreshSnapshot();
  };
  const setVoiceMuted = async (participant: Participant, muted: boolean) => {
    if (!snapshot) return;
    await apiRequest(`/convoys/${snapshot.convoy.id}/voice/${participant.userId}/mute`, { method: 'POST', body: { muted } });
    await refreshSnapshot();
  };
  const shareInvite = async () => {
    if (!snapshot) return;
    const deepLink = Linking.createURL('/convoy', { queryParams: { code: snapshot.convoy.code } });
    await Share.share({
      message: `Dołącz do mojego konwoju w VROOM.\nKod: ${snapshot.convoy.code}\n${deepLink}`,
    });
  };
  const openLiveMap = () => router.replace({ pathname: '/(tabs)/map', params: { convoy: 'active' } } as any);

  const isHost = snapshot != null && myId === snapshot.convoy.hostId;
  const myParticipant = snapshot?.participants.find((participant) => participant.userId === myId);
  const canModerate = isHost || myParticipant?.role === 'moderator';
  const participantMenu = (participant: Participant) => {
    if (!snapshot || !canModerate || participant.userId === myId) return;
    const actions: any[] = [];
    if (isHost) actions.push({ text: participant.role === 'moderator' ? 'Odbierz moderatora' : 'Nadaj moderatora', onPress: () => void setModerator(participant, participant.role !== 'moderator') });
    actions.push({ text: participant.voiceMuted ? 'Odblokuj głos' : 'Wycisz głos w pokoju', onPress: () => void setVoiceMuted(participant, !participant.voiceMuted) });
    actions.push({ text: 'Usuń z konwoju', style: 'destructive', onPress: () => kick(participant) });
    actions.push({ text: 'Anuluj', style: 'cancel' });
    Alert.alert(participant.user.username, 'Zarządzanie uczestnikiem', actions);
  };
  return <SafeAreaView style={[styles.safe, { backgroundColor: theme.bg }]}>
    <View style={styles.header}><TouchableOpacity onPress={() => router.back()}><MaterialIcons name="arrow-back" size={24} color={theme.text} /></TouchableOpacity><Text style={[styles.title, { color: theme.text }]}>CONVOY LIVE</Text><View style={{ width: 24 }} /></View>
    {!snapshot ? <ScrollView contentContainerStyle={styles.content}>
      <View style={[styles.joinCard, { backgroundColor: theme.surface, borderColor: '#FFD44755' }]}>
        <View style={styles.joinHeading}><MaterialIcons name="group" size={24} color="#FFD447" /><View style={{ flex: 1 }}><Text style={[styles.convoyName, { color: theme.text }]}>DOŁĄCZ DO EKIPY</Text><Text style={[styles.joinHint, { color: theme.textDim }]}>Działa również na koncie Free. Wpisz kod otrzymany od prowadzącego.</Text></View></View>
        <TextInput value={code} onChangeText={(value) => setCode(value.replace(/[^a-zA-Z0-9]/g, '').toUpperCase())} autoCapitalize="characters" autoCorrect={false} maxLength={8} placeholder="WPISZ 8-ZNAKOWY KOD" placeholderTextColor={theme.textDim} style={[styles.codeInput, { color: theme.text, borderColor: code.length >= 6 ? '#FFD447' : theme.border, backgroundColor: theme.bg }]} />
        <TouchableOpacity onPress={join} disabled={busy || code.length < 6} style={[styles.primary, (busy || code.length < 6) && styles.disabled]}>{busy ? <ActivityIndicator color="#111" /> : <Text style={styles.primaryText}>DOŁĄCZ DO KONWOJU</Text>}</TouchableOpacity>
        <Text style={[styles.privacy, { color: theme.textDim }]}>Przed dołączeniem poprosimy o jednorazową zgodę na pokazanie Twojej pozycji tej grupie.</Text>
      </View>

      {isPremium ? <View style={[styles.hostCard, { borderColor: theme.border }]}>
        <Text style={[styles.label, { color: theme.text }]}>PROWADZENIE · PREMIUM</Text>
        <Text style={[styles.joinHint, { color: theme.textDim }]}>Utwórz własny pokój, a następnie wyślij ekipie kod lub link.</Text>
        <TextInput value={name} onChangeText={setName} placeholder="Nazwa konwoju" placeholderTextColor={theme.textDim} style={[styles.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.surface }]} />
        <Text style={[styles.label, { color: theme.text }]}>TRYB ROZMOWY</Text>
        <View style={styles.optionRow}>{([['open', 'OTWARTY · 8'], ['cb', 'CB · 1'], ['moderated', 'MODEROWANY']] as const).map(([value, label]) => <TouchableOpacity key={value} onPress={() => setVoiceMode(value)} style={[styles.optionChip, { borderColor: voiceMode === value ? '#18D7A0' : theme.border }, voiceMode === value && styles.optionSelected]}><Text style={{ color: voiceMode === value ? '#071510' : theme.text, fontSize: 10, fontWeight: '900' }}>{label}</Text></TouchableOpacity>)}</View>
        <Text style={[styles.label, { color: theme.text }]}>WEJŚCIE DO POKOJU</Text>
        <View style={styles.optionRow}>{([['instant', 'OD RAZU'], ['lobby', 'POCZEKALNIA']] as const).map(([value, label]) => <TouchableOpacity key={value} onPress={() => setAdmissionMode(value)} style={[styles.optionChip, { borderColor: admissionMode === value ? '#FFD447' : theme.border }, admissionMode === value && styles.optionSelectedYellow]}><Text style={{ color: admissionMode === value ? '#181300' : theme.text, fontSize: 10, fontWeight: '900' }}>{label}</Text></TouchableOpacity>)}</View>
        <TouchableOpacity onPress={() => void create()} disabled={busy} style={[styles.secondary, { borderColor: '#FFD447' }]}><Text style={{ color: '#FFD447', fontWeight: '900' }}>UTWÓRZ KONWÓJ</Text></TouchableOpacity>
        {routes.length > 0 && <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 7 }}>{routes.map((route) => <TouchableOpacity key={route.id} onPress={() => void create(route.id)} style={[styles.chip, { borderColor: theme.border }]}><Text style={{ color: theme.text, fontSize: 12 }}>START Z: {route.name}</Text></TouchableOpacity>)}</ScrollView>}
      </View> : <View style={[styles.freeInfo, { borderColor: theme.border }]}><MaterialIcons name="info-outline" size={18} color={theme.textDim} /><Text style={[styles.joinHint, { color: theme.textDim, flex: 1 }]}>Konto Free może dołączać i działa live przy otwartej aplikacji. W tle pozycja zostanie oznaczona jako wstrzymana.</Text></View>}
      {!!error && <Text style={styles.error}>{error}</Text>}
      {waitingApproval && <View style={[styles.freeInfo, { borderColor: '#FFD447' }]}><ActivityIndicator color="#FFD447" /><Text style={[styles.joinHint, { color: theme.text, flex: 1 }]}>Czekasz na akceptację prowadzącego lub moderatora.</Text></View>}
    </ScrollView> : <ScrollView contentContainerStyle={styles.content}>
      <View style={[styles.codeCard, { backgroundColor: theme.surface, borderColor: '#FFD44755' }]}><Text style={[styles.convoyName, { color: theme.text }]}>{snapshot.convoy.name}</Text><Text style={styles.code}>{snapshot.convoy.code}</Text><TouchableOpacity onPress={() => void shareInvite()}><Text style={styles.share}>WYŚLIJ KOD I LINK</Text></TouchableOpacity></View>
      <TouchableOpacity onPress={openLiveMap} style={styles.mapButton}><MaterialIcons name="map" size={20} color="#111" /><View><Text style={styles.mapButtonTitle}>OTWÓRZ MAPĘ LIVE</Text><Text style={styles.mapButtonSub}>Zobacz trasę, punkt zbiórki i pozycje całej ekipy</Text></View><MaterialIcons name="chevron-right" size={22} color="#111" /></TouchableOpacity>
      {isHost && <View style={[styles.radioSettings, { borderColor: theme.border, backgroundColor: theme.surface }]}><Text style={[styles.label, { color: theme.text, marginTop: 0 }]}>VROOM CB · USTAWIENIA POKOJU</Text><View style={styles.optionRow}>{([['open', 'OTWARTY · 8'], ['cb', 'CB · 1'], ['moderated', 'MODEROWANY']] as const).map(([value, label]) => <TouchableOpacity key={value} onPress={() => void updateRadioSettings({ voiceMode: value })} style={[styles.optionChip, { borderColor: snapshot.convoy.voiceMode === value ? '#18D7A0' : theme.border }, snapshot.convoy.voiceMode === value && styles.optionSelected]}><Text style={{ color: snapshot.convoy.voiceMode === value ? '#071510' : theme.text, fontSize: 10, fontWeight: '900' }}>{label}</Text></TouchableOpacity>)}</View><View style={styles.optionRow}>{([['instant', 'WEJŚCIE OD RAZU'], ['lobby', 'POCZEKALNIA']] as const).map(([value, label]) => <TouchableOpacity key={value} onPress={() => void updateRadioSettings({ admissionMode: value })} style={[styles.optionChip, { borderColor: snapshot.convoy.admissionMode === value ? '#FFD447' : theme.border }, snapshot.convoy.admissionMode === value && styles.optionSelectedYellow]}><Text style={{ color: snapshot.convoy.admissionMode === value ? '#181300' : theme.text, fontSize: 10, fontWeight: '900' }}>{label}</Text></TouchableOpacity>)}</View></View>}
      {canModerate && (snapshot.waiting?.length || 0) > 0 && <View style={[styles.radioSettings, { borderColor: '#FFD44766' }]}><Text style={[styles.label, { color: theme.text, marginTop: 0 }]}>POCZEKALNIA · {snapshot.waiting?.length}</Text>{snapshot.waiting?.map((participant) => <View key={participant.userId} style={styles.waitingRow}><PremiumAvatar user={participant.user} size={30} /><PremiumName user={participant.user} style={{ color: theme.text, flex: 1 }} /><TouchableOpacity onPress={() => void admit(participant.userId, false)}><MaterialIcons name="close" size={22} color="#ff6b6b" /></TouchableOpacity><TouchableOpacity onPress={() => void admit(participant.userId, true)}><MaterialIcons name="check-circle" size={23} color="#18D7A0" /></TouchableOpacity></View>)}</View>}
      {canModerate && friends.length > 0 && <View style={[styles.radioSettings, { borderColor: theme.border }]}><Text style={[styles.label, { color: theme.text, marginTop: 0 }]}>ZAPROŚ ZNAJOMEGO</Text><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>{friends.map((friend) => <TouchableOpacity key={friend.id} onPress={() => void inviteFriend(friend)} style={[styles.friendChip, { borderColor: theme.border }]}><PremiumAvatar user={friend as any} size={27} /><Text numberOfLines={1} style={{ color: theme.text, fontSize: 11, maxWidth: 92 }}>{friend.username}</Text><MaterialIcons name="person-add" size={16} color="#FFD447" /></TouchableOpacity>)}</ScrollView></View>}
      {isHost && <View style={styles.hostActions}><TouchableOpacity onPress={() => void setMeetingHere()} style={[styles.chip, { borderColor: theme.border }]}><Text style={{ color: theme.text, fontSize: 12 }}>PUNKT ZBIÓRKI: TU</Text></TouchableOpacity>{routes.map((route) => <TouchableOpacity key={route.id} onPress={() => void selectRoute(route.id)} style={[styles.chip, { borderColor: snapshot.convoy.route?.id === route.id ? '#FFD447' : theme.border }]}><Text style={{ color: theme.text, fontSize: 12 }}>{route.name}</Text></TouchableOpacity>)}</View>}
      <Text style={[styles.label, { color: theme.text }]}>UCZESTNICY · {snapshot.participants.length}/50</Text><Text style={[styles.joinHint, { color: theme.textDim }]}>Na mapie żółty punkt oznacza prowadzącego, niebieskie punkty uczestników, a pomarańczowy — osobę wstrzymaną. Dotknij osoby, aby nią zarządzać.</Text>{snapshot.participants.map((participant) => <TouchableOpacity disabled={!canModerate || participant.userId === myId} onPress={() => participantMenu(participant)} key={participant.userId} style={[styles.person, { borderColor: theme.border }]}><PremiumAvatar user={participant.user} size={32} /><PremiumName user={participant.user} style={{ color: theme.text, flex: 1 }} /><Text style={{ color: participant.connection === 'paused' ? '#ff922b' : participant.userId === snapshot.convoy.hostId ? '#FFD447' : participant.role === 'moderator' ? '#18D7A0' : '#31c8ff', fontSize: 12 }}>{participant.connection === 'paused' ? 'WSTRZYMANY' : participant.userId === snapshot.convoy.hostId ? 'PROWADZĄCY' : participant.role === 'moderator' ? 'MODERATOR' : participant.quickStatus?.toUpperCase() ?? 'LIVE'}</Text></TouchableOpacity>)}
      <View style={styles.statuses}>{STATUSES.map(([value, label]) => <TouchableOpacity key={value} onPress={() => void sendStatus(value)} style={[styles.status, { borderColor: theme.border }]}><Text style={{ color: theme.text, fontSize: 12, fontWeight: '800' }}>{label}</Text></TouchableOpacity>)}</View>{isHost ? <TouchableOpacity onPress={end}><Text style={styles.leave}>ZAKOŃCZ KONWÓJ</Text></TouchableOpacity> : <TouchableOpacity onPress={() => void leave()}><Text style={styles.leave}>OPUŚĆ KONWÓJ</Text></TouchableOpacity>}
    </ScrollView>}
  </SafeAreaView>;
}

const styles = StyleSheet.create({ safe: { flex: 1 }, header: { height: 56, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, title: { fontFamily: 'Manrope_700Bold', fontSize: 14, letterSpacing: 1 }, content: { padding: 18, gap: 13, paddingBottom: 44 }, lead: { lineHeight: 19, marginBottom: 10 }, input: { borderWidth: 1, borderRadius: 12, padding: 14 }, codeInput: { borderWidth: 1.5, borderRadius: 13, padding: 16, textAlign: 'center', fontFamily: 'Manrope_700Bold', fontSize: 15, letterSpacing: 1 }, primary: { height: 50, backgroundColor: '#FFD447', borderRadius: 12, alignItems: 'center', justifyContent: 'center' }, primaryText: { color: '#111', fontWeight: '900' }, disabled: { opacity: .42 }, secondary: { height: 50, borderWidth: 1, borderRadius: 12, alignItems: 'center', justifyContent: 'center' }, error: { color: '#ff6b6b', textAlign: 'center' }, joinCard: { borderWidth: 1, borderRadius: 20, padding: 18, gap: 13 }, joinHeading: { flexDirection: 'row', alignItems: 'center', gap: 12 }, joinHint: { fontSize: 12, lineHeight: 16, marginTop: 4 }, privacy: { textAlign: 'center', fontSize: 12, lineHeight: 16 }, hostCard: { borderWidth: 1, borderRadius: 18, padding: 16, gap: 11 }, freeInfo: { borderWidth: 1, borderRadius: 14, padding: 13, flexDirection: 'row', gap: 10, alignItems: 'center' }, codeCard: { borderWidth: 1, borderRadius: 18, padding: 20, alignItems: 'center' }, convoyName: { fontWeight: '900', fontSize: 16 }, code: { color: '#FFD447', fontFamily: 'Manrope_700Bold', fontSize: 26, letterSpacing: 1, marginVertical: 12 }, share: { color: '#FFD447', fontSize: 12, fontWeight: '900' }, mapButton: { minHeight: 64, borderRadius: 15, backgroundColor: '#FFD447', paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 11 }, mapButtonTitle: { color: '#111', fontWeight: '900', fontSize: 12 }, mapButtonSub: { color: '#322a00', fontSize: 12, marginTop: 3 }, label: { fontFamily: 'Manrope_600SemiBold', fontSize: 12, fontWeight: '900', marginTop: 10 }, person: { minHeight: 52, borderBottomWidth: 1, flexDirection: 'row', alignItems: 'center', gap: 10 }, statuses: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 8 }, status: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 10 }, leave: { color: '#ff6b6b', textAlign: 'center', padding: 16, fontWeight: '900' }, chip: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 10 }, hostActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 }, optionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 }, optionChip: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 9 }, optionSelected: { backgroundColor: '#18D7A0' }, optionSelectedYellow: { backgroundColor: '#FFD447' }, radioSettings: { borderWidth: 1, borderRadius: 15, padding: 13, gap: 10 }, waitingRow: { flexDirection: 'row', alignItems: 'center', gap: 9, minHeight: 45 }, friendChip: { borderWidth: 1, borderRadius: 12, padding: 8, flexDirection: 'row', alignItems: 'center', gap: 6 } });
