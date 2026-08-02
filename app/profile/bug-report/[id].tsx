import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, StatusBar, Platform, Modal, Pressable, Dimensions, Image,
} from 'react-native';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';
import Toast from 'react-native-toast-message';
import { API_URL } from '../../../constants/config';
import { useTheme } from '../../../contexts/ThemeContext';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBugReportSocket, type BugReportMsg } from '../../../hooks/useBugReportSocket';
import { useChatKeyboard } from '../../../hooks/useChatKeyboard';
import {
  ChatScreenShell,
  ChatComposer,
  ChatMessageList,
  ChatLoadingState,
  ChatTypingIndicator,
  mapSupportMessageToUnified,
  SUPPORT_USER_SENDER_ID,
  SUPPORT_CAPABILITIES,
} from '../../../components/chat/v2';
import { EntranceIntroGate } from '../../../components/motion';

const getToken = async () =>
  (await AsyncStorage.getItem('userToken')) ?? (await AsyncStorage.getItem('token'));

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');
const HEADER_HEIGHT = 56;

type PendingUpload = {
  uri: string;
  kind: 'photo' | 'video';
  name: string;
  mimeType: string;
};

async function readApiJson(res: Response) {
  const text = await res.text();
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    return {
      error: res.ok ? 'Nieprawidlowa odpowiedz serwera' : 'Serwer zwrocil blad. Sprobuj ponownie.',
    };
  }
}

function mediaName(uri: string, fallback: string) {
  const raw = uri.split('/').pop()?.split('?')[0] || fallback;
  return raw.includes('.') ? raw : fallback;
}

function toPendingUpload(asset: ImagePicker.ImagePickerAsset, index: number): PendingUpload {
  const kind = asset.type === 'video' ? 'video' : 'photo';
  const fallbackName = kind === 'video' ? `video-${index}.mp4` : `photo-${index}.jpg`;
  const name = asset.fileName || mediaName(asset.uri, fallbackName);
  const mimeType = asset.mimeType || (kind === 'video' ? 'video/mp4' : 'image/jpeg');
  return { uri: asset.uri, kind, name, mimeType };
}

function showToast(params: { type: 'error' | 'info' | 'success'; text1: string; text2?: string }) {
  (Toast.show as unknown as (input: typeof params) => void)(params);
}

