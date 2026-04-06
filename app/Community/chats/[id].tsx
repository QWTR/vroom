import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  View, Text, FlatList, TextInput, TouchableOpacity,
  Image, StatusBar, KeyboardAvoidingView,
  Platform, ActivityIndicator,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { io, Socket } from 'socket.io-client';
import { useTheme } from '../../../contexts/ThemeContext';
import { ConversationInfoSheet } from '../../../components/chat/ConversationInfoSheet';
import { RouteMessageCard }      from '../../../components/chat/RouteMessageCard';

const API = 'https://v-room.app/api/chat';
const WS  = 'https://v-room.app';

const INPUT_MIN_HEIGHT = 40;
const INPUT_MAX_HEIGHT = 120;

interface ChatUser {
  id:        number;
  username:  string;
  avatarUrl: string | null;
  online?:   boolean;
}

interface Message {
  id:             number;
  content:        string;
  photos:         string[];
  createdAt:      string;
  senderId:       number;
  sender:         ChatUser;
  conversationId: number;
  replyTo?: {
    id:      number;
    content: string;
    sender:  { id: number; username: string };
  } | null;
}

interface ConvInfo {
  id:           number;
  isGroup:      boolean;
  name:         string;
  avatarUrl:    string | null;
  online:       boolean;
  participants: ChatUser[];
}

function parseRouteMessage(content: string) {
  try {
    const parsed = JSON.parse(content);
    if (parsed?.type === 'route') return parsed;
  } catch {}
  return null;
}

