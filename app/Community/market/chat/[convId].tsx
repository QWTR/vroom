import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  View, Text, FlatList, TextInput, TouchableOpacity,
  StatusBar, KeyboardAvoidingView, Platform, ActivityIndicator,
} from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme } from '../../../../contexts/ThemeContext';
import { API_URL } from '../../../../constants/config';

const INPUT_MIN_HEIGHT = 40;
const INPUT_MAX_HEIGHT = 120;
const PAGE_SIZE        = 30;

interface MarketConvInfo {
  id: number;
  listing: {
    id: number;
    title: string;
    price: number;
    photos: string[];
  };
  buyer:   { id: number; username: string; avatarUrl: string | null };
  seller:  { id: number; username: string; avatarUrl: string | null };
}

interface Message {
  id:             number;
  content:        string;
  photos:         string[];
  createdAt:      string;
  senderId:       number;
  sender:         { id: number; username: string; avatarUrl: string | null };
}

export default function MarketChatScreen() {
  const { convId } = useLocalSearchParams<{ convId: string }>();
  const router     = useRouter();
  const numConvId  = parseInt(convId);
  const { theme, isDark } = useTheme();
  const insets     = useSafeAreaInsets();

  const [messages,    setMessages]    = useState<Message[]>([]);
  const [conv,        setConv]        = useState<MarketConvInfo | null>(null);
  const [loading,     setLoading]     = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore,     setHasMore]     = useState(true);
  const [nextCursor,  setNextCursor]  = useState<number | null>(null);
  const [text,        setText]        = useState('');
  const [inputHeight, setInputHeight] = useState(INPUT_MIN_HEIGHT);
  const [photos,      setPhotos]      = useState<string[]>([]);
  const [myId,        setMyId]        = useState<number | null>(null);
  const [sending,     setSending]     = useState(false);

  const listRef    = useRef<FlatList>(null);
  const tokenRef   = useRef('');

  const getToken = async () =>
    (await AsyncStorage.getItem('userToken')) ?? (await AsyncStorage.getItem('token')) ?? '';

  useEffect(() => {
    (async () => {
      const raw   = await AsyncStorage.getItem('user');
      const token = await getToken();
      tokenRef.current = token;
      if (raw) setMyId(JSON.parse(raw)?.userId ?? JSON.parse(raw)?.id);
      await Promise.all([fetchConv(token), fetchMessages(token)]);
    })();
  }, [numConvId]);

  const fetchConv = async (token: string) => {
    try {
      const r    = await fetch(`${API_URL}/api/market/conversations/${numConvId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await r.json();
      setConv(data);
    } catch (e) { console.error('fetchConv:', e); }
  };

  const fetchMessages = async (token: string, cursor?: number) => {
    if (!cursor) setLoading(true);
    else setLoadingMore(true);
    try {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
      if (cursor) params.append('cursor', String(cursor));
      const r    = await fetch(
        `${API_URL}/api/market/conversations/${numConvId}/messages?${params}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      const d    = await r.json();
      const msgs = d.messages ?? [];
      if (cursor) {
        setMessages(prev => [...msgs, ...prev]);
      } else {
        setMessages(msgs);
        setTimeout(() => listRef.current?.scrollToEnd({ animated: false }), 100);
      }
      setNextCursor(d.nextCursor ?? null);
      setHasMore(!!d.nextCursor);
    } catch (e) { console.error('fetchMessages:', e); }
    finally {
      setLoading(false);
      setLoadingMore(false);
    }
  };

  const loadMore = useCallback(async () => {
    if (!hasMore || loadingMore || !nextCursor) return;
    await fetchMessages(tokenRef.current, nextCursor);
  }, [hasMore, loadingMore, nextCursor]);

  const handlePickPhoto = async () => {
    if (photos.length >= 5) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: true,
      quality: 0.85,
    });
    if (!result.canceled) {
      setPhotos(prev => [...prev, ...result.assets.map(a => a.uri)].slice(0, 5));
    }
  };

  const handleSend = async () => {
    if ((!text.trim() && photos.length === 0) || sending) return;
    setSending(true);
    try {
      const formData = new FormData();
      if (text.trim()) formData.append('content', text.trim());
      for (const uri of photos) {
        const filename = uri.split('/').pop() ?? 'photo.jpg';
        const ext      = filename.split('.').pop()?.toLowerCase() ?? 'jpg';
        formData.append('photos', { uri, name: filename, type: ext === 'png' ? 'image/png' : 'image/jpeg' } as any);
      }
      const r = await fetch(
        `${API_URL}/api/market/conversations/${numConvId}/messages`,
        { method: 'POST', headers: { Authorization: `Bearer ${tokenRef.current}` }, body: formData },
      );
      if (!r.ok) throw new Error('Send failed');
      const newMsg = await r.json();
      setMessages(prev => [...prev, newMsg]);
      setText('');
      setPhotos([]);
      setInputHeight(INPUT_MIN_HEIGHT);
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 80);
    } catch (e) {
      console.error('handleSend:', e);
    } finally {
      setSending(false);
    }
  };

  const renderMessage = useCallback(({ item, index }: { item: Message; index: number }) => {
    const isMe = item.senderId === myId;
    const showName = !isMe && (index === 0 || messages[index - 1]?.senderId !== item.senderId);
    const bubbleRadius = {
      borderTopLeftRadius:     isMe ? 18 : (showName ? 4 : 18),
      borderTopRightRadius:    isMe ? (index === 0 || messages[index - 1]?.senderId !== item.senderId ? 4 : 18) : 18,
      borderBottomLeftRadius:  isMe ? 18 : 4,
      borderBottomRightRadius: isMe ? 4 : 18,
    };

    return (
      <View style={{ flexDirection: isMe ? 'row-reverse' : 'row', alignItems: 'flex-end', gap: 8, marginBottom: 6, paddingHorizontal: 12 }}>
        {!isMe && (
          <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: theme.primaryBg, borderWidth: 1, borderColor: theme.primaryBorder, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginBottom: 2 }}>
            {item.sender.avatarUrl
              ? <Image source={{ uri: item.sender.avatarUrl }} style={{ width: '100%', height: '100%' }} />
              : <Text style={{ color: theme.primary, fontFamily: 'Orbitron', fontSize: 8, fontWeight: '700' }}>{item.sender.username.charAt(0).toUpperCase()}</Text>
            }
          </View>
        )}

        <View style={{ maxWidth: '78%', gap: 3, alignItems: isMe ? 'flex-end' : 'flex-start' }}>
          {showName && (
            <Text style={{ color: '#e33835', fontFamily: 'Orbitron', fontSize: 9, fontWeight: '700', marginLeft: 4 }}>
              {item.sender.username}
            </Text>
          )}

          <View style={[{
            paddingHorizontal: 12, paddingVertical: 8, gap: 4,
            ...(isMe
              ? { backgroundColor: '#e33835' }
              : { backgroundColor: theme.surface2, borderWidth: 1, borderColor: theme.border }),
          }, bubbleRadius]}>
            {item.photos?.length > 0 && (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
                {item.photos.map((uri, i) => (
                  <Image key={i} source={{ uri }}
                    style={item.photos.length === 1 ? { width: 200, height: 150, borderRadius: 10 } : { width: 120, height: 90, borderRadius: 8 }}
                    contentFit="cover"
                  />
                ))}
              </View>
            )}
            {!!item.content && (
              <Text style={{ fontSize: 14, lineHeight: 20, color: isMe ? '#fff' : theme.textMuted }}>{item.content}</Text>
            )}
            <Text style={{ fontSize: 9, alignSelf: 'flex-end', color: isMe ? '#ffffff60' : theme.textDim }}>
              {new Date(item.createdAt).toLocaleTimeString('pl', { hour: '2-digit', minute: '2-digit' })}
            </Text>
          </View>
        </View>
      </View>
    );
  }, [myId, messages, theme]);

  const HEADER_HEIGHT = (Platform.OS === 'ios' ? 56 : 44) + 12 + insets.top;

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor="transparent" translucent />

      {/* HEADER */}
      <View style={{
        paddingTop: insets.top + 10,
        paddingBottom: 0,
        backgroundColor: theme.surface,
        borderBottomWidth: 1,
        borderBottomColor: theme.border,
      }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingBottom: 12, gap: 10 }}>
          <TouchableOpacity
            style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: theme.surface2, borderWidth: 1, borderColor: theme.border, alignItems: 'center', justifyContent: 'center' }}
            onPress={() => router.back()}
          >
            <Feather name="arrow-left" size={18} color={theme.text} />
          </TouchableOpacity>

          {/* Listing banner */}
          {conv?.listing && (
            <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              {conv.listing.photos?.[0] && (
                <Image source={{ uri: conv.listing.photos[0] }} style={{ width: 40, height: 40, borderRadius: 8, borderWidth: 1, borderColor: theme.border }} contentFit="cover" />
              )}
              <View style={{ flex: 1 }}>
                <Text style={{ color: theme.text, fontFamily: 'Orbitron', fontSize: 10, fontWeight: '700' }} numberOfLines={1}>
                  {conv.listing.title}
                </Text>
                <Text style={{ color: theme.primary, fontFamily: 'Orbitron', fontSize: 11, fontWeight: '900' }}>
                  {conv.listing.price.toLocaleString('pl-PL')} PLN
                </Text>
              </View>
            </View>
          )}
        </View>
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? HEADER_HEIGHT : 0}
      >
        {loading ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <ActivityIndicator color={theme.primary} />
          </View>
        ) : (
          <FlatList
            ref={listRef}
            data={messages}
            keyExtractor={i => String(i.id)}
            renderItem={renderMessage}
            ListHeaderComponent={
              hasMore ? (
                loadingMore
                  ? <ActivityIndicator color={theme.primary} style={{ marginVertical: 14 }} />
                  : (
                    <TouchableOpacity style={{ alignItems: 'center', paddingVertical: 12 }} onPress={loadMore}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#e3383515', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 7, borderWidth: 1, borderColor: '#e3383530' }}>
                        <Text style={{ color: '#e33835', fontFamily: 'Orbitron', fontSize: 8, letterSpacing: 1 }}>ZAŁADUJ STARSZE</Text>
                      </View>
                    </TouchableOpacity>
                  )
              ) : null
            }
            ListEmptyComponent={
              <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingTop: 80 }}>
                <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: '#e3383510', borderWidth: 1, borderColor: '#e3383525', alignItems: 'center', justifyContent: 'center' }}>
                  <MaterialCommunityIcons name="chat-outline" size={28} color="#e3383560" />
                </View>
                <Text style={{ color: theme.text, fontFamily: 'Orbitron', fontSize: 12, fontWeight: '700' }}>Brak wiadomości</Text>
                <Text style={{ color: theme.textDim, fontFamily: 'Orbitron', fontSize: 9 }}>Napisz pierwszą wiadomość!</Text>
              </View>
            }
            contentContainerStyle={{ paddingTop: 10, paddingBottom: 8, flexGrow: 1 }}
            keyboardShouldPersistTaps="handled"
          />
        )}

        {/* INPUT */}
        <View style={{
          backgroundColor: theme.surface,
          borderTopWidth: 1, borderTopColor: theme.border,
          paddingBottom: Platform.OS === 'ios' ? Math.max(insets.bottom, 16) : Math.max(insets.bottom, 10),
        }}>
          {photos.length > 0 && (
            <View style={{ flexDirection: 'row', paddingHorizontal: 14, paddingTop: 10, gap: 8 }}>
              {photos.map((uri, i) => (
                <View key={i} style={{ position: 'relative' }}>
                  <Image source={{ uri }} style={{ width: 58, height: 58, borderRadius: 10, borderWidth: 1, borderColor: theme.border }} contentFit="cover" />
                  <TouchableOpacity
                    style={{ position: 'absolute', top: -5, right: -5, width: 20, height: 20, borderRadius: 10, backgroundColor: '#e33835', alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: theme.surface }}
                    onPress={() => setPhotos(prev => prev.filter((_, j) => j !== i))}
                  >
                    <Feather name="x" size={10} color="#fff" />
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          )}

          <View style={{ flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: 10, paddingTop: 10, gap: 8 }}>
            <TouchableOpacity
              style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: theme.surface2, borderWidth: 1, borderColor: theme.border, alignItems: 'center', justifyContent: 'center' }}
              onPress={handlePickPhoto}
            >
              <Feather name="image" size={18} color={theme.textDim} />
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
              onChangeText={setText}
              onContentSizeChange={e => {
                const h = e.nativeEvent.contentSize.height;
                setInputHeight(Math.min(h, INPUT_MAX_HEIGHT));
              }}
              placeholder="Napisz wiadomość..."
              placeholderTextColor={theme.textDim}
              multiline
              maxLength={2000}
              scrollEnabled={inputHeight >= INPUT_MAX_HEIGHT}
            />

            <TouchableOpacity
              style={{
                width: 40, height: 40, borderRadius: 20,
                backgroundColor: (text.trim() || photos.length) ? '#e33835' : '#e3383530',
                alignItems: 'center', justifyContent: 'center',
              }}
              onPress={handleSend}
              disabled={(!text.trim() && !photos.length) || sending}
            >
              {sending
                ? <ActivityIndicator size="small" color="#fff" />
                : <Feather name="send" size={17} color="#fff" />
              }
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}
