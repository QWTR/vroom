import React, { useState, useEffect, useCallback } from 'react';
import { View, ScrollView, TouchableOpacity, Image, FlatList, Modal, ActivityIndicator, StatusBar, Platform, Linking } from 'react-native';
import { AppText as Text, AppTextInput as TextInput } from '../../../components/ui/AppText';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import MaterialIcons          from '@expo/vector-icons/MaterialIcons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import AsyncStorage           from '@react-native-async-storage/async-storage';
import Toast                  from 'react-native-toast-message';
import { useTheme }           from '../../../contexts/ThemeContext';
import { API_URL }            from '../../../constants/config';
import { CommunityScreenHeader } from '../../../components/community';

const showToast = (options: Record<string, unknown>) => Toast.show(options as never);

interface MeetUser {
  id:        number;
  username:  string;
  avatarUrl: string | null;
}

interface MeetLink {
  label: string;
  url:   string;
}

interface MeetCar {
  id:     number;
  brand:  string;
  specs:  string;
  photos: string[];
  isMain?: boolean;
}

interface MeetDetail {
  id:                number;
  title:             string;
  description:       string | null;
  locationName:      string;
  lat:               number | null;
  lng:               number | null;
  date:              string;
  maxParticipants:   number;
  participantsCount: number;
  coverImage:        string | null;
  tags:              string[];
  rules:             string[];
  status:            string | null;
  category:          string;
  ticketPrice:       number | null;
  ticketCurrency:    string;
  ticketUrl:         string | null;
  ticketSalesEnabled: boolean;
  ticketOrganizerNetAmount: number | null;
  websiteUrl:        string | null;
  organizerName:     string | null;
  organizerInstagram: string | null;
  organizerFacebook:  string | null;
  organizerTiktok:    string | null;
  organizerWebsite:   string | null;
  extraLinks:        MeetLink[];
  isJoined:          boolean;
  joinedAt:          string | null;
  checkedInAt:       string | null;
  entryType:         string | null;
  canScan:           boolean;
  canManage:         boolean;
  canEdit:           boolean;
  freeEntryRemaining: number;
  freeEntryQuota:    number;
  freeEntryUsed:     number;
  freeParticipantEntryRemaining: number;
  freeParticipantEntryQuota:     number;
  freeParticipantEntryUsed:    number;
  participantStatus: string | null;
  car: MeetCar | null;
  isApprovedParticipant: boolean;
  ticketKind: 'visitor' | 'participant';
  pendingApplications: number;
  canReviewApplications: boolean;
  creator:           MeetUser;
  participants:      MeetUser[];
}

function formatTicketLabel(price: number | null | undefined, currency: string) {
  if (price == null) return null;
  if (price === 0) return 'Wstęp wolny';
  return `od ${price.toFixed(0)} ${currency || 'PLN'}`;
}

function normalizeUrl(raw: string) {
  const v = raw.trim();
  if (!v) return '';
  if (/^https?:\/\//i.test(v)) return v;
  if (v.startsWith('@')) return `https://instagram.com/${v.slice(1)}`;
  return `https://${v}`;
}

async function openExternalUrl(url: string) {
  const normalized = normalizeUrl(url);
  if (!normalized) return;
  const can = await Linking.canOpenURL(normalized);
  if (can) await Linking.openURL(normalized);
}

function daysUntil(iso: string) {
  const diff = Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000);
  if (diff < 0)   return { label: 'Minęło',        color: '#888' };
  if (diff === 0) return { label: 'DZIŚ',           color: '#e33835' };
  if (diff === 1) return { label: 'JUTRO',          color: '#ff9800' };
  if (diff <= 7)  return { label: `Za ${diff} dni`, color: '#4de926' };
  return null;
}