export default function BugReportThreadScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { theme, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listRef = useRef<import('react-native').FlatList>(null);

  const [loading, setLoading] = useState(true);
  const [messages, setMessages] = useState<BugReportMsg[]>([]);
  const [meta, setMeta] = useState<{ category: string; status: string } | null>(null);
  const [staffLastReadAt, setStaffLastReadAt] = useState<string | null>(null);
  const [staffTyping, setStaffTyping] = useState(false);
  const [body, setBody] = useState('');
  const [pending, setPending] = useState<PendingUpload[]>([]);
  const [sending, setSending] = useState(false);
  const [previewPhoto, setPreviewPhoto] = useState<string | null>(null);
  const [introDone, setIntroDone] = useState(false);

  const { listPaddingBottom: chatListPad, inputPaddingBottom: chatInputPad } = useChatKeyboard(listRef);

  const unifiedMessages = useMemo(() => messages.map(mapSupportMessageToUnified), [messages]);
  const myId = SUPPORT_USER_SENDER_ID;

  const lastUserMsg = useMemo(
    () => [...messages].reverse().find(m => m.authorKind === 'user'),
    [messages],
  );
  const userMsgReadByStaff = !!lastUserMsg && !!staffLastReadAt
    && new Date(staffLastReadAt).getTime() >= new Date(lastUserMsg.createdAt).getTime();

  const appendMessage = useCallback((msg: BugReportMsg) => {
    if (!msg?.id) return;
    setMessages(prev => (prev.some(m => m.id === msg.id) ? prev : [...prev, msg]));
    setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 80);
  }, []);

  const { emitTyping } = useBugReportSocket(id, {
    onMessage: appendMessage,
    onRead: ({ readerType, readAt }) => {
      if (readerType === 'staff') setStaffLastReadAt(readAt);
    },
    onTyping: ({ userType, isTyping }) => {
      if (userType === 'owner' || userType === 'support') setStaffTyping(!!isTyping);
    },
  });

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true);
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 20_000);
    try {
      const token = await getToken();
      const res = await fetch(`${API_URL}/api/bug-reports/my/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: ac.signal,
      });
      const data = await readApiJson(res);
      if (!res.ok) throw new Error(data.error || 'Błąd');
      setMessages(data.messages || []);
      setMeta({ category: data.category, status: data.status });
      setStaffLastReadAt(data.staffLastReadAt ?? null);
    } catch (e: any) {
      if (e?.name !== 'AbortError') {
        showToast({ type: 'error', text1: 'Nie udało się wczytać wątku' });
      }
    } finally {
      clearTimeout(timer);
      setLoading(false);
    }
  }, [id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const handleBodyChange = (text: string) => {
    setBody(text);
    emitTyping(true);
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    typingTimerRef.current = setTimeout(() => emitTyping(false), 2000);
  };

  const pickMedia = async () => {
    const r = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.All,
      quality: 0.75,
      videoMaxDuration: 120,
    });
    if (r.canceled || !r.assets[0]) return;
    setPending(prev => [...prev, toPendingUpload(r.assets[0], prev.length)].slice(0, 4));
  };

  const send = async () => {
    if (!body.trim() && pending.length === 0) {
      showToast({ type: 'info', text1: 'Dodaj tekst lub załącznik' });
      return;
    }
    setSending(true);
    try {
      const token = await getToken();
      const form = new FormData();
      form.append('body', body.trim());
      pending.forEach((item) => {
        form.append(item.kind === 'video' ? 'videos' : 'photos', {
          uri: item.uri,
          name: item.name,
          type: item.mimeType,
        } as any);
      });
      const res = await fetch(`${API_URL}/api/bug-reports/my/${id}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      const data = await readApiJson(res);
      if (!res.ok) throw new Error(data.error || 'Błąd');
      setBody('');
      setPending([]);
      emitTyping(false);
      const createdMessage = data.message || data;
      if (createdMessage?.id) appendMessage(createdMessage);
    } catch (e: any) {
      showToast({ type: 'error', text1: e.message || 'Nie udało się wysłać' });
    } finally {
      setSending(false);
    }
  };

  const renderMessageFooter = useCallback((item: ReturnType<typeof mapSupportMessageToUnified>, index: number) => {
    const raw = item.raw as BugReportMsg;
    const isLastUser = lastUserMsg?.id === raw.id && raw.authorKind === 'user';
    if (!isLastUser || !userMsgReadByStaff) return null;
    return (
      <View style={{ alignSelf: 'flex-end', paddingRight: 52, marginTop: -4, marginBottom: 4 }}>
        <MaterialIcons name="done-all" size={14} color={theme.online} />
      </View>
    );
  }, [lastUserMsg, userMsgReadByStaff, theme.online]);

  const supportHeader = (
    <View style={{
      flexDirection: 'row', alignItems: 'center', gap: 12,
      paddingHorizontal: 16, paddingTop: insets.top + 8, paddingBottom: 12,
      borderBottomWidth: 1, borderBottomColor: theme.border,
    }}>
      <TouchableOpacity onPress={() => router.back()} style={{ padding: 4 }}>
        <MaterialIcons name="arrow-back" size={22} color={theme.text} />
      </TouchableOpacity>
      <View style={{ flex: 1 }}>
        <Text style={{ fontFamily: 'Orbitron', fontSize: 14, fontWeight: '900', color: theme.text }}>
          SUPPORT
        </Text>
        {meta && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 }}>
            <View style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8, backgroundColor: theme.primaryBg, borderWidth: 1, borderColor: theme.primaryBorder }}>
              <Text style={{ fontFamily: 'Orbitron', fontSize: 7, color: theme.primary, fontWeight: '700', letterSpacing: 1 }}>SUPPORT</Text>
            </View>
            <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: theme.textDim }}>
              {meta.category?.toUpperCase()} · {meta.status?.toUpperCase()}
            </Text>
          </View>
        )}
      </View>
    </View>
  );

  return (
    <ChatScreenShell
      keyboardVerticalOffset={Platform.OS === 'ios' ? HEADER_HEIGHT : 0}
      header={
        <>
          <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />
          {supportHeader}
        </>
      }
      footer={
        <ChatComposer
          text={body}
          onChangeText={handleBodyChange}
          onSend={send}
          onAttach={pickMedia}
          onClear={() => { setBody(''); emitTyping(false); }}
          attachments={pending.map(item => item.uri)}
          onRemoveAttachment={i => setPending(prev => prev.filter((_, j) => j !== i))}
          inputPaddingBottom={chatInputPad}
          placeholder="Napisz do supportu…"
          disabled={sending}
          sending={sending}
          typingIndicator={staffTyping ? <ChatTypingIndicator text="Support pisze…" /> : undefined}
        />
      }
    >
      {loading ? (
        <ChatLoadingState title="Ładowanie wątku…" />
      ) : (
        <ChatMessageList
          messages={unifiedMessages}
          myId={myId}
          listRef={listRef}
          capabilities={SUPPORT_CAPABILITIES}
          showGroupNames
          listPaddingBottom={chatListPad}
          onPressPhoto={setPreviewPhoto}
          renderMessageFooter={renderMessageFooter}
          emptyTitle="Brak wiadomości"
          emptySubtitle="Opisz problem — support odpowie tutaj."
        />
      )}

      <Modal visible={!!previewPhoto} transparent animationType="fade" onRequestClose={() => setPreviewPhoto(null)}>
        <Pressable style={{ flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' }} onPress={() => setPreviewPhoto(null)}>
          {!!previewPhoto && (
            <Image source={{ uri: previewPhoto }} style={{ width: SCREEN_W, height: SCREEN_H * 0.82 }} resizeMode="contain" />
          )}
        </Pressable>
      </Modal>

      {!introDone && (
        <EntranceIntroGate
          presetId="support-calm"
          screenKey={`support_${id}`}
          subtitleOverride={id ? `ZGŁOSZENIE #${id}` : undefined}
          hapticsOnClash={false}
          onIntroDone={() => setIntroDone(true)}
        />
      )}
    </ChatScreenShell>
  );
}
