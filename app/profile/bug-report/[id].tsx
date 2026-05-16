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

const getToken = async () =>
  (await AsyncStorage.getItem('userToken')) ?? (await AsyncStorage.getItem('token'));

type Msg = {
  id: number;
  authorKind: string;
  body: string;
  photos: string[];
  videos: string[];
  createdAt: string;
};

export default function BugReportThreadScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { theme } = useTheme();
  const scrollRef = useRef<ScrollView>(null);

  const [loading, setLoading] = useState(true);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [meta, setMeta] = useState<{ category: string; status: string } | null>(null);
  const [body, setBody] = useState('');
  const [pending, setPending] = useState<{ uri: string; type: string; name: string }[]>([]);
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    try {
      const token = await getToken();
      const res = await fetch(`${API_URL}/api/bug-reports/my/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Błąd');
      setMessages(data.messages || []);
      setMeta({ category: data.category, status: data.status });
    } catch {
      Toast.show({ type: 'error', text1: 'Nie udało się wczytać wątku' });
    } finally {
      setLoading(false);
    }
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      load();
    }, [load]),
  );

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
      const errData = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(errData.error || 'Błąd wysyłania');
      setBody('');
      setPending([]);
      await load();
      Toast.show({ type: 'success', text1: 'Wysłano' });
    } catch (e: any) {
      Toast.show({ type: 'error', text1: e.message ?? 'Błąd' });
    } finally {
      setSending(false);
    }
  };

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
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 80 : 24}
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
        contentContainerStyle={{ paddingBottom: 24 }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
        onScrollBeginDrag={Keyboard.dismiss}
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
      >
        {messages.map(m => {
          const mine = m.authorKind === 'user';
          const label = mine ? 'TY' : m.authorKind === 'support' ? 'SUPPORT' : 'ADMIN';
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
              <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: theme.textDim, marginBottom: 6 }}>
                {label} · {new Date(m.createdAt).toLocaleString('pl-PL')}
              </Text>
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

      {pending.length > 0 && (
        <View style={{ paddingHorizontal: '5%', flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
          {pending.map((p, i) => (
            <TouchableOpacity key={i} onPress={() => setPending(prev => prev.filter((_, j) => j !== i))}>
              <Text style={{ fontFamily: 'Orbitron', fontSize: 9, color: '#e33835' }}>✕ {p.name}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      <View style={{ paddingHorizontal: '5%', paddingBottom: 24, borderTopWidth: 1, borderTopColor: theme.border, paddingTop: 10 }}>
        <TextInput
          value={body}
          onChangeText={setBody}
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