export default function MeetDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { theme, isDark } = useTheme();

  const [meet,         setMeet]         = useState<MeetDetail | null>(null);
  const [loading,      setLoading]      = useState(true);
  const [joinLoading,  setJoinLoading]  = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [inviteModal,  setInviteModal]  = useState(false);
  const [inviteSending, setInviteSending] = useState(false);
  const [inviteRadius,  setInviteRadius]  = useState(50);
  const [myId,         setMyId]         = useState<number | null>(null);
  const [quotaModal,   setQuotaModal]   = useState(false);
  const [quotaVisitor, setQuotaVisitor] = useState('0');
  const [quotaParticipant, setQuotaParticipant] = useState('0');
  const [quotaSaving,  setQuotaSaving]  = useState(false);

  const getToken = async () =>
    (await AsyncStorage.getItem('userToken')) ?? (await AsyncStorage.getItem('token')) ?? '';

  const fetchMeet = useCallback(async () => {
    setLoading(true);
    try {
      const token = await getToken();
      const r     = await fetch(`${API_URL}/api/meets/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) throw new Error('Błąd pobierania');
      setMeet(await r.json());
    } catch (e: any) {
      showToast({ type: 'error', text1: 'BŁĄD', text2: e.message });
    } finally {
      setLoading(false);
    }
  }, [id]);

  // Pobierz myId raz przy mount
  useEffect(() => {
    AsyncStorage.getItem('user').then(raw => {
      if (raw) setMyId(JSON.parse(raw).userId ?? JSON.parse(raw).id);
    });
  }, []);

  // Odśwież po powrocie z edycji
  useFocusEffect(
    useCallback(() => { fetchMeet(); }, [fetchMeet])
  );

  const handleJoin = useCallback(async () => {
    if (!meet || joinLoading) return;
    setJoinLoading(true);
    try {
      const token = await getToken();
      const r     = await fetch(`${API_URL}/api/meets/${meet.id}/join`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}` },
      });
      const data = await r.json();
      if (!r.ok) return showToast({ type: 'error', text1: 'BŁĄD', text2: data.error });
      setMeet(prev => prev ? { ...prev, isJoined: data.joined, participantsCount: data.participantsCount } : prev);
      showToast({ type: 'success', text1: data.joined ? '🏁 DOŁĄCZONO!' : 'Opuszczono meet', text2: meet.title });
    } catch {
      showToast({ type: 'error', text1: 'Błąd połączenia' });
    } finally { setJoinLoading(false); }
  }, [meet, joinLoading]);

  const sendNearbyInvites = useCallback(async () => {
    if (!meet || inviteSending) return;
    setInviteSending(true);
    try {
      const token = await getToken();
      const r     = await fetch(`${API_URL}/api/meets/${meet.id}/invite-nearby`, {
        method:  'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body:    JSON.stringify({ radiusKm: inviteRadius, maxInvites: 250 }),
      });
      const data = await r.json();
      if (!r.ok) {
        showToast({ type: 'error', text1: 'BŁĄD', text2: data.error || 'Nie udało się wysłać' });
        return;
      }
      showToast({ type: 'success', text1: 'WYSŁANO', text2: `Zaproszenia: ${data.sent ?? 0} osób w promieniu ${data.radiusKm} km` });
      setInviteModal(false);
    } catch {
      showToast({ type: 'error', text1: 'Błąd połączenia' });
    } finally { setInviteSending(false); }
  }, [meet, inviteSending, inviteRadius]);

  const openQuotaModal = useCallback(() => {
    if (!meet) return;
    setQuotaVisitor(String(meet.freeEntryQuota ?? 0));
    setQuotaParticipant(String(meet.freeParticipantEntryQuota ?? 0));
    setQuotaModal(true);
  }, [meet]);

  const saveQuotas = useCallback(async () => {
    if (!meet || quotaSaving) return;
    setQuotaSaving(true);
    try {
      const token = await getToken();
      const r = await fetch(`${API_URL}/api/meets/${meet.id}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          freeEntryQuota: parseInt(quotaVisitor, 10) || 0,
          freeParticipantEntryQuota: parseInt(quotaParticipant, 10) || 0,
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Nie udało się zapisać');
      setMeet(data);
      setQuotaModal(false);
      showToast({ type: 'success', text1: 'ZAPISANO', text2: 'Pule free wjazdów zaktualizowane' });
    } catch (e: any) {
      showToast({ type: 'error', text1: 'BŁĄD', text2: e.message });
    } finally {
      setQuotaSaving(false);
    }
  }, [meet, quotaSaving, quotaVisitor, quotaParticipant]);

  const openMaps = useCallback(async () => {
    if (!meet?.lat || !meet?.lng) {
      showToast({ type: 'error', text1: 'Brak współrzędnych meetu' }); return;
    }
    await AsyncStorage.setItem('nav_destination', JSON.stringify({
      latitude: meet.lat, longitude: meet.lng, name: meet.locationName,
    }));
    router.push('/(tabs)/map' as any);
  }, [meet, router]);

  if (loading) return (
    <View style={{ flex: 1, backgroundColor: theme.bg, justifyContent: 'center', alignItems: 'center' }}>
      <ActivityIndicator size="large" color={theme.primary} />
    </View>
  );

  if (!meet) return (
    <View style={{ flex: 1, backgroundColor: theme.bg, justifyContent: 'center', alignItems: 'center' }}>
      <Text style={{ color: theme.text, fontFamily: 'Manrope_600SemiBold' }}>Nie znaleziono meetu</Text>
    </View>
  );

  const spots   = meet.maxParticipants - meet.participantsCount;
  const pct     = Math.min(meet.participantsCount / meet.maxParticipants, 1);
  const isFull  = spots <= 0;
  const isOwner = myId === meet.creator.id;
  const canEdit = meet.canEdit || isOwner;
  const canScan = meet.canScan;
  const canManage = meet.canManage;
  const badge   = daysUntil(meet.date);
  const isHot   = meet.status === 'HOT' || pct >= 0.8;
  const ticketLabel = meet.ticketSalesEnabled
    ? 'Cena końcowa po adresie'
    : formatTicketLabel(meet.ticketPrice, meet.ticketCurrency);
  const extraLinks = Array.isArray(meet.extraLinks) ? meet.extraLinks : [];
  const socialLinks = [
    meet.organizerInstagram && { icon: 'photo-camera', label: 'Instagram', url: meet.organizerInstagram },
    meet.organizerFacebook  && { icon: 'facebook', label: 'Facebook', url: meet.organizerFacebook },
    meet.organizerTiktok    && { icon: 'music-note', label: 'TikTok', url: meet.organizerTiktok },
    meet.organizerWebsite   && { icon: 'language', label: 'Strona org.', url: meet.organizerWebsite },
  ].filter(Boolean) as { icon: string; label: string; url: string }[];
  const actionLinks = [
    !meet.ticketSalesEnabled && meet.ticketUrl && { icon: 'confirmation-number', label: 'Kup bilet', url: meet.ticketUrl, accent: true },
    meet.websiteUrl  && { icon: 'public', label: 'Strona wydarzenia', url: meet.websiteUrl },
    ...extraLinks.map(l => ({ icon: 'link', label: l.label || 'Link', url: l.url, accent: false })),
  ].filter(Boolean) as { icon: string; label: string; url: string; accent?: boolean }[];
  const handlePrimaryAction = () => {
    if (!meet.ticketSalesEnabled) {
      handleJoin();
      return;
    }
    if (meet.isJoined) {
      router.push({ pathname: '/Community/meets/ticket', params: { id: String(meet.id) } } as any);
      return;
    }
    router.push({ pathname: '/Community/meets/checkout', params: { id: String(meet.id) } } as any);
  };

  const renderParticipant = ({ item }: { item: MeetUser }) => (
    <TouchableOpacity
      style={{ flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: theme.surface, borderRadius: 12, padding: 12, marginBottom: 10, borderWidth: 1, borderColor: theme.border }}
      onPress={() => router.push(`/profile/${item.id}` as any)}
      activeOpacity={0.8}
    >
      <View style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: theme.primaryBg, borderWidth: 1, borderColor: theme.primaryBorder, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }}>
        {item.avatarUrl
          ? <Image source={{ uri: item.avatarUrl }} style={{ width: '100%', height: '100%' }} />
          : <Text style={{ color: theme.primary, fontFamily: 'Manrope_600SemiBold', fontSize: 13, fontWeight: '700' }}>{item.username.charAt(0).toUpperCase()}</Text>
        }
      </View>
      <Text style={{ flex: 1, color: theme.text, fontFamily: 'Manrope_600SemiBold', fontSize: 12, fontWeight: '700' }}>{item.username}</Text>
      {item.id === meet.creator.id && (
        <View style={{ backgroundColor: theme.primaryBg, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4, borderWidth: 1, borderColor: theme.primaryBorder }}>
          <Text style={{ color: theme.primary, fontFamily: 'Manrope_600SemiBold', fontSize: 12, fontWeight: '700' }}>ORGANIZATOR</Text>
        </View>
      )}
      <MaterialIcons name="arrow-forward-ios" size={12} color={theme.textDim} />
    </TouchableOpacity>
  );

  return (
    <>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />
      <ScrollView style={{ flex: 1, backgroundColor: theme.bg }} contentContainerStyle={{ paddingBottom: 120 }} showsVerticalScrollIndicator={false}>

        {/* COVER */}
        <View style={{ position: 'relative', height: meet.coverImage ? 240 : 160 }}>
          {meet.coverImage ? (
            <Image source={{ uri: meet.coverImage }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
          ) : (
            <View style={{ flex: 1, backgroundColor: theme.surface, alignItems: 'center', justifyContent: 'center' }}>
              <MaterialCommunityIcons name="car-multiple" size={64} color={theme.border3} />
            </View>
          )}
          <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 80, backgroundColor: '#00000060' }} />

          {/* Nawigacja góra */}
          <View style={{ position: 'absolute', top: 48, left: 16, right: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <TouchableOpacity
              style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: '#00000060', alignItems: 'center', justifyContent: 'center' }}
              onPress={() => router.back()}
            >
              <MaterialIcons name="arrow-back" size={20} color="#fff" />
            </TouchableOpacity>
            {canEdit && (
              <TouchableOpacity
                style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: '#00000060', alignItems: 'center', justifyContent: 'center' }}
                onPress={() => router.push({ pathname: '/Community/meets/editmeet', params: { id: String(meet.id) } } as any)}
              >
                <MaterialIcons name="edit" size={18} color="#fff" />
              </TouchableOpacity>
            )}
          </View>

          {/* Badges */}
          <View style={{ position: 'absolute', bottom: 14, left: 16, flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            {isHot && (
              <View style={{ backgroundColor: theme.primary, borderRadius: 6, paddingHorizontal: 10, paddingVertical: 5 }}>
                <Text style={{ color: '#fff', fontFamily: 'Manrope_600SemiBold', fontSize: 12, fontWeight: '700' }}>🔥 HOT</Text>
              </View>
            )}
            {badge && (
              <View style={{ backgroundColor: badge.color + 'dd', borderRadius: 6, paddingHorizontal: 10, paddingVertical: 5 }}>
                <Text style={{ color: '#fff', fontFamily: 'Manrope_600SemiBold', fontSize: 12, fontWeight: '700' }}>{badge.label}</Text>
              </View>
            )}
            <View style={{ backgroundColor: meet.category === 'official' ? '#FFD700dd' : '#00000060', borderRadius: 6, paddingHorizontal: 10, paddingVertical: 5 }}>
              <Text style={{ color: '#fff', fontFamily: 'Manrope_600SemiBold', fontSize: 12, fontWeight: '700' }}>
                {meet.category === 'official' ? '⭐ OFICJALNY' : '🏁 NIEOFICJALNY'}
              </Text>
            </View>
          </View>
        </View>

        <CommunityScreenHeader
          title={meet.title}
          subtitle={meet.category === 'official' ? 'OFICJALNE WYDARZENIE' : 'NIEOFICJALNY MEET'}
          showBack={false}
          breadcrumb=""
        />

        <View style={{ paddingHorizontal: 16, paddingTop: 12, gap: 20 }}>

          {/* ORGANIZATOR */}
          <View style={{ gap: 14 }}>
            <TouchableOpacity
              style={{ flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: theme.surface, padding: 12, borderRadius: 14, borderWidth: 1, borderColor: theme.border }}
              onPress={() => router.push(`/profile/${meet.creator.id}` as any)} activeOpacity={0.8}
            >
              <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: theme.primaryBg, borderWidth: 1.5, borderColor: theme.primaryBorder, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }}>
                {meet.creator.avatarUrl
                  ? <Image source={{ uri: meet.creator.avatarUrl }} style={{ width: '100%', height: '100%' }} />
                  : <Text style={{ color: theme.primary, fontFamily: 'Manrope_600SemiBold', fontSize: 15, fontWeight: '700' }}>{meet.creator.username.charAt(0).toUpperCase()}</Text>
                }
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: theme.textDim, fontFamily: 'Manrope_600SemiBold', fontSize: 12, letterSpacing: 1 }}>ORGANIZATOR</Text>
                <Text style={{ color: theme.text, fontFamily: 'Manrope_600SemiBold', fontSize: 13, fontWeight: '700' }}>
                  {meet.organizerName ? meet.organizerName : `@${meet.creator.username}`}
                </Text>
                {meet.organizerName && (
                  <Text style={{ color: theme.textDim, fontSize: 12, marginTop: 2 }}>@{meet.creator.username}</Text>
                )}
              </View>
              <MaterialIcons name="arrow-forward-ios" size={14} color={theme.textDim} />
            </TouchableOpacity>
          </View>

          {/* QUICK INFO */}
          <View style={{ flexDirection: 'row', gap: 10 }}>
            {[
              { icon: 'access-time', label: 'DATA',       value: new Date(meet.date).toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit' }) },
              { icon: 'schedule',    label: 'GODZINA',    value: new Date(meet.date).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' }) },
              { icon: 'people',      label: 'UCZESTNICY', value: `${meet.participantsCount}/${meet.maxParticipants}` },
            ].map(info => (
              <View key={info.label} style={{ flex: 1, backgroundColor: theme.surface, borderRadius: 14, padding: 12, borderWidth: 1, borderColor: theme.border, alignItems: 'center', gap: 6 }}>
                <MaterialIcons name={info.icon as any} size={18} color={theme.primary} />
                <Text style={{ color: theme.textDim, fontFamily: 'Manrope_600SemiBold', fontSize: 12, letterSpacing: 1 }}>{info.label}</Text>
                <Text style={{ color: theme.text, fontFamily: 'Manrope_600SemiBold', fontSize: 12, fontWeight: '700', textAlign: 'center' }}>{info.value}</Text>
              </View>
            ))}
          </View>

          {/* PASEK ZAPEŁNIENIA */}
          <View style={{ backgroundColor: theme.surface, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: theme.border, gap: 10 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ color: theme.textDim, fontFamily: 'Manrope_600SemiBold', fontSize: 12 }}>Miejsca</Text>
              <Text style={{ color: isFull ? '#e33835' : theme.text, fontFamily: 'Manrope_600SemiBold', fontSize: 12, fontWeight: '700' }}>
                {isFull ? 'BRAK MIEJSC' : `${spots} wolnych`}
              </Text>
            </View>
            <View style={{ height: 6, backgroundColor: theme.border, borderRadius: 3, overflow: 'hidden' }}>
              <View style={{ height: '100%', width: `${pct * 100}%`, backgroundColor: isFull ? '#e33835' : theme.primary, borderRadius: 3 }} />
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ color: theme.textDim, fontFamily: 'Manrope_600SemiBold', fontSize: 12 }}>{meet.participantsCount} zapisanych</Text>
              <Text style={{ color: theme.textDim, fontFamily: 'Manrope_600SemiBold', fontSize: 12 }}>{meet.maxParticipants} miejsc łącznie</Text>
            </View>
          </View>

          {/* BILET QR — uczestnik */}
          {meet.isJoined && (
            <View style={{ gap: 12 }}>
              <Text style={{ color: theme.textDim, fontFamily: 'Manrope_600SemiBold', fontSize: 12, letterSpacing: 1 }}>
                {meet.isApprovedParticipant ? 'TWÓJ BILET UCZESTNIKA' : 'TWÓJ BILET VROOM'}
              </Text>
              <TouchableOpacity
                style={{ backgroundColor: theme.surface, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: meet.isApprovedParticipant ? '#4de92650' : theme.primaryBorder, gap: 12 }}
                onPress={() => router.push({ pathname: '/Community/meets/ticket', params: { id: String(meet.id) } } as any)}
                activeOpacity={0.85}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                  <View style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: meet.isApprovedParticipant ? '#4de92615' : theme.primaryBg, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: meet.isApprovedParticipant ? '#4de92640' : theme.primaryBorder }}>
                    <MaterialIcons name="qr-code-2" size={24} color={meet.isApprovedParticipant ? '#4de926' : theme.primary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: theme.text, fontFamily: 'Manrope_600SemiBold', fontSize: 13, fontWeight: '700' }}>
                      {meet.isApprovedParticipant ? 'QR uczestnika z autem' : 'Pokaż kod QR'}
                    </Text>
                    <Text style={{ color: theme.textDim, fontSize: 12, marginTop: 4 }}>
                      {meet.checkedInAt
                        ? `Wszedłeś na teren · ${meet.entryType === 'free_vroom' ? 'FREE VROOM' : 'standard'}`
                        : meet.isApprovedParticipant && meet.car
                          ? `${meet.car.brand} ${meet.car.specs}`.trim()
                          : meet.joinedAt
                            ? `Zapisany: ${new Date(meet.joinedAt).toLocaleString('pl-PL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}`
                            : 'Zapisany w apce'}
                    </Text>
                  </View>
                  <MaterialIcons name="chevron-right" size={22} color={theme.textDim} />
                </View>
              </TouchableOpacity>

              {/* Zgłoszenie uczestnika z autem */}
              {!meet.isApprovedParticipant && meet.participantStatus !== 'pending' && (
                <TouchableOpacity
                  style={{ backgroundColor: theme.surface, borderRadius: 14, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderColor: theme.border }}
                  onPress={() => router.push({ pathname: '/Community/meets/apply-participant', params: { id: String(meet.id) } } as any)}
                  activeOpacity={0.85}
                >
                  <MaterialCommunityIcons name="car-sports" size={24} color={theme.primary} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: theme.text, fontFamily: 'Manrope_600SemiBold', fontSize: 12, fontWeight: '700' }}>
                      {meet.participantStatus === 'rejected' ? 'Zgłoś się ponownie z autem' : 'Zgłoś się jako uczestnik z autem'}
                    </Text>
                    <Text style={{ color: theme.textDim, fontSize: 12, marginTop: 3 }}>Wybierz auto z garażu — organizator zatwierdzi</Text>
                  </View>
                  <MaterialIcons name="chevron-right" size={20} color={theme.textDim} />
                </TouchableOpacity>
              )}
              {meet.participantStatus === 'pending' && (
                <View style={{ backgroundColor: '#ff980015', borderRadius: 14, padding: 14, borderWidth: 1, borderColor: '#ff980040', flexDirection: 'row', gap: 12, alignItems: 'center' }}>
                  <MaterialIcons name="hourglass-top" size={22} color="#ff9800" />
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: '#ff9800', fontFamily: 'Manrope_600SemiBold', fontSize: 12, fontWeight: '700' }}>OCZEKUJE NA AKCEPTACJĘ</Text>
                    {meet.car && (
                      <Text style={{ color: theme.textDim, fontSize: 12, marginTop: 4 }}>
                        {meet.car.brand} {meet.car.specs}
                      </Text>
                    )}
                  </View>
                </View>
              )}
            </View>
          )}

          {/* ORGANIZATOR — skan / zespół */}
          {(canScan || canManage) && (
            <View style={{ gap: 12 }}>
              <Text style={{ color: theme.textDim, fontFamily: 'Manrope_600SemiBold', fontSize: 12, letterSpacing: 1 }}>PANEL ORGANIZATORA</Text>
              {canScan && (
                <TouchableOpacity
                  style={{ backgroundColor: theme.primary, borderRadius: 14, padding: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 }}
                  onPress={() => router.push({ pathname: '/Community/meets/scan', params: { id: String(meet.id) } } as any)}
                  activeOpacity={0.85}
                >
                  <MaterialIcons name="qr-code-scanner" size={22} color="#fff" />
                  <Text style={{ color: '#fff', fontFamily: 'Manrope_600SemiBold', fontSize: 12, fontWeight: '700' }}>SKANUJ BILET QR</Text>
                </TouchableOpacity>
              )}
              {canScan && meet.freeEntryQuota > 0 && (
                <View style={{ backgroundColor: theme.surface, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: theme.border }}>
                  <Text style={{ color: theme.textDim, fontFamily: 'Manrope_600SemiBold', fontSize: 12, letterSpacing: 1 }}>FREE VROOM — GOŚCIE</Text>
                  <Text style={{ color: '#f5c518', fontFamily: 'Manrope_600SemiBold', fontSize: 18, fontWeight: '700', marginTop: 4 }}>
                    {meet.freeEntryRemaining} / {meet.freeEntryQuota}
                  </Text>
                </View>
              )}
              {canScan && meet.freeParticipantEntryQuota > 0 && (
                <View style={{ backgroundColor: theme.surface, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: theme.border }}>
                  <Text style={{ color: theme.textDim, fontFamily: 'Manrope_600SemiBold', fontSize: 12, letterSpacing: 1 }}>FREE VROOM — UCZESTNICY Z AUTEM</Text>
                  <Text style={{ color: '#4de926', fontFamily: 'Manrope_600SemiBold', fontSize: 18, fontWeight: '700', marginTop: 4 }}>
                    {meet.freeParticipantEntryRemaining} / {meet.freeParticipantEntryQuota}
                  </Text>
                  <Text style={{ color: theme.textDim, fontSize: 12, marginTop: 4 }}>Free przydzielane przy skanie QR na miejscu</Text>
                </View>
              )}
              {canEdit && (
                <TouchableOpacity
                  style={{ backgroundColor: theme.surface, borderRadius: 14, padding: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, borderWidth: 1, borderColor: theme.border }}
                  onPress={openQuotaModal}
                  activeOpacity={0.85}
                >
                  <MaterialIcons name="tune" size={20} color={theme.primary} />
                  <Text style={{ color: theme.text, fontFamily: 'Manrope_600SemiBold', fontSize: 12, fontWeight: '700' }}>USTAW PULE FREE WJAZDÓW</Text>
                </TouchableOpacity>
              )}
              {meet.canReviewApplications && (
                <TouchableOpacity
                  style={{ backgroundColor: theme.surface, borderRadius: 14, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderColor: theme.border }}
                  onPress={() => router.push({ pathname: '/Community/meets/applications', params: { id: String(meet.id) } } as any)}
                  activeOpacity={0.85}
                >
                  <MaterialCommunityIcons name="car-multiple" size={22} color={theme.primary} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: theme.text, fontFamily: 'Manrope_600SemiBold', fontSize: 12, fontWeight: '700' }}>ZGŁOSZENIA Z AUTEM</Text>
                    <Text style={{ color: theme.textDim, fontSize: 12, marginTop: 2 }}>Zatwierdzaj uczestników z garażu</Text>
                  </View>
                  {(meet.pendingApplications ?? 0) > 0 && (
                    <View style={{ backgroundColor: theme.primary, borderRadius: 12, minWidth: 24, height: 24, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 }}>
                      <Text style={{ color: '#fff', fontFamily: 'Manrope_600SemiBold', fontSize: 12, fontWeight: '700' }}>{meet.pendingApplications}</Text>
                    </View>
                  )}
                  <MaterialIcons name="chevron-right" size={20} color={theme.textDim} />
                </TouchableOpacity>
              )}
              {canManage && (
                <TouchableOpacity
                  style={{ backgroundColor: theme.surface, borderRadius: 14, padding: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, borderWidth: 1, borderColor: theme.border }}
                  onPress={() => router.push({ pathname: '/Community/meets/staff', params: { id: String(meet.id) } } as any)}
                  activeOpacity={0.85}
                >
                  <MaterialIcons name="groups" size={22} color={theme.primary} />
                  <Text style={{ color: theme.text, fontFamily: 'Manrope_600SemiBold', fontSize: 12, fontWeight: '700' }}>ZARZĄDZAJ ZESPOŁEM</Text>
                </TouchableOpacity>
              )}
            </View>
          )}

          {/* BILET I LINKI */}
          {(ticketLabel || actionLinks.length > 0) && (
            <View style={{ gap: 12 }}>
              <Text style={{ color: theme.textDim, fontFamily: 'Manrope_600SemiBold', fontSize: 12, letterSpacing: 1 }}>BILETY I LINKI</Text>
              {ticketLabel && (
                <View style={{ backgroundColor: theme.surface, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: theme.border, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                  <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: theme.primaryBg, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: theme.primaryBorder }}>
                    <MaterialIcons name="confirmation-number" size={20} color={theme.primary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: theme.textDim, fontFamily: 'Manrope_600SemiBold', fontSize: 12, letterSpacing: 1 }}>CENA BILETU</Text>
                    <Text style={{ color: theme.text, fontFamily: 'Manrope_600SemiBold', fontSize: 14, fontWeight: '700' }}>{ticketLabel}</Text>
                  </View>
                </View>
              )}
              {actionLinks.map((link, i) => (
                <TouchableOpacity
                  key={`${link.label}-${i}`}
                  style={{
                    backgroundColor: link.accent ? theme.primaryBg : theme.surface,
                    borderRadius: 14, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12,
                    borderWidth: 1, borderColor: link.accent ? theme.primaryBorder : theme.border,
                  }}
                  onPress={() => openExternalUrl(link.url)} activeOpacity={0.85}
                >
                  <MaterialIcons name={link.icon as any} size={20} color={theme.primary} />
                  <Text style={{ flex: 1, color: theme.text, fontFamily: 'Manrope_600SemiBold', fontSize: 12, fontWeight: '700' }}>{link.label}</Text>
                  <MaterialIcons name="open-in-new" size={16} color={theme.textDim} />
                </TouchableOpacity>
              ))}
            </View>
          )}

          {/* SOCIAL MEDIA ORGANIZATORA */}
          {socialLinks.length > 0 && (
            <View style={{ gap: 12 }}>
              <Text style={{ color: theme.textDim, fontFamily: 'Manrope_600SemiBold', fontSize: 12, letterSpacing: 1 }}>SOCIAL MEDIA</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
                {socialLinks.map((link, i) => (
                  <TouchableOpacity
                    key={`${link.label}-${i}`}
                    style={{ backgroundColor: theme.surface, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, borderWidth: 1, borderColor: theme.border, flexDirection: 'row', alignItems: 'center', gap: 8 }}
                    onPress={() => openExternalUrl(link.url)} activeOpacity={0.85}
                  >
                    <MaterialIcons name={link.icon as any} size={16} color={theme.primary} />
                    <Text style={{ color: theme.text, fontFamily: 'Manrope_600SemiBold', fontSize: 12, fontWeight: '700' }}>{link.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          )}

          {/* TAGI */}
          {meet.tags.length > 0 && (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {meet.tags.map((tag, i) => (
                <View key={i} style={{ backgroundColor: theme.primaryBg, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8, borderWidth: 1, borderColor: theme.primaryBorder }}>
                  <Text style={{ color: theme.primary, fontFamily: 'Manrope_600SemiBold', fontSize: 12, fontWeight: '700' }}>{tag}</Text>
                </View>
              ))}
            </View>
          )}

          {/* OPIS */}
          {!!meet.description && (
            <View style={{ gap: 10 }}>
              <Text style={{ color: theme.textDim, fontFamily: 'Manrope_600SemiBold', fontSize: 12, letterSpacing: 1 }}>O MEECIE</Text>
              <Text style={{ color: theme.text, fontSize: 13, lineHeight: 22 }}>{meet.description}</Text>
            </View>
          )}

          {/* LOKALIZACJA */}
          <View style={{ gap: 10 }}>
            <Text style={{ color: theme.textDim, fontFamily: 'Manrope_600SemiBold', fontSize: 12, letterSpacing: 1 }}>LOKALIZACJA</Text>
            <TouchableOpacity
              style={{ backgroundColor: theme.surface, borderRadius: 14, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderColor: theme.border }}
              onPress={openMaps} activeOpacity={0.8}
            >
              <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: theme.primaryBg, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: theme.primaryBorder }}>
                <MaterialIcons name="location-on" size={20} color={theme.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: theme.text, fontFamily: 'Manrope_600SemiBold', fontSize: 12, fontWeight: '700' }} numberOfLines={2}>{meet.locationName}</Text>
                {meet.lat && meet.lng && (
                  <Text style={{ color: theme.textDim, fontSize: 12, marginTop: 3 }}>
                    📍 {meet.lat.toFixed(4)}, {meet.lng.toFixed(4)}
                  </Text>
                )}
              </View>
              <View style={{ alignItems: 'center', gap: 3 }}>
                <MaterialIcons name="navigation" size={18} color={theme.primary} />
                <Text style={{ color: theme.primary, fontFamily: 'Manrope_600SemiBold', fontSize: 12 }}>NAWIGUJ</Text>
              </View>
            </TouchableOpacity>
            {canEdit && meet.lat != null && meet.lng != null && (
              <TouchableOpacity
                style={{ marginTop: 12, backgroundColor: theme.primaryBg, borderRadius: 14, padding: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, borderWidth: 1, borderColor: theme.primaryBorder }}
                onPress={() => setInviteModal(true)} activeOpacity={0.85}
              >
                <MaterialIcons name="campaign" size={22} color={theme.primary} />
                <Text style={{ color: theme.primary, fontFamily: 'Manrope_600SemiBold', fontSize: 12, fontWeight: '700' }}>ZAPROŚ UŻYTKOWNIKÓW W POBLIŻU</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* ZASADY */}
          {meet.rules.length > 0 && (
            <View style={{ gap: 12 }}>
              <Text style={{ color: theme.textDim, fontFamily: 'Manrope_600SemiBold', fontSize: 12, letterSpacing: 1 }}>ZASADY</Text>
              {meet.rules.map((rule, i) => (
                <View key={i} style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start' }}>
                  <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: theme.primaryBg, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: theme.primaryBorder, flexShrink: 0 }}>
                    <Text style={{ color: theme.primary, fontFamily: 'Manrope_600SemiBold', fontSize: 12, fontWeight: '700' }}>{i + 1}</Text>
                  </View>
                  <Text style={{ flex: 1, color: theme.text, fontSize: 13, lineHeight: 20, marginTop: 4 }}>{rule}</Text>
                </View>
              ))}
            </View>
          )}

          {/* UCZESTNICY */}
          <View style={{ gap: 12 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={{ color: theme.textDim, fontFamily: 'Manrope_600SemiBold', fontSize: 12, letterSpacing: 1 }}>UCZESTNICY</Text>
              <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }} onPress={() => setModalVisible(true)}>
                <Text style={{ color: theme.primary, fontFamily: 'Manrope_600SemiBold', fontSize: 12, fontWeight: '700' }}>WSZYSCY ({meet.participantsCount})</Text>
                <MaterialIcons name="arrow-forward-ios" size={11} color={theme.primary} />
              </TouchableOpacity>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              {meet.participants.slice(0, 6).map((p, i) => (
                <TouchableOpacity
                  key={p.id}
                  style={{ marginLeft: i === 0 ? 0 : -10, width: 38, height: 38, borderRadius: 19, borderWidth: 2, borderColor: theme.bg, backgroundColor: theme.primaryBg, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }}
                  onPress={() => router.push(`/profile/${p.id}` as any)}
                >
                  {p.avatarUrl
                    ? <Image source={{ uri: p.avatarUrl }} style={{ width: '100%', height: '100%' }} />
                    : <Text style={{ color: theme.primary, fontFamily: 'Manrope_600SemiBold', fontSize: 12, fontWeight: '700' }}>{p.username.charAt(0).toUpperCase()}</Text>
                  }
                </TouchableOpacity>
              ))}
              {meet.participantsCount > 6 && (
                <View style={{ marginLeft: -10, width: 38, height: 38, borderRadius: 19, backgroundColor: theme.surface, borderWidth: 2, borderColor: theme.bg, alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ color: theme.textDim, fontFamily: 'Manrope_600SemiBold', fontSize: 12, fontWeight: '700' }}>+{meet.participantsCount - 6}</Text>
                </View>
              )}
            </View>
          </View>

        </View>
      </ScrollView>

      {/* FLOATING CTA */}
      <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: theme.bg, borderTopWidth: 1, borderTopColor: theme.border, padding: 16, paddingBottom: Platform.OS === 'ios' ? 32 : 16, flexDirection: 'row', gap: 10 }}>
        <View style={{ backgroundColor: theme.surface, borderRadius: 12, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: theme.border }}>
          <Text style={{ color: theme.primary, fontFamily: 'Manrope_600SemiBold', fontSize: 16, fontWeight: '700' }}>
            {new Date(meet.date).toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit' })}
          </Text>
          <Text style={{ color: theme.textDim, fontFamily: 'Manrope_600SemiBold', fontSize: 12 }}>
            {new Date(meet.date).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })}
          </Text>
        </View>

        <TouchableOpacity
          style={[{
            flex: 1, borderRadius: 14, paddingVertical: 16,
            flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
          },
            meet.isJoined
              ? { backgroundColor: '#4de92615', borderWidth: 1, borderColor: '#4de92640' }
              : isFull
                ? { backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border }
                : { backgroundColor: theme.primary },
            joinLoading && { opacity: 0.7 },
          ]}
          onPress={handlePrimaryAction}
          disabled={joinLoading || (isFull && !meet.isJoined)}
          activeOpacity={0.85}
        >
          {joinLoading ? (
            <ActivityIndicator size="small" color={meet.isJoined ? '#4de926' : '#fff'} />
          ) : (
            <>
              <MaterialIcons
                name={meet.isJoined ? (meet.ticketSalesEnabled ? 'qr-code-2' : 'check-circle') : isFull ? 'block' : meet.ticketSalesEnabled ? 'confirmation-number' : 'add-circle-outline'}
                size={20}
                color={meet.isJoined ? '#4de926' : isFull ? theme.textDim : '#fff'}
              />
              <Text style={{ fontFamily: 'Manrope_600SemiBold', fontSize: 13, fontWeight: '700', color: meet.isJoined ? '#4de926' : isFull ? theme.textDim : '#fff' }}>
                {meet.isJoined
                  ? meet.ticketSalesEnabled ? 'TWÓJ BILET QR' : 'DOŁĄCZONO ✓'
                  : isFull ? 'BRAK MIEJSC' : meet.ticketSalesEnabled ? 'KUP BILET' : 'DOŁĄCZ DO MEETU'}
              </Text>
            </>
          )}
        </TouchableOpacity>
      </View>

      {/* MODAL uczestnicy */}
      <Modal visible={inviteModal} animationType="fade" transparent onRequestClose={() => !inviteSending && setInviteModal(false)}>
        <View style={{ flex: 1, backgroundColor: theme.overlay, justifyContent: 'center', padding: 24 }}>
          <View style={{ backgroundColor: theme.surface2, borderRadius: 20, padding: 20, borderWidth: 1, borderColor: theme.border }}>
            <Text style={{ color: theme.text, fontFamily: 'Manrope_600SemiBold', fontSize: 14, fontWeight: '700', marginBottom: 8 }}>Zaproszenia w pobliżu</Text>
            <Text style={{ color: theme.textDim, fontSize: 12, lineHeight: 18, marginBottom: 16 }}>
              VROOM wyśle powiadomienie (push + centrum powiadomień) użytkownikom z włączonym udostępnianiem lokalizacji, którzy są w promieniu od punktu meetu. Max raz na 24 h.
            </Text>
            <Text style={{ color: theme.textDim, fontFamily: 'Manrope_600SemiBold', fontSize: 12, letterSpacing: 1, marginBottom: 8 }}>PROMIEŃ (KM)</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 20 }}>
              {[25, 50, 100, 150].map(km => (
                <TouchableOpacity
                  key={km}
                  onPress={() => setInviteRadius(km)}
                  style={{
                    paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10,
                    borderWidth: 1,
                    borderColor: inviteRadius === km ? theme.primary : theme.border2,
                    backgroundColor: inviteRadius === km ? theme.primaryBg : theme.surface3,
                  }}
                >
                  <Text style={{ color: inviteRadius === km ? theme.primary : theme.text, fontFamily: 'Manrope_600SemiBold', fontSize: 12, fontWeight: '700' }}>{km} km</Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <TouchableOpacity
                style={{ flex: 1, backgroundColor: theme.surface3, borderRadius: 12, paddingVertical: 14, alignItems: 'center', borderWidth: 1, borderColor: theme.border2 }}
                onPress={() => !inviteSending && setInviteModal(false)} disabled={inviteSending}
              >
                <Text style={{ color: theme.text, fontFamily: 'Manrope_600SemiBold', fontSize: 12 }}>ANULUJ</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={{ flex: 1, backgroundColor: theme.primary, borderRadius: 12, paddingVertical: 14, alignItems: 'center', opacity: inviteSending ? 0.7 : 1 }}
                onPress={sendNearbyInvites} disabled={inviteSending}
              >
                {inviteSending ? <ActivityIndicator color="#fff" /> : <Text style={{ color: '#fff', fontFamily: 'Manrope_600SemiBold', fontSize: 12, fontWeight: '700' }}>WYŚLIJ</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={quotaModal} animationType="fade" transparent onRequestClose={() => !quotaSaving && setQuotaModal(false)}>
        <View style={{ flex: 1, backgroundColor: theme.overlay, justifyContent: 'center', padding: 24 }}>
          <View style={{ backgroundColor: theme.surface2, borderRadius: 20, padding: 20, borderWidth: 1, borderColor: theme.border, gap: 14 }}>
            <Text style={{ color: theme.text, fontFamily: 'Manrope_600SemiBold', fontSize: 14, fontWeight: '700' }}>Pule free wjazdów VROOM</Text>
            <Text style={{ color: theme.textDim, fontSize: 12, lineHeight: 17 }}>
              Pierwsze zeskanowane kody QR dostają darmowy wjazd — osobno dla gości i uczestników z autem.
            </Text>
            <View>
              <Text style={{ color: theme.textDim, fontFamily: 'Manrope_600SemiBold', fontSize: 12, letterSpacing: 1, marginBottom: 6 }}>FREE — GOŚCIE (QR użytkownika)</Text>
              <TextInput
                value={quotaVisitor}
                onChangeText={setQuotaVisitor}
                keyboardType="number-pad"
                style={{ backgroundColor: theme.surface, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: theme.border, color: theme.text, fontFamily: 'Manrope_600SemiBold' }}
              />
            </View>
            <View>
              <Text style={{ color: theme.textDim, fontFamily: 'Manrope_600SemiBold', fontSize: 12, letterSpacing: 1, marginBottom: 6 }}>FREE — UCZESTNICY Z AUTEM</Text>
              <TextInput
                value={quotaParticipant}
                onChangeText={setQuotaParticipant}
                keyboardType="number-pad"
                style={{ backgroundColor: theme.surface, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: theme.border, color: theme.text, fontFamily: 'Manrope_600SemiBold' }}
              />
            </View>
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 4 }}>
              <TouchableOpacity
                style={{ flex: 1, backgroundColor: theme.surface3, borderRadius: 12, paddingVertical: 14, alignItems: 'center', borderWidth: 1, borderColor: theme.border2 }}
                onPress={() => !quotaSaving && setQuotaModal(false)}
                disabled={quotaSaving}
              >
                <Text style={{ color: theme.text, fontFamily: 'Manrope_600SemiBold', fontSize: 12 }}>ANULUJ</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={{ flex: 1, backgroundColor: theme.primary, borderRadius: 12, paddingVertical: 14, alignItems: 'center', opacity: quotaSaving ? 0.7 : 1 }}
                onPress={saveQuotas}
                disabled={quotaSaving}
              >
                {quotaSaving ? <ActivityIndicator color="#fff" /> : <Text style={{ color: '#fff', fontFamily: 'Manrope_600SemiBold', fontSize: 12, fontWeight: '700' }}>ZAPISZ</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={modalVisible} animationType="slide" transparent onRequestClose={() => setModalVisible(false)}>
        <View style={{ flex: 1, backgroundColor: theme.overlay, justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: theme.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 16, paddingTop: 20, maxHeight: '85%' }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: theme.border }}>
              <Text style={{ color: theme.text, fontFamily: 'Manrope_600SemiBold', fontSize: 16, fontWeight: '700' }}>UCZESTNICY ({meet.participantsCount})</Text>
              <TouchableOpacity style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: theme.surface, alignItems: 'center', justifyContent: 'center' }} onPress={() => setModalVisible(false)}>
                <MaterialIcons name="close" size={18} color={theme.text} />
              </TouchableOpacity>
            </View>
            <FlatList
              data={meet.participants} renderItem={renderParticipant}
              keyExtractor={p => String(p.id)} contentContainerStyle={{ paddingBottom: 40 }}
              showsVerticalScrollIndicator={false}
            />
          </View>
        </View>
      </Modal>
    </>
  );
}