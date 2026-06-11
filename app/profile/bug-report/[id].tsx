import React, { useCallback, useState, useRef } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, TextInput, ActivityIndicator,
  Image, KeyboardAvoidingView, Platform, Keyboard,
} from 'react-native';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';
import Toast from 'react-native-toast-message';
import { Video, ResizeMode } from 'expo-av';
import { API_URL } from '../../../constants/config';
import { useTheme } from '../../../contexts/ThemeContext';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useKeyboardInset } from '../../../hooks/useKeyboardInset';
import { useBugReportSocket, type BugReportMsg } from '../../../hooks/useBugReportSocket';

const getToken = async () =>
  (await AsyncStorage.getItem('userToken')) ?? (await AsyncStorage.getItem('token'));

export default function BugReportThreadScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const keyboardInset = useKeyboardInset();
  const scrollRef = useRef<ScrollView>(null);
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [loading, setLoading] = useState(true);
  const [messages, setMessages] = useState<BugReportMsg[]>([]);
  const [meta, setMeta] = useState<{ category: string; status: string } | null>(null);
  const [staffLastReadAt, setStaffLastReadAt] = useState<string | null>(null);
  const [staffTyping, setStaffTyping] = useState(false);
  const [body, setBody] = useState('');
  const [pending, setPending] = useState<{ uri: string; type: string; name: string }[]>([]);
  const [sending, setSending] = useState(false);

  const appendMessage = useCallback((msg: BugReportMsg) => {
    if (!msg?.id) return;
    setMessages(prev => (prev.some(m => m.id === msg.id) ? prev : [...prev, msg]));
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
  }, []);

  const { emitTyping } = useBugReportSocket(id, {
    onMessage: appendMessage,
    onRead: ({ readerType, readAt }) => {
      if (readerType === 'staff') setStaffLastReadAt(readAt);
    },
    onTyping: ({ userType, isTyping }) => {
      if (userType === 'owner' || userType === 'support') {
        setStaffTyping(!!isTyping);
      }
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
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Błąd');
      setMessages(data.messages || []);
      setMeta({ category: data.category, status: data.status });
      setStaffLastReadAt(data.staffLastReadAt ?? null);
    } catch (e: any) {
      if (e?.name !== 'AbortError') {
        Toast.show({ type: 'error', text1: 'Nie udało się wczytać wątku' });
      }
    } finally {
      clearTimeout(timer);
      setLoading(false);
    }
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const handleBodyChange = (text: string) => {
    setBody(text);
    emitTyping(true);
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    typingTimerRef.current = setTimeout(() => emitTyping(false), 2000);
  };

  const pickMedia = async () => {
    const r = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.All,
      quality:    0.75,
      videoMaxDuration: 120,
    });
    if (r.canceled || !r.assets[0]) return;
    const a = r.assets[0];
    const isVid = (a.type === 'video' || a.uri.toLowerCase().endsWith('.mp4'));
    const name = isVid ? `clip_${Date.now()}.mp4` : `img_${Date.now()}.jpg`;
    const type = isVid ? 'video/mp4' : 'image/jpeg';
    setPending(prev => [...prev, { uri: a.uri, type, name }]);
  };

  const send = async () => {
    if (!body.trim() && pending.length === 0) {
      Toast.show({ type: 'info', text1: 'Dodaj tekst lub załącznik' });
      return;
    }
    setSending(true);
    emitTyping(false);
    try {
      const token = await getToken();
      const form = new FormData();
      form.append('body', body.trim());
      pending.forEach(p => {
        form.append(p.type.startsWith('video') ? 'videos' : 'photos', {
          uri: p.uri,
          name: p.name,
          type: p.type,
        } as any);
      });
      const res = await fetch(`${API_URL}/api/bug-reports/my/${id}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Błąd wysyłania');
      appendMessage(data);
      setBody('');
      setPending([]);
      Toast.show({ type: 'success', text1: 'Wysłano' });
    } catch (e: any) {
      Toast.show({ type: 'error', text1: e.message ?? 'Błąd' });
    } finally {
      setSending(false);
    }
  };

  const lastUserMsg = [...messages].reverse().find(m => m.authorKind === 'user');
  const userMsgReadByStaff = Boolean(
    lastUserMsg &&
    staffLastReadAt &&
    new Date(staffLastReadAt) >= new Date(lastUserMsg.createdAt),
  );

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.bgAlt, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color="#e33835" />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: theme.bgAlt }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 80 : 0}
      enabled={Platform.OS === 'ios'}
    >
      <View style={{ marginTop: 56, paddingHorizontal: '5%', flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
        <TouchableOpacity onPress={() => router.back()} style={{ padding: 8 }}>
          <MaterialIcons name="arrow-back" size={24} color={theme.text} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={{ fontFamily: 'Orbitron', fontSize: 14, color: theme.text }}>ZGŁOSZENIE #{id}</Text>
          {meta && (
            <Text style={{ fontFamily: 'Orbitron', fontSize: 9, color: theme.textDim, marginTop: 4 }}>
              {meta.category?.toUpperCase()} · {meta.status}
            </Text>
          )}
        </View>
      </View>

      <ScrollView
        ref={scrollRef}
        style={{ flex: 1, paddingHorizontal: '5%' }}
        contentContainerStyle={{ paddingBottom: Math.max(140, keyboardInset + 120) }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
      >
        {messages.map(m => {
          const mine = m.authorKind === 'user';
          const label = mine ? 'TY' : m.authorKind === 'support' ? 'SUPPORT' : 'ADMIN';
          const isLastUser = lastUserMsg?.id === m.id;
          return (
            <View
              key={m.id}
              style={{
                alignSelf: mine ? 'flex-start' : 'flex-end',
                maxWidth: '92%',
                backgroundColor: mine ? theme.surface : '#e3383520',
                borderWidth: 1,
                borderColor: mine ? theme.border : '#e3383540',
                borderRadius: 14,
                padding: 12,
                marginBottom: 10,
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: theme.textDim, flex: 1 }}>
                  {label} · {new Date(m.createdAt).toLocaleString('pl-PL')}
                </Text>
                {isLastUser && mine && (
                  <MaterialIcons
                    name="done-all"
                    size={14}
                    color={userMsgReadByStaff ? '#4de926' : theme.textDim}
                  />
                )}
              </View>
              {!!m.body && (
                <Text style={{ fontFamily: 'Orbitron', fontSize: 12, color: theme.text, lineHeight: 18 }}>{m.body}</Text>
              )}
              {(m.photos || []).map((url, i) => (
                <Image key={i} source={{ uri: url }} style={{ width: 200, height: 200, borderRadius: 10, marginTop: 8 }} resizeMode="cover" />
              ))}
              {(m.videos || []).map((url, i) => (
                <Video
                  key={`v${i}`}
                  source={{ uri: url }}
                  style={{ width: 260, height: 160, marginTop: 8, borderRadius: 10 }}
                  useNativeControls
                  resizeMode={ResizeMode.CONTAIN}
                />
              ))}
            </View>
          );
        })}
      </ScrollView>

      {staffTyping && (
        <Text style={{ fontFamily: 'Orbitron', fontSize: 9, color: theme.textDim, paddingHorizontal: '5%', marginBottom: 6, fontStyle: 'italic' }}>
          Support pisze…
        </Text>
      )}

      {pending.length > 0 && (
        <View style={{ paddingHorizontal: '5%', flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
          {pending.map((p, i) => (
            <TouchableOpacity key={i} onPress={() => setPending(prev => prev.filter((_, j) => j !== i))}>
              <Text style={{ fontFamily: 'Orbitron', fontSize: 9, color: '#e33835' }}>✕ {p.name}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      <View
        style={{
          paddingHorizontal: '5%',
          paddingBottom: keyboardInset > 0 ? keyboardInset + 12 : Math.max(insets.bottom, 12),
          borderTopWidth: 1,
          borderTopColor: theme.border,
          paddingTop: 10,
          backgroundColor: theme.bgAlt,
        }}
      >
        <TextInput
          value={body}
          onChangeText={handleBodyChange}
          placeholder="Napisz do supportu…"
          placeholderTextColor={theme.textDim}
          multiline
          clearButtonMode="while-editing"
          style={{
            minHeight: 44,
            maxHeight: 120,
            backgroundColor: theme.surface3,
            borderRadius: 12,
            borderWidth: 1,
            borderColor: theme.border2,
            padding: 12,
            color: theme.text,
            fontFamily: 'Orbitron',
            fontSize: 12,
            marginBottom: 8,
          }}
        />
        <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
          <TouchableOpacity
            onPress={() => {
              Keyboard.dismiss();
              setBody('');
              emitTyping(false);
            }}
            style={{ paddingHorizontal: 10, paddingVertical: 10, backgroundColor: theme.surface, borderRadius: 10, borderWidth: 1, borderColor: theme.border }}
          >
            <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: theme.textDim }}>ANULUJ</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={pickMedia} style={{ padding: 10, backgroundColor: theme.surface, borderRadius: 10, borderWidth: 1, borderColor: theme.border }}>
            <MaterialIcons name="attach-file" size={22} color={theme.text} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={send}
            disabled={sending}
            style={{
              flex: 1,
              backgroundColor: '#e33835',
              borderRadius: 12,
              paddingVertical: 14,
              alignItems: 'center',
              opacity: sending ? 0.6 : 1,
            }}
          >
            {sending ? <ActivityIndicator color="#fff" /> : (
              <Text style={{ fontFamily: 'Orbitron', fontSize: 12, color: '#fff', fontWeight: '800' }}>WYŚLIJ</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}
