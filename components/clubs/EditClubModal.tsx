import React, { useState, useEffect } from 'react';
import {
  View, Text, Modal, TouchableOpacity, TextInput,
  ActivityIndicator, Switch, KeyboardAvoidingView, Platform, ScrollView,
} from 'react-native';
import { Image } from 'expo-image';
import MaterialIcons          from '@expo/vector-icons/MaterialIcons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import * as ImagePicker       from 'expo-image-picker';
import AsyncStorage           from '@react-native-async-storage/async-storage';

const getToken = () => AsyncStorage.getItem('token');
import Toast                  from 'react-native-toast-message';
import { useTheme }           from '../../contexts/ThemeContext';
import { API_URL }            from '../../constants/config';
import { Club }               from './types';

interface Props {
  visible:   boolean;
  club:      Club | null;
  channels?: { id: number; name: string }[];
  onClose:   () => void;
  onUpdated: (club: Club) => void;
}

export default function EditClubModal({ visible, club, channels = [], onClose, onUpdated }: Props) {
  const { theme }                 = useTheme();
  const [name,    setName]        = useState('');
  const [desc,    setDesc]        = useState('');
  const [priv,    setPriv]        = useState(false);
  const [avatar,  setAvatar]      = useState<string | null>(null);
  const [joinChannelId, setJoinChannelId] = useState<number | null>(null);
  const [newCategory, setNewCategory] = useState('');
  const [newChannel, setNewChannel] = useState('');
  const [draftCategories, setDraftCategories] = useState<any[]>([]);
  const [draftChannels, setDraftChannels] = useState<any[]>([]);
  const [saving,  setSaving]      = useState(false);

  useEffect(() => {
    if (club && visible) {
      setName(club.name);
      setDesc(club.description ?? '');
      setPriv(club.isPrivate);
      setAvatar(null);
      setJoinChannelId(club.joinNotificationChannelId ?? null);
      setDraftCategories((club.categories ?? []).map(c => ({ ...c })));
      setDraftChannels((club.channels ?? []).map(c => ({ ...c })));
    }
  }, [club, visible]);

  const pick = async () => {
    const r = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.8,
    });
    if (!r.canceled) setAvatar(r.assets[0].uri);
  };

  const submit = async () => {
    if (!name.trim()) { Toast.show({ type: 'error', text1: 'Podaj nazwę klubu' }); return; }
    if (!club) return;
    setSaving(true);
    try {
      const token    = (await getToken()) ?? '';
      const formData = new FormData();
      formData.append('name',        name.trim());
      formData.append('description', desc.trim());
      formData.append('isPrivate',   priv ? 'true' : 'false');
      if (joinChannelId) formData.append('joinNotificationChannelId', String(joinChannelId));
      if (avatar) {
        const filename = avatar.split('/').pop() ?? 'avatar.jpg';
        const ext      = filename.split('.').pop()?.toLowerCase() ?? 'jpg';
        // React Native's FormData accepts blob-like objects; cast required for TS
        const avatarBlob = { uri: avatar, name: filename, type: ext === 'png' ? 'image/png' : 'image/jpeg' };
        formData.append('avatar', avatarBlob as unknown as Blob);
      }
      const res = await fetch(`${API_URL}/api/clubs/${club.id}`, {
        method:  'PATCH',
        headers: { Authorization: `Bearer ${token}` },
        body:    formData,
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        Toast.show({ type: 'error', text1: d.error ?? 'Błąd zapisu' });
        return;
      }
      let updated = await res.json();

      // utwórz nowe kategorie lokalne (tempId) i mapuj na real id
      const categoryIdMap = new Map<number, number>();
      for (const dc of draftCategories) {
        if (dc.id > 0) continue;
        const cres = await fetch(`${API_URL}/api/clubs/${club.id}/categories`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ name: dc.name }),
        });
        if (cres.ok) {
          const created = await cres.json();
          categoryIdMap.set(dc.id, created.id);
        }
      }

      for (const ch of draftChannels) {
        if (ch.id > 0) continue;
        const mappedCategoryId = ch.categoryId && ch.categoryId < 0 ? categoryIdMap.get(ch.categoryId) : ch.categoryId;
        await fetch(`${API_URL}/api/clubs/${club.id}/channels`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ name: ch.name, categoryId: mappedCategoryId ?? null }),
        });
      }

      const refreshedAfterCreate = await fetch(`${API_URL}/api/clubs/${club.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (refreshedAfterCreate.ok) updated = await refreshedAfterCreate.json();

      const finalCategories = (updated.categories ?? []).map((c: any, idx: number) => ({
        id: c.id,
        position: (draftCategories.find((d: any) => d.name === c.name)?.position ?? idx),
      }));
      const finalChannels = (updated.channels ?? []).map((c: any, idx: number) => {
        const draft = draftChannels.find((d: any) => d.name === c.name);
        const categoryName = draft?.categoryId
          ? draftCategories.find((dc: any) => dc.id === draft.categoryId)?.name
          : null;
        const mappedCategory = categoryName
          ? (updated.categories ?? []).find((uc: any) => uc.name === categoryName)
          : null;
        return {
          id: c.id,
          position: draft?.position ?? idx,
          categoryId: mappedCategory?.id ?? c.categoryId ?? null,
        };
      });
      const structRes = await fetch(`${API_URL}/api/clubs/${club.id}/structure`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          categories: finalCategories,
          channels: finalChannels,
          joinNotificationChannelId: joinChannelId,
        }),
      });
      if (structRes.ok) updated = await structRes.json();
      Toast.show({ type: 'success', text1: '✅ Klub zaktualizowany' });
      onUpdated(updated);
      onClose();
    } catch (e) {
      Toast.show({ type: 'error', text1: 'Błąd połączenia' });
    } finally {
      setSaving(false);
    }
  };

  if (!club) return null;

  const createCategory = () => {
    if (!newCategory.trim()) return;
    const tmpId = -Date.now();
    setDraftCategories(prev => [...prev, { id: tmpId, name: newCategory.trim(), position: prev.length }]);
    setNewCategory('');
  };

  const createChannel = () => {
    if (!newChannel.trim()) return;
    const tmpId = -(Date.now() + 1);
    const categoryId = draftCategories[0]?.id ?? null;
    setDraftChannels(prev => [...prev, { id: tmpId, name: newChannel.trim(), categoryId, position: prev.length }]);
    setNewChannel('');
  };

  const moveItem = (arr: any[], from: number, to: number) => {
    const next = [...arr];
    const [m] = next.splice(from, 1);
    next.splice(to, 0, m);
    return next.map((x, i) => ({ ...x, position: i }));
  };

  const avatarSrc = avatar ?? club.avatarUrl;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: '#000000bb', justifyContent: 'flex-end' }}>
        <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={onClose} />
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <ScrollView contentContainerStyle={{
            backgroundColor: theme.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24,
            padding: 20, paddingBottom: Platform.OS === 'ios' ? 40 : 20,
            borderTopWidth: 1, borderColor: theme.border2,
          }}>
            <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: theme.border3, alignSelf: 'center', marginBottom: 16 }} />
            <Text style={{ fontFamily: 'Orbitron', fontSize: 13, color: theme.text, letterSpacing: 2, marginBottom: 18 }}>
              EDYTUJ KLUB
            </Text>

            <TouchableOpacity style={{ alignSelf: 'center', marginBottom: 16 }} onPress={pick}>
              <View style={{
                width: 68, height: 68, borderRadius: 16, overflow: 'hidden',
                backgroundColor: '#e3383515', borderWidth: 2, borderColor: '#e3383540',
                borderStyle: avatarSrc ? 'solid' : 'dashed',
                alignItems: 'center', justifyContent: 'center',
              }}>
                {avatarSrc ? (
                  <Image source={{ uri: avatarSrc }} style={{ width: 68, height: 68 }} contentFit="cover" />
                ) : (
                  <>
                    <MaterialCommunityIcons name="shield-crown-outline" size={26} color="#e33835" />
                    <Text style={{ fontFamily: 'Orbitron', fontSize: 7, color: '#e33835', marginTop: 2 }}>LOGO</Text>
                  </>
                )}
              </View>
            </TouchableOpacity>

            <TextInput
              style={{
                backgroundColor: theme.surface2, borderRadius: 11,
                paddingHorizontal: 14, paddingVertical: 11,
                color: theme.text, fontSize: 14,
                borderWidth: 1, borderColor: theme.border, marginBottom: 9,
              }}
              value={name} onChangeText={setName}
              placeholder="Nazwa klubu *" placeholderTextColor={theme.textDim} maxLength={40}
            />

            <TextInput
              style={{
                backgroundColor: theme.surface2, borderRadius: 11,
                paddingHorizontal: 14, paddingVertical: 11,
                color: theme.text, fontSize: 13,
                borderWidth: 1, borderColor: theme.border, marginBottom: 14,
                minHeight: 64, textAlignVertical: 'top',
              }}
              value={desc} onChangeText={setDesc}
              placeholder="Opis (opcjonalnie)" placeholderTextColor={theme.textDim}
              multiline maxLength={200}
            />

            <TouchableOpacity
              style={{
                flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 18,
                backgroundColor: theme.surface2, borderRadius: 11, padding: 12,
                borderWidth: 1, borderColor: theme.border,
              }}
              onPress={() => setPriv(v => !v)} activeOpacity={0.8}
            >
              <MaterialIcons name={priv ? 'lock' : 'lock-open'} size={17} color={priv ? '#e33835' : theme.textDim} />
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: 'Orbitron', fontSize: 10, color: theme.text, fontWeight: '700' }}>PRYWATNY</Text>
                <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: theme.textDim, marginTop: 1 }}>
                  Tylko zaproszeni mogą dołączyć
                </Text>
              </View>
              <Switch value={priv} onValueChange={setPriv} trackColor={{ true: '#e33835' }} />
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                { backgroundColor: '#e33835', borderRadius: 12, paddingVertical: 13, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8 },
                saving && { opacity: 0.6 },
              ]}
              onPress={submit} disabled={saving}
            >
              {saving ? (
                <ActivityIndicator color="#fff" size={16} />
              ) : (
                <>
                  <MaterialCommunityIcons name="content-save" size={15} color="#fff" />
                  <Text style={{ fontFamily: 'Orbitron', fontSize: 12, color: '#fff', fontWeight: '700' }}>ZAPISZ ZMIANY</Text>
                </>
              )}
            </TouchableOpacity>

            <View style={{ marginTop: 14, backgroundColor: theme.surface2, borderRadius: 11, padding: 10, borderWidth: 1, borderColor: theme.border }}>
              <Text style={{ fontFamily: 'Orbitron', fontSize: 9, color: theme.textDim, marginBottom: 8 }}>KANAŁ POWITAŃ</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                {channels.map(ch => (
                  <TouchableOpacity key={ch.id} onPress={() => setJoinChannelId(ch.id)} style={{ paddingHorizontal: 8, paddingVertical: 5, borderRadius: 999, borderWidth: 1, borderColor: joinChannelId === ch.id ? '#e33835' : theme.border }}>
                    <Text style={{ fontSize: 11, color: joinChannelId === ch.id ? '#e33835' : theme.textDim }}># {ch.name}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            <View style={{ marginTop: 12, gap: 8 }}>
              <TextInput
                style={{ backgroundColor: theme.surface2, borderRadius: 10, borderWidth: 1, borderColor: theme.border, paddingHorizontal: 12, paddingVertical: 10, color: theme.text }}
                value={newCategory}
                onChangeText={setNewCategory}
                placeholder="Nowa kategoria (np. Eventy)"
                placeholderTextColor={theme.textDim}
              />
              <TouchableOpacity onPress={createCategory} style={{ backgroundColor: theme.surface2, borderRadius: 10, borderWidth: 1, borderColor: theme.border, paddingVertical: 9, alignItems: 'center' }}>
                <Text style={{ color: theme.textDim, fontSize: 12 }}>Dodaj kategorię</Text>
              </TouchableOpacity>
              {draftCategories.map((c, idx) => (
                <View key={String(c.id)} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Text style={{ flex: 1, color: theme.text }}>{c.name}</Text>
                  <TouchableOpacity disabled={idx === 0} onPress={() => setDraftCategories(prev => moveItem(prev, idx, idx - 1))}><Text style={{ color: theme.textDim }}>↑</Text></TouchableOpacity>
                  <TouchableOpacity disabled={idx === draftCategories.length - 1} onPress={() => setDraftCategories(prev => moveItem(prev, idx, idx + 1))}><Text style={{ color: theme.textDim }}>↓</Text></TouchableOpacity>
                </View>
              ))}

              <TextInput
                style={{ backgroundColor: theme.surface2, borderRadius: 10, borderWidth: 1, borderColor: theme.border, paddingHorizontal: 12, paddingVertical: 10, color: theme.text }}
                value={newChannel}
                onChangeText={setNewChannel}
                placeholder="Nowy kanał tekstowy"
                placeholderTextColor={theme.textDim}
              />
              <TouchableOpacity onPress={createChannel} style={{ backgroundColor: theme.surface2, borderRadius: 10, borderWidth: 1, borderColor: theme.border, paddingVertical: 9, alignItems: 'center' }}>
                <Text style={{ color: theme.textDim, fontSize: 12 }}>Dodaj kanał</Text>
              </TouchableOpacity>
              {draftChannels.map((ch, idx) => (
                <View key={String(ch.id)} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Text style={{ flex: 1, color: theme.text }}># {ch.name}</Text>
                  <TouchableOpacity onPress={() => {
                    const curIdx = draftCategories.findIndex(c => c.id === ch.categoryId);
                    const nextIdx = (curIdx + 1) % Math.max(1, draftCategories.length);
                    setDraftChannels(prev => prev.map(p => p.id === ch.id ? { ...p, categoryId: draftCategories[nextIdx]?.id ?? null } : p));
                  }}><Text style={{ color: theme.primary, fontSize: 11 }}>Kategoria</Text></TouchableOpacity>
                  <TouchableOpacity disabled={idx === 0} onPress={() => setDraftChannels(prev => moveItem(prev, idx, idx - 1))}><Text style={{ color: theme.textDim }}>↑</Text></TouchableOpacity>
                  <TouchableOpacity disabled={idx === draftChannels.length - 1} onPress={() => setDraftChannels(prev => moveItem(prev, idx, idx + 1))}><Text style={{ color: theme.textDim }}>↓</Text></TouchableOpacity>
                </View>
              ))}
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}
