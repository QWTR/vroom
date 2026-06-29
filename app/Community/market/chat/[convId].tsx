import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StatusBar, Platform, Modal, Pressable, Dimensions,
} from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme } from '../../../../contexts/ThemeContext';
import { API_URL } from '../../../../constants/config';
import { useChatKeyboard, scrollChatToEndAfterLayout } from '../../../../hooks/useChatKeyboard';
import {
  ChatScreenShell,
  ChatMessageList,
  ChatComposer,
  ChatLoadingState,
  mapMarketMessageToUnified,
  MARKET_CAPABILITIES,
} from '../../../../components/chat/v2';

const MAX_CHAT_PHOTOS = 5;
const PAGE_SIZE = 30;
const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

interface MarketConvInfo {
  id: number;
  listing: { id: number; title: string; price: number; photos: string[] };
  buyer: { id: number; username: string; avatarUrl: string | null };
  seller: { id: number; username: string; avatarUrl: string | null };
}

interface Message {
  id: number;
  content: string;
  photos: string[];
  createdAt: string;
  senderId: number;
  sender: { id: number; username: string; avatarUrl: string | null };
}

export default function MarketChatScreen() {
  const { convId } = useLocalSearchParams<{ convId: string }>();
  const router = useRouter();
  const numConvId = parseInt(convId);
  const { theme, isDark } = useTheme();
  const insets = useSafeAreaInsets();

  const [messages, setMessages] = useState<Message[]>([]);
  const [conv, setConv] = useState<MarketConvInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [nextCursor, setNextCursor] = useState<number | null>(null);
  const [text, setText] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [myId, setMyId] = useState<number | null>(null);
  const [sending, setSending] = useState(false);
  const [previewPhoto, setPreviewPhoto] = useState<string | null>(null);

  const listRef = useRef<FlatList>(null);
  const tokenRef = useRef('');

  const { listPaddingBottom: chatListPad, inputPaddingBottom: chatInputPad } = useChatKeyboard(listRef, {
    parentUsesKeyboardAvoiding: Platform.OS === 'ios',
  });

  const unifiedMessages = useMemo(() => messages.map(mapMarketMessageToUnified), [messages]);

  const getToken = async () =>
    (await AsyncStorage.getItem('userToken')) ?? (await AsyncStorage.getItem('token')) ?? '';

  useEffect(() => {
    (async () => {
      const raw = await AsyncStorage.getItem('user');
      const token = await getToken();
      tokenRef.current = token;
      if (raw) setMyId(JSON.parse(raw)?.userId ?? JSON.parse(raw)?.id);
      await Promise.all([fetchConv(token), fetchMessages(token)]);
    })();
  }, [numConvId]);

  const fetchConv = async (token: string) => {
    try {
      const r = await fetch(`${API_URL}/api/market/conversations/${numConvId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setConv(await r.json());
    } catch (e) { console.error('fetchConv:', e); }
  };

  const fetchMessages = async (token: string, cursor?: number) => {
    if (!cursor) setLoading(true);
    else setLoadingMore(true);
    try {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
      if (cursor) params.append('cursor', String(cursor));
      const r = await fetch(
        `${API_URL}/api/market/conversations/${numConvId}/messages?${params}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      const d = await r.json();
      const msgs = Array.isArray(d) ? d : (d.messages ?? []);
      if (cursor) setMessages(prev => [...msgs, ...prev]);
      else {
        setMessages(msgs);
        scrollChatToEndAfterLayout(listRef, false);
      }
      setNextCursor(Array.isArray(d) ? null : (d.nextCursor ?? null));
      setHasMore(!!(Array.isArray(d) ? null : d.nextCursor));
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
    if (photos.length >= MAX_CHAT_PHOTOS) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: true,
      quality: 0.85,
    });
    if (!result.canceled) {
      setPhotos(prev => [...prev, ...result.assets.map(a => a.uri)].slice(0, MAX_CHAT_PHOTOS));
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
        const ext = filename.split('.').pop()?.toLowerCase() ?? 'jpg';
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
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 80);
    } catch (e) { console.error('handleSend:', e); }
    finally { setSending(false); }
  };

  const HEADER_HEIGHT = (Platform.OS === 'ios' ? 56 : 44) + 12 + insets.top;
  const isSellerView = myId !== null && conv?.buyer != null && myId !== conv.buyer.id;
  const chatPeer = isSellerView ? conv?.buyer : conv?.seller;

  const openPeerProfile = useCallback(() => {
    if (!chatPeer?.id) return;
    router.push({ pathname: '/profile/[userId]', params: { userId: String(chatPeer.id) } } as any);
  }, [router, chatPeer?.id]);

  const marketHeader = (
    <View style={{ paddingTop: insets.top + 10, backgroundColor: theme.surface, borderBottomWidth: 1, borderBottomColor: '#e3383540' }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingBottom: 12, gap: 10 }}>
        <TouchableOpacity
          style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: theme.surface2, borderWidth: 1, borderColor: theme.border, alignItems: 'center', justifyContent: 'center' }}
          onPress={() => router.back()}
        >
          <Feather name="arrow-left" size={18} color={theme.text} />
        </TouchableOpacity>
        {conv?.listing && (
          <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            {conv.listing.photos?.[0] && (
              <Image source={{ uri: conv.listing.photos[0] }} style={{ width: 44, height: 44, borderRadius: 10, borderWidth: 1, borderColor: theme.border }} contentFit="cover" />
            )}
            <TouchableOpacity style={{ flex: 1 }} activeOpacity={0.85} onPress={openPeerProfile} disabled={!chatPeer}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                <View style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8, backgroundColor: theme.primaryBg, borderWidth: 1, borderColor: theme.primaryBorder }}>
                  <Text style={{ color: theme.primary, fontFamily: 'Orbitron', fontSize: 7, fontWeight: '700', letterSpacing: 1 }}>MARKET</Text>
                </View>
              </View>
              <Text style={{ color: theme.text, fontFamily: 'Orbitron', fontSize: 10, fontWeight: '700' }} numberOfLines={1}>
                {conv.listing.title}
              </Text>
              {chatPeer && (
                <Text style={{ color: theme.textDim, fontFamily: 'Orbitron', fontSize: 9, marginTop: 2 }} numberOfLines={1}>
                  {isSellerView ? 'Kupujący: ' : 'Sprzedający: '}@{chatPeer.username}
                </Text>
              )}
              <Text style={{ color: theme.primary, fontFamily: 'Orbitron', fontSize: 11, fontWeight: '900', marginTop: 2 }}>
                {conv.listing.price.toLocaleString('pl-PL')} PLN
              </Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </View>
  );

  return (
    <ChatScreenShell keyboardVerticalOffset={Platform.OS === 'ios' ? HEADER_HEIGHT : 0} header={
      <>
        <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor="transparent" translucent />
        {marketHeader}
      </>
    }
    footer={
      <ChatComposer
        text={text}
        onChangeText={setText}
        onSend={handleSend}
        onAttach={handlePickPhoto}
        onClear={() => setText('')}
        attachments={photos}
        onRemoveAttachment={i => setPhotos(prev => prev.filter((_, j) => j !== i))}
        inputPaddingBottom={chatInputPad}
        disabled={sending}
        sending={sending}
      />
    }
    >
      {loading ? (
        <ChatLoadingState />
      ) : (
        <ChatMessageList
          messages={unifiedMessages}
          myId={myId}
          listRef={listRef}
          loadingMore={loadingMore}
          hasMore={hasMore}
          onLoadOlder={loadMore}
          listPaddingBottom={chatListPad}
          capabilities={MARKET_CAPABILITIES}
          onPressPhoto={setPreviewPhoto}
        />
      )}

      <Modal visible={!!previewPhoto} transparent animationType="fade" onRequestClose={() => setPreviewPhoto(null)}>
        <Pressable style={{ flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' }} onPress={() => setPreviewPhoto(null)}>
          {!!previewPhoto && (
            <Image source={{ uri: previewPhoto }} style={{ width: SCREEN_W, height: SCREEN_H * 0.82 }} contentFit="contain" />
          )}
          <TouchableOpacity
            onPress={() => setPreviewPhoto(null)}
            style={{ position: 'absolute', top: insets.top + 12, right: 14, backgroundColor: '#ffffff24', borderRadius: 20, padding: 9 }}
          >
            <Feather name="x" size={18} color="#fff" />
          </TouchableOpacity>
        </Pressable>
      </Modal>
    </ChatScreenShell>
  );
}
