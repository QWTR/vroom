import React, { useEffect, useState } from 'react';
import { Modal, View, TouchableOpacity, FlatList, ActivityIndicator, Image } from 'react-native';
import { AppText as Text } from '../ui/AppText';
import { MaterialIcons, MaterialCommunityIcons, Feather } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme } from '../../contexts/ThemeContext';
import { RouteMiniMap } from '../profile/RouteMiniMap';
import Toast from 'react-native-toast-message';
import { API_URL } from '../../constants/config';

export interface ShareableRoute {
  id:                 number;
  name:               string;
  distance:           number;
  isPublic:           boolean;
  sharedToCommunity?: boolean;
  points:             { latitude: number; longitude: number; order: number; label?: string | null }[];
}

type ShareTab = 'chat' | 'community';

interface Conversation {
  id:           number;
  isGroup:      boolean;
  name:         string;
  avatarUrl:    string | null;
  participants: { id: number; username: string; avatarUrl: string | null }[];
}

interface Props {
  visible: boolean;
  route:   ShareableRoute | null;
  onClose: () => void;
  onSent:  () => void;
  myId:    number | null;
}

export function ShareRouteModal({ visible, route, onClose, onSent, myId }: Props) {
  const { theme } = useTheme();
  const [tab,         setTab]         = useState<ShareTab>('chat');
  const [convs,       setConvs]       = useState<Conversation[]>([]);
  const [loading,     setLoading]     = useState(false);
  const [sending,     setSending]     = useState<number | null>(null);
  const [sent,        setSent]        = useState<number[]>([]);
  const [postingComm, setPostingComm] = useState(false);
  const [sharedComm,  setSharedComm]  = useState(false);

  useEffect(() => {
    if (!visible) return;
    setTab('chat'); setSent([]); setSharedComm(false); fetchConvs();
  }, [visible]);

  const fetchConvs = async () => {
    setLoading(true);
    try {
      const token = await AsyncStorage.getItem('token');
      const res   = await fetch(`${API_URL}/api/chat/conversations`, { headers: { Authorization: `Bearer ${token}` } });
      const json  = await res.json();
      setConvs(Array.isArray(json) ? json : json.conversations ?? []);
    } catch {} finally { setLoading(false); }
  };

  const handleSendToChat = async (convId: number) => {
    if (!route) return;
    setSending(convId);
    try {
      const token   = await AsyncStorage.getItem('token');
      const content = JSON.stringify({ type: 'route', routeId: route.id, name: route.name, distance: route.distance, points: route.points.slice(0, 50), isPublic: route.isPublic });
      const form    = new FormData();
      form.append('content', content);
      await fetch(`${API_URL}/api/chat/conversations/${convId}/messages`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form });
      setSent(prev => [...prev, convId]);
    } catch { Toast.show({ type: 'error', text1: 'Błąd wysyłania' }); }
    finally { setSending(null); }
  };

  const handleShareToCommunity = async () => {
    if (!route) return;
    if (!route.isPublic) {
      Toast.show({
        type: 'info',
        text1: 'Trasa prywatna',
        text2: 'Udostępnij ją jako publiczną, aby pojawiła się w Społeczności → Trasy',
      });
      return;
    }
    setPostingComm(true);
    try {
      const token = await AsyncStorage.getItem('token');
      const res = await fetch(`${API_URL}/api/routes/${route.id}/share-community`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('share failed');
      const data = await res.json();

      setSharedComm(true);
      Toast.show({
        type: 'success',
        text1: data.sharedToCommunity ? 'Trasa udostępniona!' : 'Trasa ukryta',
        text2: data.sharedToCommunity
          ? 'Widoczna w Społeczności → Trasy'
          : 'Usunięto z listy tras w Społeczności',
      });
      onSent();
    } catch { Toast.show({ type: 'error', text1: 'Błąd udostępniania' }); }
    finally { setPostingComm(false); }
  };

  const handleClose = () => { setSent([]); setSharedComm(false); onClose(); };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={handleClose} statusBarTranslucent>
      <View style={{ flex: 1, backgroundColor: theme.overlay, justifyContent: 'flex-end' }}>
        <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={handleClose} />
        <View style={{
          backgroundColor: theme.surface,
          borderTopLeftRadius: 24, borderTopRightRadius: 24,
          maxHeight: '88%', borderTopWidth: 1, borderColor: theme.border2,
          paddingHorizontal: 16, paddingBottom: 24,
        }}>
          <View style={{ width: 40, height: 4, backgroundColor: theme.border3, borderRadius: 2, alignSelf: 'center', marginTop: 12, marginBottom: 8 }} />

          {/* Header */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, borderBottomWidth: 1, borderColor: theme.border }}>
            <MaterialCommunityIcons name="map-marker-path" size={18} color={theme.primary} />
            <Text style={{ fontFamily: 'Manrope_600SemiBold', fontSize: 13, color: theme.text, letterSpacing: 1, flex: 1 }}>WYŚLIJ TRASĘ</Text>
            <TouchableOpacity onPress={handleClose} style={{ padding: 4 }}>
              <MaterialIcons name="close" size={20} color={theme.textDim} />
            </TouchableOpacity>
          </View>

          {/* Podgląd trasy */}
          {route && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: theme.surface2, borderRadius: 12, padding: 12, marginVertical: 12, borderWidth: 1, borderColor: theme.primaryBorder }}>
              <View style={{ backgroundColor: theme.bg, borderRadius: 8, overflow: 'hidden', borderWidth: 1, borderColor: theme.border }}>
                <RouteMiniMap points={route.points} width={80} height={50} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: 'Manrope_600SemiBold', fontSize: 12, color: theme.text, fontWeight: '700' }} numberOfLines={1}>{route.name}</Text>
                <Text style={{ fontFamily: 'Manrope_600SemiBold', fontSize: 12, color: theme.textDim, marginTop: 3 }}>{route.distance.toFixed(1)} km · {route.points.length} pkt</Text>
              </View>
            </View>
          )}

          {/* Tabs */}
          <View style={{ flexDirection: 'row', backgroundColor: theme.surface2, borderRadius: 12, padding: 3, marginBottom: 14 }}>
            {(['chat', 'community'] as const).map(t => (
              <TouchableOpacity
                key={t}
                style={[{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 9, borderRadius: 9 },
                  tab === t && { backgroundColor: theme.primary }]}
                onPress={() => setTab(t)} activeOpacity={0.8}
              >
                {t === 'chat'
                  ? <MaterialIcons name="chat" size={13} color={tab === t ? '#fff' : theme.textDim} />
                  : <MaterialCommunityIcons name="map-marker-path" size={13} color={tab === t ? '#fff' : theme.textDim} />
                }
                <Text style={{ fontFamily: 'Manrope_600SemiBold', fontSize: 12, color: tab === t ? '#fff' : theme.textDim, fontWeight: '700' }}>
                  {t === 'chat' ? 'CZAT' : 'TRASY'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* CZAT */}
          {tab === 'chat' && (
            loading ? (
              <ActivityIndicator color={theme.primary} style={{ marginVertical: 30 }} />
            ) : (
              <FlatList
                data={convs}
                keyExtractor={c => String(c.id)}
                style={{ maxHeight: 340 }}
                contentContainerStyle={{ paddingBottom: 20 }}
                showsVerticalScrollIndicator={false}
                ListEmptyComponent={<Text style={{ fontFamily: 'Manrope_600SemiBold', color: theme.textDim, fontSize: 12, textAlign: 'center', marginTop: 30 }}>Brak rozmów</Text>}
                renderItem={({ item: conv }) => {
                  const other  = conv.participants?.find((p: any) => p.id !== myId);
                  const name   = conv.isGroup ? conv.name : other?.username ?? '?';
                  const avatar = conv.isGroup ? conv.avatarUrl : other?.avatarUrl ?? null;
                  const isSent = sent.includes(conv.id);
                  return (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderBottomWidth: 1, borderColor: theme.border }}>
                      {avatar
                        ? <Image source={{ uri: avatar }} style={{ width: 42, height: 42, borderRadius: 21 }} />
                        : <View style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: theme.surface2, borderWidth: 1, borderColor: theme.primaryBorder, justifyContent: 'center', alignItems: 'center' }}>
                            <Text style={{ color: theme.primary, fontFamily: 'Manrope_600SemiBold', fontSize: 12, fontWeight: '700' }}>{name.slice(0, 2).toUpperCase()}</Text>
                          </View>
                      }
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontFamily: 'Manrope_600SemiBold', fontSize: 12, color: theme.text, fontWeight: '600' }} numberOfLines={1}>{name}</Text>
                        {conv.isGroup && <Text style={{ fontFamily: 'Manrope_600SemiBold', fontSize: 12, color: theme.textDim, marginTop: 2 }}>{conv.participants?.length} uczestników</Text>}
                      </View>
                      <TouchableOpacity
                        style={[{ flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
                          isSent
                            ? { backgroundColor: '#4de92615', borderWidth: 1, borderColor: '#4de92630' }
                            : { backgroundColor: theme.primary }]}
                        onPress={() => !isSent && handleSendToChat(conv.id)}
                        disabled={isSent || sending === conv.id}
                        activeOpacity={0.8}
                      >
                        {sending === conv.id
                          ? <ActivityIndicator size={14} color="#fff" />
                          : isSent
                          ? <><MaterialIcons name="check" size={13} color="#4de926" /><Text style={{ fontFamily: 'Manrope_600SemiBold', fontSize: 12, color: '#4de926', fontWeight: '700' }}>WYSŁANO</Text></>
                          : <><Feather name="send" size={13} color="#fff" /><Text style={{ fontFamily: 'Manrope_600SemiBold', fontSize: 12, color: '#fff', fontWeight: '700' }}>WYŚLIJ</Text></>
                        }
                      </TouchableOpacity>
                    </View>
                  );
                }}
              />
            )
          )}

          {/* SPOŁECZNOŚĆ */}
          {tab === 'community' && (
            <View style={{ paddingTop: 4 }}>
              {sharedComm ? (
                <View style={{ alignItems: 'center', paddingVertical: 24, gap: 12 }}>
                  <View style={{ width: 72, height: 72, borderRadius: 22, backgroundColor: '#4de92615', justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: '#4de92630' }}>
                    <MaterialIcons name="check-circle" size={40} color="#4de926" />
                  </View>
                  <Text style={{ fontFamily: 'Manrope_600SemiBold', fontSize: 16, color: theme.text, fontWeight: '700', letterSpacing: 1 }}>UDOSTĘPNIONO!</Text>
                  <Text style={{ fontFamily: 'Manrope_600SemiBold', fontSize: 12, color: theme.textDim, textAlign: 'center', lineHeight: 16 }}>
                    Trasa jest widoczna w zakładce{' '}
                    <Text style={{ color: theme.primary }}>Społeczność → Trasy</Text>
                  </Text>
                  <TouchableOpacity style={{ backgroundColor: '#4de926', borderRadius: 12, paddingHorizontal: 32, paddingVertical: 12, marginTop: 8 }} onPress={handleClose}>
                    <Text style={{ fontFamily: 'Manrope_600SemiBold', fontSize: 12, color: '#000', fontWeight: '700' }}>GOTOWE</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <>
                  <Text style={{ fontFamily: 'Manrope_600SemiBold', fontSize: 12, color: theme.textDim, lineHeight: 16, marginBottom: 20 }}>
                    Trasa pojawi się tylko w zakładce{' '}
                    <Text style={{ color: theme.primary }}>Społeczność → Trasy</Text>.
                    {' '}Bez posta w Dyskusjach.
                  </Text>
                  <TouchableOpacity
                    style={[{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: theme.primary, borderRadius: 14, paddingVertical: 14 }, postingComm && { opacity: 0.6 }]}
                    onPress={handleShareToCommunity} disabled={postingComm} activeOpacity={0.8}
                  >
                    {postingComm
                      ? <ActivityIndicator size={14} color="#fff" />
                      : <><MaterialCommunityIcons name="map-marker-path" size={15} color="#fff" /><Text style={{ fontFamily: 'Manrope_600SemiBold', fontSize: 12, color: '#fff', fontWeight: '700', letterSpacing: 1 }}>DODAJ DO TRAS</Text></>
                    }
                  </TouchableOpacity>
                </>
              )}
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}