// @ts-nocheck
import React, { useState, useEffect } from 'react';
import {
  View, Text, Modal, TouchableOpacity, TextInput,
  ActivityIndicator, Switch, KeyboardAvoidingView, Platform, ScrollView,
} from 'react-native';
import { Image } from 'expo-image';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import * as ImagePicker from 'expo-image-picker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Toast from 'react-native-toast-message';
import DraggableFlatList from 'react-native-draggable-flatlist';
import { useTheme } from '../../contexts/ThemeContext';
import { API_URL } from '../../constants/config';
import { Club } from './types';
import RanksModal from './RanksModal';

const getToken = () => AsyncStorage.getItem('token');

interface Props {
  visible: boolean;
  club: Club | null;
  channels?: { id: number; name: string }[];
  onClose: () => void;
  onUpdated: (club: Club) => void;
}

export default function EditClubModal({ visible, club, channels = [], onClose, onUpdated }: Props) {
  const { theme } = useTheme();
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [priv, setPriv] = useState(false);
  const [avatar, setAvatar] = useState<string | null>(null);
  const [joinChannelId, setJoinChannelId] = useState<number | null>(null);
  const [newCategory, setNewCategory] = useState('');
  const [newChannel, setNewChannel] = useState('');
  const [selectedCategoryId, setSelectedCategoryId] = useState<number | null>(null);
  const [draftCategories, setDraftCategories] = useState<any[]>([]);
  const [draftChannels, setDraftChannels] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);
  const [ranksOpen, setRanksOpen] = useState(false);

  useEffect(() => {
    if (!club || !visible) return;
    setName(club.name);
    setDesc(club.description ?? '');
    setPriv(club.isPrivate);
    setAvatar(null);
    setJoinChannelId(club.joinNotificationChannelId ?? null);
    const sortedCats = [...(club.categories ?? [])].sort((a, b) => a.position - b.position);
    const sortedCh = [...(club.channels ?? [])].sort((a, b) => a.position - b.position);
    setDraftCategories(sortedCats.map((c, i) => ({ ...c, position: i })));
    setDraftChannels(sortedCh.map((c, i) => ({ ...c, position: i })));
    setSelectedCategoryId(sortedCats[0]?.id ?? null);
  }, [club, visible]);

  if (!club) return null;

  const pick = async () => {
    const r = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.8,
    });
    if (!r.canceled) setAvatar(r.assets[0].uri);
  };

  const addCategory = () => {
    if (!newCategory.trim()) return;
    const id = -Date.now();
    setDraftCategories(prev => [...prev, { id, name: newCategory.trim(), position: prev.length }]);
    setSelectedCategoryId(id);
    setNewCategory('');
  };

  const addChannel = () => {
    if (!newChannel.trim()) return;
    const id = -(Date.now() + Math.floor(Math.random() * 1000));
    const categoryId = selectedCategoryId ?? draftCategories[0]?.id ?? null;
    setDraftChannels(prev => [...prev, { id, name: newChannel.trim(), categoryId, position: prev.length }]);
    setNewChannel('');
  };

  const submit = async () => {
    if (!name.trim()) return Toast.show({ type: 'error', text1: 'Podaj nazwę klubu' });
    setSaving(true);
    try {
      const token = (await getToken()) ?? '';
      const formData = new FormData();
      formData.append('name', name.trim());
      formData.append('description', desc.trim());
      formData.append('isPrivate', priv ? 'true' : 'false');
      if (joinChannelId) formData.append('joinNotificationChannelId', String(joinChannelId));
      if (avatar) {
        const filename = avatar.split('/').pop() ?? 'avatar.jpg';
        formData.append('avatar', { uri: avatar, name: filename, type: 'image/jpeg' } as any);
      }
      const baseRes = await fetch(`${API_URL}/api/clubs/${club.id}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      if (!baseRes.ok) {
        const d = await baseRes.json().catch(() => ({}));
        return Toast.show({ type: 'error', text1: d.error ?? 'Błąd zapisu' });
      }

      // najpierw tworzymy brakujące encje
      const categoryIdMap = new Map<number, number>();
      for (const c of draftCategories) {
        if (c.id > 0) continue;
        const r = await fetch(`${API_URL}/api/clubs/${club.id}/categories`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ name: c.name }),
        });
        if (r.ok) categoryIdMap.set(c.id, (await r.json()).id);
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

      const freshRes = await fetch(`${API_URL}/api/clubs/${club.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      let updated = freshRes.ok ? await freshRes.json() : await baseRes.json();

      const draftCategoryNameById = new Map(draftCategories.map(c => [c.id, c.name]));
      const realCategoryByName = new Map((updated.categories ?? []).map((c: any) => [c.name, c.id]));
      const categoriesPayload = draftCategories.map((c, i) => ({
        id: realCategoryByName.get(c.name) ?? c.id,
        position: i,
      })).filter(c => c.id > 0);

      const channelsPayload = draftChannels.map((ch, i) => {
        const categoryName = ch.categoryId ? draftCategoryNameById.get(ch.categoryId) : null;
        const mappedCategoryId = categoryName ? (realCategoryByName.get(categoryName) ?? null) : null;
        const realChannel = (updated.channels ?? []).find((c: any) => c.name === ch.name);
        return { id: realChannel?.id ?? ch.id, position: i, categoryId: mappedCategoryId };
      }).filter(c => c.id > 0);

      const structRes = await fetch(`${API_URL}/api/clubs/${club.id}/structure`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ categories: categoriesPayload, channels: channelsPayload, joinNotificationChannelId: joinChannelId }),
      });
      if (structRes.ok) updated = await structRes.json();
      onUpdated(updated);
      Toast.show({ type: 'success', text1: 'Ustawienia zapisane' });
      onClose();
    } catch {
      Toast.show({ type: 'error', text1: 'Błąd połączenia' });
    } finally {
      setSaving(false);
    }
  };

  const avatarSrc = avatar ?? club.avatarUrl;
  const categoryName = (id: number | null) => draftCategories.find(c => c.id === id)?.name ?? 'Brak';

  return (
    <>
      <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
        <View style={{ flex: 1, backgroundColor: '#000000bb', justifyContent: 'flex-end' }}>
          <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={onClose} />
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
            <View style={{ backgroundColor: theme.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, borderTopWidth: 1, borderColor: theme.border2, maxHeight: '92%' }}>
              <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: theme.border3, alignSelf: 'center', marginTop: 12, marginBottom: 12 }} />
              <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 30 }} keyboardShouldPersistTaps="handled">
                <Text style={{ fontFamily: 'Orbitron', fontSize: 13, color: theme.text, letterSpacing: 2, marginBottom: 14 }}>
                  USTAWIENIA KLUBU
                </Text>

                <TouchableOpacity style={{ alignSelf: 'center', marginBottom: 14 }} onPress={pick}>
                  <View style={{ width: 72, height: 72, borderRadius: 16, overflow: 'hidden', backgroundColor: '#e3383515', borderWidth: 2, borderColor: '#e3383540', alignItems: 'center', justifyContent: 'center' }}>
                    {avatarSrc ? <Image source={{ uri: avatarSrc }} style={{ width: 72, height: 72 }} contentFit="cover" /> : <MaterialCommunityIcons name="shield-crown-outline" size={28} color="#e33835" />}
                  </View>
                </TouchableOpacity>

                <TextInput
                  style={{ backgroundColor: theme.surface2, borderRadius: 11, paddingHorizontal: 14, paddingVertical: 11, color: theme.text, fontSize: 14, borderWidth: 1, borderColor: theme.border, marginBottom: 9 }}
                  value={name}
                  onChangeText={setName}
                  placeholder="Nazwa klubu *"
                  placeholderTextColor={theme.textDim}
                />
                <TextInput
                  style={{ backgroundColor: theme.surface2, borderRadius: 11, paddingHorizontal: 14, paddingVertical: 11, color: theme.text, fontSize: 13, borderWidth: 1, borderColor: theme.border, marginBottom: 10, minHeight: 64, textAlignVertical: 'top' }}
                  value={desc}
                  onChangeText={setDesc}
                  placeholder="Opis"
                  placeholderTextColor={theme.textDim}
                  multiline
                />
                <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12, backgroundColor: theme.surface2, borderRadius: 11, padding: 12, borderWidth: 1, borderColor: theme.border }} onPress={() => setPriv(v => !v)}>
                  <MaterialIcons name={priv ? 'lock' : 'lock-open'} size={17} color={priv ? '#e33835' : theme.textDim} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontFamily: 'Orbitron', fontSize: 10, color: theme.text, fontWeight: '700' }}>PRYWATNY KLUB</Text>
                  </View>
                  <Switch value={priv} onValueChange={setPriv} trackColor={{ true: '#e33835' }} />
                </TouchableOpacity>

                <View style={{ marginBottom: 14 }}>
                  <Text style={{ fontFamily: 'Orbitron', fontSize: 9, color: theme.textDim, marginBottom: 6 }}>KANAŁ POWITAŃ</Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                    {channels.map(ch => (
                      <TouchableOpacity key={ch.id} onPress={() => setJoinChannelId(ch.id)} style={{ paddingHorizontal: 8, paddingVertical: 5, borderRadius: 999, borderWidth: 1, borderColor: joinChannelId === ch.id ? '#e33835' : theme.border }}>
                        <Text style={{ fontSize: 11, color: joinChannelId === ch.id ? '#e33835' : theme.textDim }}># {ch.name}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>

                <View style={{ backgroundColor: theme.surface2, borderWidth: 1, borderColor: theme.border, borderRadius: 12, padding: 10, marginBottom: 12 }}>
                  <Text style={{ fontFamily: 'Orbitron', fontSize: 9, color: theme.textDim, marginBottom: 8 }}>KATEGORIE (PRZECIĄGNIJ)</Text>
                  <View style={{ flexDirection: 'row', gap: 8, marginBottom: 8 }}>
                    <TextInput
                      value={newCategory}
                      onChangeText={setNewCategory}
                      placeholder="Nowa kategoria"
                      placeholderTextColor={theme.textDim}
                      style={{ flex: 1, backgroundColor: theme.bg, borderRadius: 8, paddingHorizontal: 10, color: theme.text, borderWidth: 1, borderColor: theme.border }}
                    />
                    <TouchableOpacity onPress={addCategory} style={{ backgroundColor: '#e33835', borderRadius: 8, paddingHorizontal: 10, justifyContent: 'center' }}>
                      <MaterialIcons name="add" size={18} color="#fff" />
                    </TouchableOpacity>
                  </View>
                  <DraggableFlatList
                    data={draftCategories}
                    keyExtractor={(item) => String(item.id)}
                    scrollEnabled={false}
                    onDragEnd={({ data }) => setDraftCategories(data.map((d, i) => ({ ...d, position: i })))}
                    renderItem={({ item, drag, isActive }) => (
                      <TouchableOpacity onLongPress={drag} delayLongPress={120} style={{ paddingVertical: 8, paddingHorizontal: 8, borderRadius: 8, backgroundColor: isActive ? `${theme.primary}22` : 'transparent', flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <MaterialCommunityIcons name="drag" size={16} color={theme.textDim} />
                        <Text style={{ flex: 1, color: theme.text }}>{item.name}</Text>
                        <TouchableOpacity onPress={() => setSelectedCategoryId(item.id)}>
                          <Text style={{ color: selectedCategoryId === item.id ? theme.primary : theme.textDim, fontSize: 11 }}>Wybierz</Text>
                        </TouchableOpacity>
                      </TouchableOpacity>
                    )}
                  />
                </View>

                <View style={{ backgroundColor: theme.surface2, borderWidth: 1, borderColor: theme.border, borderRadius: 12, padding: 10 }}>
                  <Text style={{ fontFamily: 'Orbitron', fontSize: 9, color: theme.textDim, marginBottom: 8 }}>KANAŁY TEKSTOWE (PRZECIĄGNIJ)</Text>
                  <View style={{ flexDirection: 'row', gap: 8, marginBottom: 8 }}>
                    <TextInput
                      value={newChannel}
                      onChangeText={setNewChannel}
                      placeholder="Nowy kanał"
                      placeholderTextColor={theme.textDim}
                      style={{ flex: 1, backgroundColor: theme.bg, borderRadius: 8, paddingHorizontal: 10, color: theme.text, borderWidth: 1, borderColor: theme.border }}
                    />
                    <TouchableOpacity onPress={addChannel} style={{ backgroundColor: '#e33835', borderRadius: 8, paddingHorizontal: 10, justifyContent: 'center' }}>
                      <MaterialIcons name="add" size={18} color="#fff" />
                    </TouchableOpacity>
                  </View>
                  <DraggableFlatList
                    data={draftChannels}
                    keyExtractor={(item) => String(item.id)}
                    scrollEnabled={false}
                    onDragEnd={({ data }) => setDraftChannels(data.map((d, i) => ({ ...d, position: i })))}
                    renderItem={({ item, drag, isActive }) => (
                      <TouchableOpacity onLongPress={drag} delayLongPress={120} style={{ paddingVertical: 8, paddingHorizontal: 8, borderRadius: 8, backgroundColor: isActive ? `${theme.primary}22` : 'transparent', flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <MaterialCommunityIcons name="drag" size={16} color={theme.textDim} />
                        <View style={{ flex: 1 }}>
                          <Text style={{ color: theme.text }}># {item.name}</Text>
                          <Text style={{ color: theme.textDim, fontSize: 10 }}>{categoryName(item.categoryId)}</Text>
                        </View>
                        <TouchableOpacity onPress={() => {
                          const idx = draftCategories.findIndex(c => c.id === item.categoryId);
                          const nextIdx = (idx + 1) % Math.max(1, draftCategories.length);
                          setDraftChannels(prev => prev.map(p => p.id === item.id ? { ...p, categoryId: draftCategories[nextIdx]?.id ?? null } : p));
                        }}>
                          <Text style={{ color: theme.primary, fontSize: 11 }}>Przenieś</Text>
                        </TouchableOpacity>
                      </TouchableOpacity>
                    )}
                  />
                </View>

                <TouchableOpacity
                  style={{ marginTop: 12, backgroundColor: '#FFD7001A', borderWidth: 1, borderColor: '#FFD70055', borderRadius: 10, paddingVertical: 10, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 6 }}
                  onPress={() => setRanksOpen(true)}
                >
                  <MaterialCommunityIcons name="shield-star" size={16} color="#FFD700" />
                  <Text style={{ fontFamily: 'Orbitron', fontSize: 10, color: '#FFD700', fontWeight: '700' }}>RANGI I UPRAWNIENIA</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[{ marginTop: 14, backgroundColor: '#e33835', borderRadius: 12, paddingVertical: 13, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8 }, saving && { opacity: 0.6 }]}
                  onPress={submit}
                  disabled={saving}
                >
                  {saving ? <ActivityIndicator color="#fff" size={16} /> : <><MaterialCommunityIcons name="content-save" size={15} color="#fff" /><Text style={{ fontFamily: 'Orbitron', fontSize: 12, color: '#fff', fontWeight: '700' }}>ZAPISZ</Text></>}
                </TouchableOpacity>
              </ScrollView>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>

      <RanksModal
        visible={ranksOpen}
        onClose={() => setRanksOpen(false)}
        clubId={club.id}
        ranks={club.ranks ?? []}
        onRefresh={async () => {
          const token = (await getToken()) ?? '';
          const r = await fetch(`${API_URL}/api/clubs/${club.id}`, { headers: { Authorization: `Bearer ${token}` } });
          if (r.ok) onUpdated(await r.json());
        }}
      />
    </>
  );
}
