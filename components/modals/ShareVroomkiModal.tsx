import React, { useEffect, useState } from 'react';
import {
  Modal, View, Text, TouchableOpacity,
  FlatList, ActivityIndicator, Image, Share, TextInput,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme } from '../../contexts/ThemeContext';
import Toast from 'react-native-toast-message';
import { API_URL } from '../../constants/config';
import type { VroomkiPost } from '../../app/Community/community/communityShared';
import { buildVroomkiChatPayload, buildVroomkiShareUrl } from '../../lib/vroomkiShare';

interface Conversation {
  id: number;
  isGroup: boolean;
  name: string;
  avatarUrl: string | null;
  participants: { id: number; username: string; avatarUrl: string | null }[];
}

interface Props {
  visible: boolean;
  post: VroomkiPost | null;
  onClose: () => void;
  myId: number | null;
}

export function ShareVroomkiModal({ visible, post, onClose, myId }: Props) {
  const { theme } = useTheme();
  const [convs, setConvs] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState<number | null>(null);
  const [sent, setSent] = useState<number[]>([]);
  const linkInputRef = React.useRef<TextInput>(null);

  useEffect(() => {
    if (!visible) return;
    setSent([]);
    (async () => {
      setLoading(true);
      try {
        const token = await AsyncStorage.getItem('token');
        const res = await fetch(`${API_URL}/api/chat/conversations`, { headers: { Authorization: `Bearer ${token}` } });
        const json = await res.json();
        setConvs(Array.isArray(json) ? json : json.conversations ?? []);
      } catch {} finally { setLoading(false); }
    })();
  }, [visible]);

  const handleSendToChat = async (convId: number) => {
    if (!post) return;
    setSending(convId);
    try {
      const token = await AsyncStorage.getItem('token');
      const content = JSON.stringify(buildVroomkiChatPayload(post));
      const form = new FormData();
      form.append('content', content);
      await fetch(`${API_URL}/api/chat/conversations/${convId}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      setSent(prev => [...prev, convId]);
    } catch {
      Toast.show({ type: 'error', text1: 'Błąd wysyłania' });
    } finally {
      setSending(null);
    }
  };

  const shareId = post ? (post.id > 0 ? post.id : (post.legacyCarId ?? Math.abs(post.id))) : 0;
  const shareUrl = shareId ? buildVroomkiShareUrl(shareId) : '';

  const handleCopyLink = () => {
    if (!shareUrl) return;
    linkInputRef.current?.focus();
    Toast.show({ type: 'info', text1: 'Zaznacz link i skopiuj' });
  };

  const handleSystemShare = async () => {
    if (!post || !shareUrl) return;
    try {
      await Share.share({
        message: `Zobacz VROOMKĘ @${post.author.username}: ${shareUrl}`,
        url: shareUrl,
      });
    } catch {}
  };

  const cover = post?.videos[0] ?? post?.photos[0] ?? post?.car?.photos?.[0] ?? null;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={{ flex: 1, backgroundColor: theme.overlay, justifyContent: 'flex-end' }}>
        <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={onClose} />
        <View style={{
          backgroundColor: theme.surface,
          borderTopLeftRadius: 24, borderTopRightRadius: 24,
          maxHeight: '88%', borderTopWidth: 1, borderColor: theme.border2,
          paddingHorizontal: 16, paddingBottom: 24,
        }}>
          <View style={{ width: 40, height: 4, backgroundColor: theme.border3, borderRadius: 2, alignSelf: 'center', marginTop: 12, marginBottom: 8 }} />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, borderBottomWidth: 1, borderColor: theme.border }}>
            <MaterialIcons name="smart-display" size={18} color={theme.primary} />
            <Text style={{ fontFamily: 'Orbitron', fontSize: 13, color: theme.text, letterSpacing: 2, flex: 1 }}>UDOSTĘPNIJ VROOMKĘ</Text>
            <TouchableOpacity onPress={onClose} style={{ padding: 4 }}>
              <MaterialIcons name="close" size={20} color={theme.textDim} />
            </TouchableOpacity>
          </View>

          {post && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: theme.surface2, borderRadius: 12, padding: 12, marginVertical: 12, borderWidth: 1, borderColor: theme.primaryBorder }}>
              {cover ? (
                <Image source={{ uri: cover }} style={{ width: 56, height: 72, borderRadius: 8 }} />
              ) : (
                <View style={{ width: 56, height: 72, borderRadius: 8, backgroundColor: theme.bg, justifyContent: 'center', alignItems: 'center' }}>
                  <MaterialIcons name="directions-car" size={28} color={theme.primary} />
                </View>
              )}
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: 'Orbitron', fontSize: 11, color: theme.text, fontWeight: '700' }} numberOfLines={1}>@{post.author.username}</Text>
                {!!post.caption && (
                  <Text style={{ color: theme.textDim, fontSize: 12, marginTop: 4 }} numberOfLines={2}>{post.caption}</Text>
                )}
              </View>
            </View>
          )}

          {!!shareUrl && (
            <TextInput
              ref={linkInputRef}
              value={shareUrl}
              editable={false}
              selectTextOnFocus
              multiline
              style={{
                fontSize: 11,
                color: theme.textDim,
                backgroundColor: theme.surface2,
                borderRadius: 10,
                borderWidth: 1,
                borderColor: theme.border,
                paddingHorizontal: 12,
                paddingVertical: 10,
                marginBottom: 10,
              }}
            />
          )}

          <View style={{ flexDirection: 'row', gap: 8, marginBottom: 14 }}>
            <TouchableOpacity onPress={handleCopyLink} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: theme.surface2, borderRadius: 12, paddingVertical: 12, borderWidth: 1, borderColor: theme.border }}>
              <MaterialIcons name="link" size={16} color={theme.primary} />
              <Text style={{ fontFamily: 'Orbitron', fontSize: 9, color: theme.text, fontWeight: '700' }}>KOPIUJ LINK</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={handleSystemShare} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: theme.primary, borderRadius: 12, paddingVertical: 12 }}>
              <MaterialIcons name="share" size={16} color={theme.onPrimary} />
              <Text style={{ fontFamily: 'Orbitron', fontSize: 9, color: theme.onPrimary, fontWeight: '700' }}>UDOSTĘPNIJ</Text>
            </TouchableOpacity>
          </View>

          <Text style={{ fontFamily: 'Orbitron', fontSize: 9, color: theme.textDim, letterSpacing: 1, marginBottom: 8 }}>WYŚLIJ DO CZATU</Text>
          {loading ? (
            <ActivityIndicator color={theme.primary} style={{ marginVertical: 30 }} />
          ) : (
            <FlatList
              data={convs}
              keyExtractor={c => String(c.id)}
              style={{ maxHeight: 280 }}
              ListEmptyComponent={<Text style={{ fontFamily: 'Orbitron', color: theme.textDim, fontSize: 10, textAlign: 'center', marginTop: 30 }}>Brak rozmów</Text>}
              renderItem={({ item: conv }) => {
                const other = conv.participants?.find(p => p.id !== myId);
                const name = conv.isGroup ? conv.name : other?.username ?? '?';
                const avatar = conv.isGroup ? conv.avatarUrl : other?.avatarUrl ?? null;
                const isSent = sent.includes(conv.id);
                return (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderBottomWidth: 1, borderColor: theme.border }}>
                    {avatar ? (
                      <Image source={{ uri: avatar }} style={{ width: 42, height: 42, borderRadius: 21 }} />
                    ) : (
                      <View style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: theme.surface2, borderWidth: 1, borderColor: theme.primaryBorder, justifyContent: 'center', alignItems: 'center' }}>
                        <Text style={{ color: theme.primary, fontFamily: 'Orbitron', fontSize: 12, fontWeight: '700' }}>{name.slice(0, 2).toUpperCase()}</Text>
                      </View>
                    )}
                    <Text style={{ fontFamily: 'Orbitron', fontSize: 11, color: theme.text, fontWeight: '600', flex: 1 }} numberOfLines={1}>{name}</Text>
                    <TouchableOpacity
                      style={[{ flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
                        isSent ? { backgroundColor: '#4de92615', borderWidth: 1, borderColor: '#4de92630' } : { backgroundColor: theme.primary }]}
                      onPress={() => !isSent && handleSendToChat(conv.id)}
                      disabled={isSent || sending === conv.id}
                    >
                      {sending === conv.id ? (
                        <ActivityIndicator size={14} color="#fff" />
                      ) : isSent ? (
                        <MaterialIcons name="check" size={13} color="#4de926" />
                      ) : (
                        <Text style={{ fontFamily: 'Orbitron', fontSize: 9, color: '#fff', fontWeight: '700' }}>WYŚLIJ</Text>
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
