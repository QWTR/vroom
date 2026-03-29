import React, { useEffect, useState } from 'react';
import {
  Modal, View, Text, TouchableOpacity, StyleSheet,
  FlatList, ActivityIndicator, Image,
} from 'react-native';
import { MaterialIcons, MaterialCommunityIcons, Feather } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { RouteMiniMap } from '../profile/RouteMiniMap';
import type { MyRoute } from '../../hooks/useMyRoutes';

const API = 'https://v-room.app/api/chat';

interface Conversation {
  id:           number;
  isGroup:      boolean;
  name:         string;
  avatarUrl:    string | null;
  lastMessage:  string | null;
  participants: { id: number; username: string; avatarUrl: string | null }[];
}

interface Props {
  visible:  boolean;
  route:    MyRoute | null;
  onClose:  () => void;
  onSent:   () => void;
  myId:     number | null;
}

export function ShareRouteModal({ visible, route, onClose, onSent, myId }: Props) {
  const [convs,    setConvs]    = useState<Conversation[]>([]);
  const [loading,  setLoading]  = useState(false);
  const [sending,  setSending]  = useState<number | null>(null);
  const [sent,     setSent]     = useState<number[]>([]);

  useEffect(() => {
    if (!visible) return;
    fetchConvs();
  }, [visible]);

  const fetchConvs = async () => {
    setLoading(true);
    try {
      const token = await AsyncStorage.getItem('token');
      const res   = await fetch(`${API}/conversations`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      setConvs(Array.isArray(json) ? json : json.conversations ?? []);
    } catch (e) { console.log('fetchConvs error:', e); }
    finally { setLoading(false); }
  };

  const handleSend = async (convId: number) => {
    if (!route) return;
    setSending(convId);
    try {
      const token = await AsyncStorage.getItem('token');

      // Wyślij jako specjalną wiadomość JSON z typem "route"
      const content = JSON.stringify({
        type:     'route',
        routeId:  route.id,
        name:     route.name,
        distance: route.distance,
        points:   route.points.slice(0, 50), // max 50 punktów do podglądu
        isPublic: route.isPublic,
      });

      const form = new FormData();
      form.append('content', content);

      await fetch(`${API}/conversations/${convId}/messages`, {
        method:  'POST',
        headers: { Authorization: `Bearer ${token}` },
        body:    form,
      });

      setSent(prev => [...prev, convId]);
    } catch (e) { console.log('shareRoute error:', e); }
    finally { setSending(null); }
  };

  const handleClose = () => {
    setSent([]);
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={handleClose}>
      <View style={s.overlay}>
        <View style={s.sheet}>
          <View style={s.handle} />

          {/* Nagłówek */}
          <View style={s.header}>
            <MaterialCommunityIcons name="map-marker-path" size={18} color="#e33835" />
            <Text style={s.title}>WYŚLIJ TRASĘ</Text>
            <TouchableOpacity onPress={handleClose} style={s.closeBtn}>
              <MaterialIcons name="close" size={20} color="#ffffff60" />
            </TouchableOpacity>
          </View>

          {/* Podgląd trasy */}
          {route && (
            <View style={s.routePreview}>
              <View style={s.miniMapWrap}>
                <RouteMiniMap points={route.points} width={80} height={50} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.routeName} numberOfLines={1}>{route.name}</Text>
                <Text style={s.routeDist}>{route.distance.toFixed(1)} km · {route.points.length} pkt</Text>
              </View>
            </View>
          )}

          <Text style={s.sectionLabel}>WYBIERZ ROZMOWĘ</Text>

          {loading ? (
            <ActivityIndicator color="#e33835" style={{ marginVertical: 30 }} />
          ) : (
            <FlatList
              data={convs}
              keyExtractor={c => String(c.id)}
              showsVerticalScrollIndicator={false}
              style={{ maxHeight: 380 }}
              contentContainerStyle={{ paddingBottom: 20 }}
              ListEmptyComponent={
                <Text style={s.empty}>Brak rozmów</Text>
              }
              renderItem={({ item: conv }) => {
                const other   = conv.participants.find(p => p.id !== myId);
                const name    = conv.isGroup ? conv.name : other?.username ?? '?';
                const avatar  = conv.isGroup ? conv.avatarUrl : other?.avatarUrl ?? null;
                const isSent  = sent.includes(conv.id);

                return (
                  <View style={s.convRow}>
                    {/* Avatar */}
                    {avatar ? (
                      <Image source={{ uri: avatar }} style={s.avatar} />
                    ) : (
                      <View style={[s.avatar, s.avatarFallback]}>
                        <Text style={s.avatarTxt}>{name.slice(0, 2).toUpperCase()}</Text>
                      </View>
                    )}

                    {/* Info */}
                    <View style={{ flex: 1 }}>
                      <Text style={s.convName} numberOfLines={1}>{name}</Text>
                      {conv.isGroup && (
                        <Text style={s.convSub}>{conv.participants.length} uczestników</Text>
                      )}
                    </View>

                    {/* Wyślij / wysłano */}
                    <TouchableOpacity
                      style={[s.sendBtn, isSent && s.sendBtnSent]}
                      onPress={() => !isSent && handleSend(conv.id)}
                      disabled={isSent || sending === conv.id}
                      activeOpacity={0.8}
                    >
                      {sending === conv.id ? (
                        <ActivityIndicator size={14} color="#fff" />
                      ) : isSent ? (
                        <>
                          <MaterialIcons name="check" size={13} color="#4de926" />
                          <Text style={[s.sendTxt, { color: '#4de926' }]}>WYSŁANO</Text>
                        </>
                      ) : (
                        <>
                          <Feather name="send" size={13} color="#fff" />
                          <Text style={s.sendTxt}>WYŚLIJ</Text>
                        </>
                      )}
                    </TouchableOpacity>
                  </View>
                );
              }}
            />
          )}
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay:      { flex: 1, backgroundColor: '#000000aa', justifyContent: 'flex-end' },
  sheet:        { backgroundColor: '#111', borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '85%', borderTopWidth: 1, borderColor: '#ffffff12', paddingHorizontal: 16 },
  handle:       { width: 40, height: 4, backgroundColor: '#ffffff20', borderRadius: 2, alignSelf: 'center', marginTop: 12, marginBottom: 8 },
  header:       { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, borderBottomWidth: 1, borderColor: '#ffffff08' },
  title:        { fontFamily: 'Orbitron', fontSize: 13, color: '#fff', letterSpacing: 2, flex: 1 },
  closeBtn:     { padding: 4 },

  routePreview: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#1a1a1a', borderRadius: 12, padding: 12, marginVertical: 12, borderWidth: 1, borderColor: '#e3383525' },
  miniMapWrap:  { backgroundColor: '#0a0a0a', borderRadius: 8, overflow: 'hidden', borderWidth: 1, borderColor: '#ffffff10' },
  routeName:    { fontFamily: 'Orbitron', fontSize: 12, color: '#fff', fontWeight: '700' },
  routeDist:    { fontFamily: 'Orbitron', fontSize: 9, color: '#ffffff50', marginTop: 3 },

  sectionLabel: { fontFamily: 'Orbitron', fontSize: 8, color: '#ffffff30', letterSpacing: 2, marginBottom: 10 },
  empty:        { fontFamily: 'Orbitron', color: '#ffffff30', fontSize: 10, textAlign: 'center', marginTop: 30 },

  convRow:      { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderBottomWidth: 1, borderColor: '#ffffff06' },
  avatar:       { width: 42, height: 42, borderRadius: 21 },
  avatarFallback:{ backgroundColor: '#1a1a1a', borderWidth: 1, borderColor: '#e3383530', justifyContent: 'center', alignItems: 'center' },
  avatarTxt:    { color: '#e33835', fontFamily: 'Orbitron', fontSize: 12, fontWeight: '700' },
  convName:     { fontFamily: 'Orbitron', fontSize: 11, color: '#fff', fontWeight: '600' },
  convSub:      { fontFamily: 'Orbitron', fontSize: 8, color: '#ffffff40', marginTop: 2 },

  sendBtn:      { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: '#e33835', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
  sendBtnSent:  { backgroundColor: '#4de92615', borderWidth: 1, borderColor: '#4de92630' },
  sendTxt:      { fontFamily: 'Orbitron', fontSize: 9, color: '#fff', fontWeight: '700' },
});