export default function ChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router  = useRouter();
  const convId  = parseInt(id);
  const { theme, isDark } = useTheme();

  const [messages,    setMessages]    = useState<Message[]>([]);
  const [conv,        setConv]        = useState<ConvInfo | null>(null);
  const [loading,     setLoading]     = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextCursor,  setNextCursor]  = useState<number | null>(null);
  const [text,        setText]        = useState('');
  const [inputHeight, setInputHeight] = useState(INPUT_MIN_HEIGHT);
  const [photos,      setPhotos]      = useState<string[]>([]);
  const [replyTo,     setReplyTo]     = useState<Message | null>(null);
  const [myId,        setMyId]        = useState<number | null>(null);
  const [typing,      setTyping]      = useState<string[]>([]);
  const [infoVisible, setInfoVisible] = useState(false);

  const listRef     = useRef<FlatList>(null);
  const socketRef   = useRef<Socket | null>(null);
  const tokenRef    = useRef<string>('');
  const typingTimer = useRef<any>(null);

  useEffect(() => {
    (async () => {
      const raw   = await AsyncStorage.getItem('user');
      const token = await AsyncStorage.getItem('token') ?? '';
      tokenRef.current = token;
      if (raw) setMyId(JSON.parse(raw).userId);

      const socket = io(WS, { auth: { token }, transports: ['websocket'] });
      socket.emit('chat:join', convId);

      socket.on('chat:message', (msg: Message) => {
        if (msg.conversationId === convId) {
          setMessages(prev => [...prev, msg]);
          setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 80);
        }
      });

      socket.on('chat:typing', ({ isTyping, username }: any) => {
        setTyping(prev =>
          isTyping ? [...new Set([...prev, username])] : prev.filter(u => u !== username)
        );
      });

      socketRef.current = socket;
      await Promise.all([fetchConv(token), fetchMessages(token)]);
    })();

    return () => {
      socketRef.current?.emit('chat:leave', convId);
      socketRef.current?.disconnect();
    };
  }, [convId]);

  const fetchConv = async (token: string) => {
    try {
      const r = await fetch(`${API}/conversations/${convId}`, { headers: { Authorization: `Bearer ${token}` } });
      setConv(await r.json());
    } catch (e) { console.error('fetchConv:', e); }
  };

  const fetchMessages = async (token: string) => {
    setLoading(true);
    try {
      const r = await fetch(`${API}/conversations/${convId}/messages`, { headers: { Authorization: `Bearer ${token}` } });
      const d = await r.json();
      setMessages(d.messages ?? []);
      setNextCursor(d.nextCursor);
      setTimeout(() => listRef.current?.scrollToEnd({ animated: false }), 100);
    } catch (e) { console.error('fetchMessages:', e); }
    finally { setLoading(false); }
  };

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const r = await fetch(
        `${API}/conversations/${convId}/messages?cursor=${nextCursor}`,
        { headers: { Authorization: `Bearer ${tokenRef.current}` } },
      );
      const d = await r.json();
      setMessages(prev => [...(d.messages ?? []), ...prev]);
      setNextCursor(d.nextCursor);
    } catch (e) { console.error('loadMore:', e); }
    finally { setLoadingMore(false); }
  }, [convId, nextCursor, loadingMore]);

  const handleSend = useCallback(async () => {
    if (!text.trim() && !photos.length) return;
    const t = text.trim();
    const p = [...photos];
    setText(''); setPhotos([]); setReplyTo(null); setInputHeight(INPUT_MIN_HEIGHT);

    const form = new FormData();
    if (t)           form.append('content', t);
    if (replyTo?.id) form.append('replyToId', String(replyTo.id));
    p.forEach((uri, i) => {
      form.append('photos', { uri, type: 'image/jpeg', name: `photo_${i}.jpg` } as any);
    });

    try {
      await fetch(`${API}/conversations/${convId}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${tokenRef.current}` },
        body: form,
      });
    } catch (e) { console.error('sendMessage:', e); }
  }, [text, photos, replyTo, convId]);

  const emitTyping = useCallback(() => {
    socketRef.current?.emit('chat:typing', { conversationId: convId, isTyping: true });
    clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => {
      socketRef.current?.emit('chat:typing', { conversationId: convId, isTyping: false });
    }, 2000);
  }, [convId]);

  const handlePickPhoto = async () => {
    const r = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: true, quality: 0.8,
    });
    if (!r.canceled) {
      setPhotos(prev => [...prev, ...r.assets.map(a => a.uri)].slice(0, 4));
    }
  };

  const handleNavigateRoute = useCallback(async (data: any) => {
    await AsyncStorage.setItem('nav_route', JSON.stringify({
      routeId: data.routeId, routeName: data.name,
      points: data.points, distance: data.distance,
    }));
    router.push('/(tabs)/map');
  }, [router]);

  const renderMessage = useCallback(({ item, index }: { item: Message; index: number }) => {
    const isMe    = item.senderId === myId;
    const prevMsg = messages[index - 1];
    const nextMsg = messages[index + 1];
    const isFirst = !prevMsg || prevMsg.senderId !== item.senderId;
    const isLast  = !nextMsg || nextMsg.senderId !== item.senderId;
    const showAvatar = !isMe && isLast;
    const showName   = !isMe && isFirst && (conv?.isGroup ?? false);

    const R = 18, T = 5;
    const bubbleStyle = isMe
      ? { borderTopLeftRadius: R, borderBottomLeftRadius: R, borderTopRightRadius: isFirst ? R : T, borderBottomRightRadius: isLast ? R : T }
      : { borderTopRightRadius: R, borderBottomRightRadius: R, borderTopLeftRadius: isFirst ? R : T, borderBottomLeftRadius: isLast ? R : T };

    const routeData = parseRouteMessage(item.content);

    return (
      <View style={[
        { flexDirection: 'row', alignItems: 'flex-end', gap: 6, marginVertical: 1, marginBottom: isLast ? 8 : 2 },
        isMe ? { justifyContent: 'flex-end', paddingLeft: 48 } : { justifyContent: 'flex-start', paddingRight: 48 },
      ]}>
        {!isMe && (
          <View style={{ width: 30, alignItems: 'center', justifyContent: 'flex-end' }}>
            {showAvatar && (
              item.sender.avatarUrl
                ? <Image source={{ uri: item.sender.avatarUrl }} style={{ width: 28, height: 28, borderRadius: 14 }} />
                : (
                  <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: theme.surface2, borderWidth: 1.5, borderColor: theme.primaryBorder, alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ color: theme.primary, fontFamily: 'Orbitron', fontSize: 9, fontWeight: '700' }}>
                      {item.sender.username?.slice(0, 2).toUpperCase()}
                    </Text>
                  </View>
                )
            )}
          </View>
        )}

        {routeData ? (
          <View style={isMe ? { alignItems: 'flex-end' } : { alignItems: 'flex-start' }}>
            {showName && <Text style={{ color: theme.primary, fontFamily: 'Orbitron', fontSize: 9, fontWeight: '700', marginBottom: 2 }}>{item.sender.username}</Text>}
            <RouteMessageCard data={routeData} isMe={isMe} onNavigate={handleNavigateRoute} />
            <Text style={{ fontSize: 9, alignSelf: 'flex-end', marginTop: 2, color: isMe ? '#ffffff60' : theme.textDim }}>
              {new Date(item.createdAt).toLocaleTimeString('pl', { hour: '2-digit', minute: '2-digit' })}
            </Text>
          </View>
        ) : (
          <TouchableOpacity
            style={[{
              maxWidth: '100%', paddingHorizontal: 12, paddingVertical: 8, gap: 4,
              ...(isMe
                ? { backgroundColor: theme.primary }
                : { backgroundColor: theme.surface2, borderWidth: 1, borderColor: theme.border }),
            }, bubbleStyle]}
            onLongPress={() => setReplyTo(item)}
            activeOpacity={0.85}
          >
            {showName && <Text style={{ color: theme.primary, fontFamily: 'Orbitron', fontSize: 9, fontWeight: '700', marginBottom: 2 }}>{item.sender.username}</Text>}

            {item.replyTo && (
              <View style={{ backgroundColor: '#00000020', borderRadius: 8, borderLeftWidth: 3, borderLeftColor: isMe ? '#ffffff90' : '#ffffff60', paddingHorizontal: 8, paddingVertical: 4, marginBottom: 4, gap: 2 }}>
                <Text style={{ color: '#ffffffaa', fontFamily: 'Orbitron', fontSize: 8, fontWeight: '700' }}>{item.replyTo.sender.username}</Text>
                <Text style={{ color: '#ffffff70', fontSize: 11 }} numberOfLines={1}>{item.replyTo.content || '📷 Zdjęcie'}</Text>
              </View>
            )}

            {item.photos?.length > 0 && (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
                {item.photos.map((uri, i) => (
                  <Image key={i} source={{ uri }} style={item.photos.length === 1 ? { width: 200, height: 150, borderRadius: 12 } : { width: 120, height: 90, borderRadius: 8 }} />
                ))}
              </View>
            )}

            {!!item.content && (
              <Text style={{ fontSize: 14, lineHeight: 20, color: isMe ? '#fff' : theme.textMuted }}>{item.content}</Text>
            )}

            <Text style={{ fontSize: 9, alignSelf: 'flex-end', color: isMe ? '#ffffff60' : theme.textDim }}>
              {new Date(item.createdAt).toLocaleTimeString('pl', { hour: '2-digit', minute: '2-digit' })}
            </Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }, [myId, messages, conv, handleNavigateRoute, theme]);

  const typingText   = typing.length === 1 ? `${typing[0]} pisze...` : typing.length > 1 ? `${typing.slice(0, 2).join(', ')} piszą...` : null;
  const convName     = conv?.isGroup ? conv.name : conv?.participants?.find(p => p.id !== myId)?.username ?? '...';
  const convAvatar   = conv?.isGroup ? conv.avatarUrl : conv?.participants?.find(p => p.id !== myId)?.avatarUrl ?? null;
  const convOnline   = !conv?.isGroup ? (conv?.participants?.find(p => p.id !== myId)?.online ?? false) : false;

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: theme.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={0}
    >
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={theme.surface} />

      {/* HEADER */}
      <View style={{
        flexDirection: 'row', alignItems: 'center',
        paddingTop: Platform.OS === 'ios' ? 56 : 44,
        paddingBottom: 12, paddingHorizontal: 12,
        backgroundColor: theme.surface,
        borderBottomWidth: 1, borderBottomColor: theme.border, gap: 10,
      }}>
        <TouchableOpacity style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: theme.surface2, alignItems: 'center', justifyContent: 'center' }} onPress={() => router.back()}>
          <Feather name="arrow-left" size={20} color={theme.text} />
        </TouchableOpacity>

        <TouchableOpacity style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 }} onPress={() => setInfoVisible(true)} activeOpacity={0.75}>
          {convAvatar
            ? <Image source={{ uri: convAvatar }} style={{ width: 40, height: 40, borderRadius: 20 }} />
            : (
              <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: theme.surface2, borderWidth: 1.5, borderColor: theme.primaryBorder, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ color: theme.primary, fontFamily: 'Orbitron', fontSize: 12, fontWeight: '700' }}>
                  {convName?.slice(0, 2).toUpperCase() ?? '??'}
                </Text>
              </View>
            )
          }
          <View style={{ flex: 1, gap: 3 }}>
            <Text style={{ color: theme.text, fontFamily: 'Orbitron', fontSize: 12, fontWeight: '700' }} numberOfLines={1}>{convName}</Text>
            {typingText
              ? <Text style={{ color: theme.primary, fontSize: 10, fontStyle: 'italic' }}>{typingText}</Text>
              : (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                  <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: convOnline ? '#4de926' : theme.textDim }} />
                  <Text style={{ color: theme.textDim, fontSize: 10 }}>{convOnline ? 'Online' : 'Offline'}</Text>
                </View>
              )
            }
          </View>
        </TouchableOpacity>

        <TouchableOpacity style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: theme.surface2, alignItems: 'center', justifyContent: 'center' }} onPress={() => setInfoVisible(true)}>
          <Feather name="info" size={18} color={theme.textDim} />
        </TouchableOpacity>
      </View>

      {/* WIADOMOŚCI */}
      {loading
        ? <ActivityIndicator style={{ flex: 1 }} color={theme.primary} />
        : (
          <FlatList
            ref={listRef}
            data={messages}
            keyExtractor={i => String(i.id)}
            renderItem={renderMessage}
            onEndReached={loadMore}
            onEndReachedThreshold={0.15}
            ListHeaderComponent={loadingMore ? <ActivityIndicator color={theme.primary} style={{ marginVertical: 10 }} /> : null}
            ListEmptyComponent={
              <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, paddingTop: 80 }}>
                <MaterialCommunityIcons name="chat-outline" size={40} color={theme.border3} />
                <Text style={{ color: theme.textDim, fontFamily: 'Orbitron', fontSize: 13, fontWeight: '700' }}>Brak wiadomości</Text>
                <Text style={{ color: theme.textDim, fontFamily: 'Orbitron', fontSize: 9 }}>Napisz pierwszą wiadomość!</Text>
              </View>
            }
            contentContainerStyle={{ paddingHorizontal: 12, paddingTop: 12, paddingBottom: 8, flexGrow: 1 }}
            keyboardShouldPersistTaps="handled"
            onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
          />
        )
      }

      {/* BOTTOM */}
      <View style={{ backgroundColor: theme.surface, borderTopWidth: 1, borderTopColor: theme.border, paddingBottom: Platform.OS === 'ios' ? 28 : 10 }}>

        {replyTo && (
          <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: theme.border, gap: 10 }}>
            <View style={{ width: 3, height: '100%', backgroundColor: theme.primary, borderRadius: 2 }} />
            <View style={{ flex: 1 }}>
              <Text style={{ color: theme.primary, fontFamily: 'Orbitron', fontSize: 9, fontWeight: '700', marginBottom: 2 }}>{replyTo.sender.username}</Text>
              <Text style={{ color: theme.textDim, fontSize: 11 }} numberOfLines={1}>{replyTo.content || '📷 Zdjęcie'}</Text>
            </View>
            <TouchableOpacity style={{ padding: 4 }} onPress={() => setReplyTo(null)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Feather name="x" size={16} color={theme.textDim} />
            </TouchableOpacity>
          </View>
        )}

        {photos.length > 0 && (
          <View style={{ flexDirection: 'row', paddingHorizontal: 14, paddingTop: 10, gap: 8 }}>
            {photos.map((uri, i) => (
              <View key={i} style={{ position: 'relative' }}>
                <Image source={{ uri }} style={{ width: 58, height: 58, borderRadius: 10 }} />
                <TouchableOpacity
                  style={{ position: 'absolute', top: -4, right: -4, width: 18, height: 18, borderRadius: 9, backgroundColor: theme.primary, alignItems: 'center', justifyContent: 'center' }}
                  onPress={() => setPhotos(prev => prev.filter((_, j) => j !== i))}
                >
                  <Feather name="x" size={10} color="#fff" />
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}

        <View style={{ flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: 10, paddingTop: 10, gap: 8 }}>
          <TouchableOpacity style={{ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' }} onPress={handlePickPhoto}>
            <Feather name="image" size={21} color={theme.textDim} />
          </TouchableOpacity>

          <TextInput
            style={{
              flex: 1, color: theme.text, fontSize: 14, lineHeight: 20,
              backgroundColor: theme.surface2, borderRadius: 20,
              paddingHorizontal: 16, paddingTop: 10, paddingBottom: 10,
              borderWidth: 1, borderColor: theme.border,
              height: Math.max(INPUT_MIN_HEIGHT, inputHeight),
            }}
            value={text}
            onChangeText={t => { setText(t); emitTyping(); }}
            onContentSizeChange={e => {
              const h = e.nativeEvent.contentSize.height;
              setInputHeight(Math.min(h, INPUT_MAX_HEIGHT));
            }}
            placeholder="Napisz wiadomość..."
            placeholderTextColor={theme.textDim}
            multiline maxLength={2000}
            scrollEnabled={inputHeight >= INPUT_MAX_HEIGHT}
          />

          <TouchableOpacity
            style={[{ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.primary },
              (!text.trim() && !photos.length) && { backgroundColor: `${theme.primary}30` }]}
            onPress={handleSend}
            disabled={!text.trim() && !photos.length}
          >
            <Feather name="send" size={17} color="#fff" />
          </TouchableOpacity>
        </View>
      </View>

      <ConversationInfoSheet
        visible={infoVisible}
        onClose={() => setInfoVisible(false)}
        convId={convId}
        isGroup={conv?.isGroup ?? false}
        convName={convName}
        convAvatar={convAvatar}
        participants={conv?.participants ?? []}
        myId={myId}
        onViewProfile={userId => router.push(`/profile/${userId}` as any)}
        onConvUpdated={(name, avatar) => setConv(prev => prev ? { ...prev, name, avatarUrl: avatar } : prev)}
      />
    </KeyboardAvoidingView>
  );
}