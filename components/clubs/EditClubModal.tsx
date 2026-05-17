// @ts-nocheck
import React, { useState, useEffect } from 'react';
import {
  View, Text, Modal, TouchableOpacity, TextInput,
  ActivityIndicator, Switch, KeyboardAvoidingView, Platform, ScrollView, StyleSheet,
} from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Image } from 'expo-image';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import * as ImagePicker from 'expo-image-picker';
import Toast from 'react-native-toast-message';
import { getAuthToken } from '../../lib/getAuthToken';
import DraggableFlatList from 'react-native-draggable-flatlist';
import { useTheme } from '../../contexts/ThemeContext';
import { API_URL } from '../../constants/config';
import { Club } from './types';
import RanksModal from './RanksModal';

const mkId = () => `tmp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

interface Props {
  visible: boolean;
  club: Club | null;
  channels?: { id: number; name: string }[];
  onClose: () => void;
  onUpdated: (club: Club) => void;
}

export default function EditClubModal({ visible, club, channels = [], onClose, onUpdated }: Props) {
  const { theme } = useTheme();
  const [tab, setTab] = useState<'general' | 'structure'>('general');
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [priv, setPriv] = useState(false);
  const [avatar, setAvatar] = useState<string | null>(null);
  const [joinChannelId, setJoinChannelId] = useState<number | null>(null);
  const [newCategory, setNewCategory] = useState('');
  const [newChannel, setNewChannel] = useState('');
  const [structureView, setStructureView] = useState<'categories' | 'channels'>('categories');
  const [selectedCategoryKey, setSelectedCategoryKey] = useState<string | null>(null);
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

    const cats = [...(club.categories ?? [])]
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
      .map((c: any, i: number) => ({ key: `cat_${c.id}`, id: c.id, name: c.name, position: i }));

    const chs = [...(club.channels ?? [])]
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
      .map((c: any, i: number) => ({ key: `ch_${c.id}`, id: c.id, name: c.name, categoryRef: c.categoryId ? `cat_${c.categoryId}` : null, position: i }));

    setDraftCategories(cats);
    setDraftChannels(chs);
    setSelectedCategoryKey(cats[0]?.key ?? null);
    setStructureView('categories');
  }, [club, visible]);

  const pick = async () => {
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.8 });
    if (!r.canceled) setAvatar(r.assets[0].uri);
  };

  const addCategory = () => {
    if (!newCategory.trim()) return;
    const key = mkId();
    setDraftCategories(prev => [...prev, { key, id: null, name: newCategory.trim(), position: prev.length }]);
    setSelectedCategoryKey(key);
    setNewCategory('');
  };

  const addChannel = () => {
    if (!newChannel.trim()) return;
    const key = mkId();
    const catKey = selectedCategoryKey ?? draftCategories[0]?.key ?? null;
    setDraftChannels(prev => [...prev, { key, id: null, name: newChannel.trim(), categoryRef: catKey, position: prev.length }]);
    setNewChannel('');
  };

  const moveUp = (arr: any[], key: string) => {
    const idx = arr.findIndex((x: any) => x.key === key);
    if (idx <= 0) return arr;
    const copy = [...arr];
    const [item] = copy.splice(idx, 1);
    copy.splice(idx - 1, 0, item);
    return copy.map((x: any, i: number) => ({ ...x, position: i }));
  };

  const moveDown = (arr: any[], key: string) => {
    const idx = arr.findIndex((x: any) => x.key === key);
    if (idx < 0 || idx >= arr.length - 1) return arr;
    const copy = [...arr];
    const [item] = copy.splice(idx, 1);
    copy.splice(idx + 1, 0, item);
    return copy.map((x: any, i: number) => ({ ...x, position: i }));
  };

  const categoryNameByRef = (ref: string | null) => draftCategories.find((c: any) => c.key === ref)?.name ?? 'Brak kategorii';

  const submit = async () => {
    if (!club) return;
    if (!name.trim()) return Toast.show({ type: 'error', text1: 'Podaj nazwę klubu' });
    setSaving(true);
    try {
      const token = (await getAuthToken()) ?? '';
      if (!token) {
        Toast.show({ type: 'error', text1: 'Zaloguj się ponownie' });
        return;
      }

      const form = new FormData();
      form.append('name', name.trim());
      form.append('description', desc.trim());
      form.append('isPrivate', priv ? 'true' : 'false');
      if (joinChannelId) form.append('joinNotificationChannelId', String(joinChannelId));
      if (avatar) {
        const filename = avatar.split('/').pop() ?? 'avatar.jpg';
        const ext = filename.split('.').pop()?.toLowerCase();
        const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
        form.append('avatar', { uri: avatar, name: filename, type: mime } as any);
      }

      const baseRes = await fetch(`${API_URL}/api/clubs/${club.id}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      const baseData = await baseRes.json().catch(() => ({}));
      if (!baseRes.ok) {
        return Toast.show({ type: 'error', text1: baseData.error ?? 'Błąd zapisu ustawień' });
      }

      let updated: Club = baseData as Club;

      const hasStructureDraft = draftCategories.length > 0 || draftChannels.length > 0;
      if (hasStructureDraft) {
        const categoryIdByKey = new Map<string, number>();
        for (const c of draftCategories) {
          if (c.id) {
            categoryIdByKey.set(c.key, c.id);
            continue;
          }
          const r = await fetch(`${API_URL}/api/clubs/${club.id}/categories`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ name: c.name }),
          });
          if (!r.ok) {
            const d = await r.json().catch(() => ({}));
            return Toast.show({ type: 'error', text1: d.error ?? `Nie udało się dodać kategorii: ${c.name}` });
          }
          const created = await r.json();
          categoryIdByKey.set(c.key, created.id);
        }

        const channelIdByKey = new Map<string, number>();
        for (const ch of draftChannels) {
          if (ch.id) {
            channelIdByKey.set(ch.key, ch.id);
            continue;
          }
          const categoryId = ch.categoryRef ? categoryIdByKey.get(ch.categoryRef) : null;
          const r = await fetch(`${API_URL}/api/clubs/${club.id}/channels`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ name: ch.name, categoryId: categoryId ?? null }),
          });
          if (!r.ok) {
            const d = await r.json().catch(() => ({}));
            return Toast.show({ type: 'error', text1: d.error ?? `Nie udało się dodać kanału: ${ch.name}` });
          }
          const created = await r.json();
          channelIdByKey.set(ch.key, created.id);
        }

        const categoriesPayload = draftCategories.map((c, idx) => ({
          id: categoryIdByKey.get(c.key) ?? c.id,
          position: idx,
        })).filter((c: any) => !!c.id);

        const channelsPayload = draftChannels.map((ch, idx) => ({
          id: channelIdByKey.get(ch.key) ?? ch.id,
          position: idx,
          categoryId: ch.categoryRef ? (categoryIdByKey.get(ch.categoryRef) ?? null) : null,
        })).filter((c: any) => !!c.id);

        const structRes = await fetch(`${API_URL}/api/clubs/${club.id}/structure`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            categories: categoriesPayload,
            channels: channelsPayload,
            joinNotificationChannelId: joinChannelId,
            pruneMissing: false,
          }),
        });
        const structData = await structRes.json().catch(() => ({}));
        if (!structRes.ok) {
          return Toast.show({ type: 'error', text1: structData.error ?? 'Nie udało się zapisać struktury' });
        }
        updated = structData as Club;
      }

      onUpdated(updated);
      Toast.show({ type: 'success', text1: 'Ustawienia klubu zapisane' });
      onClose();
    } catch {
      Toast.show({ type: 'error', text1: 'Błąd połączenia' });
    } finally {
      setSaving(false);
    }
  };

  if (!visible || !club) return null;

  const avatarSrc = avatar ?? club.avatarUrl;

  return (
    <>
      <Modal
        visible={visible}
        animationType="slide"
        transparent
        onRequestClose={onClose}
        presentationStyle="overFullScreen"
        statusBarTranslucent
      >
        <View style={{ flex: 1, backgroundColor: '#000000bb', justifyContent: 'flex-end' }}>
          <TouchableOpacity style={StyleSheet.absoluteFillObject} activeOpacity={1} onPress={onClose} />
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            enabled={Platform.OS === 'ios'}
            keyboardVerticalOffset={18}
            style={{ maxHeight: '92%' }}
          >
            <GestureHandlerRootView style={{ backgroundColor: theme.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, borderTopWidth: 1, borderColor: theme.border2, maxHeight: '100%' }}>
              <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: theme.border3, alignSelf: 'center', marginTop: 12, marginBottom: 12 }} />

              <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 16, marginBottom: 10 }}>
                <TouchableOpacity onPress={() => setTab('general')} style={{ flex: 1, paddingVertical: 8, borderRadius: 8, backgroundColor: tab === 'general' ? `${theme.primary}22` : theme.surface2, borderWidth: 1, borderColor: tab === 'general' ? theme.primary : theme.border }}>
                  <Text style={{ textAlign: 'center', fontFamily: 'Orbitron', fontSize: 9, color: tab === 'general' ? theme.primary : theme.textDim }}>OGÓLNE</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setTab('structure')} style={{ flex: 1, paddingVertical: 8, borderRadius: 8, backgroundColor: tab === 'structure' ? `${theme.primary}22` : theme.surface2, borderWidth: 1, borderColor: tab === 'structure' ? theme.primary : theme.border }}>
                  <Text style={{ textAlign: 'center', fontFamily: 'Orbitron', fontSize: 9, color: tab === 'structure' ? theme.primary : theme.textDim }}>KATEGORIE I KANAŁY</Text>
                </TouchableOpacity>
              </View>

              {tab === 'general' ? (
                <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 20 }}>
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
                      {(club.channels ?? channels).map(ch => (
                        <TouchableOpacity key={ch.id} onPress={() => setJoinChannelId(ch.id)} style={{ paddingHorizontal: 8, paddingVertical: 5, borderRadius: 999, borderWidth: 1, borderColor: joinChannelId === ch.id ? '#e33835' : theme.border }}>
                          <Text style={{ fontSize: 11, color: joinChannelId === ch.id ? '#e33835' : theme.textDim }}># {ch.name}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>

                  <TouchableOpacity
                    style={{ marginTop: 6, backgroundColor: '#FFD7001A', borderWidth: 1, borderColor: '#FFD70055', borderRadius: 10, paddingVertical: 10, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 6 }}
                    onPress={() => setRanksOpen(true)}
                  >
                    <MaterialCommunityIcons name="shield-star" size={16} color="#FFD700" />
                    <Text style={{ fontFamily: 'Orbitron', fontSize: 10, color: '#FFD700', fontWeight: '700' }}>RANGI I UPRAWNIENIA</Text>
                  </TouchableOpacity>
                </ScrollView>
              ) : (
                <View style={{ flex: 1, paddingHorizontal: 16, paddingBottom: 10 }}>
                  <View style={{ flexDirection: 'row', gap: 8, marginBottom: 8 }}>
                    <TouchableOpacity onPress={() => setStructureView('categories')} style={{ flex: 1, paddingVertical: 8, borderRadius: 8, backgroundColor: structureView === 'categories' ? `${theme.primary}22` : theme.surface2, borderWidth: 1, borderColor: structureView === 'categories' ? theme.primary : theme.border }}>
                      <Text style={{ textAlign: 'center', fontFamily: 'Orbitron', fontSize: 9, color: structureView === 'categories' ? theme.primary : theme.textDim }}>KATEGORIE</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => setStructureView('channels')} style={{ flex: 1, paddingVertical: 8, borderRadius: 8, backgroundColor: structureView === 'channels' ? `${theme.primary}22` : theme.surface2, borderWidth: 1, borderColor: structureView === 'channels' ? theme.primary : theme.border }}>
                      <Text style={{ textAlign: 'center', fontFamily: 'Orbitron', fontSize: 9, color: structureView === 'channels' ? theme.primary : theme.textDim }}>KANAŁY</Text>
                    </TouchableOpacity>
                  </View>

                  {structureView === 'categories' ? (
                    <View style={{ flex: 1, backgroundColor: theme.surface2, borderWidth: 1, borderColor: theme.border, borderRadius: 12, padding: 10 }}>
                      <Text style={{ fontFamily: 'Orbitron', fontSize: 9, color: theme.textDim, marginBottom: 8 }}>KATEGORIE (PRZYTRZYMAJ WIERSZ I PRZECIĄGNIJ)</Text>
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
                        keyExtractor={(item) => item.key}
                        activationDistance={4}
                        autoscrollThreshold={36}
                        autoscrollSpeed={140}
                        keyboardShouldPersistTaps="handled"
                        onDragEnd={({ data }) => setDraftCategories(data.map((d, i) => ({ ...d, position: i })))}
                        renderItem={({ item, drag, isActive }) => (
                          <TouchableOpacity
                            activeOpacity={0.92}
                            onLongPress={drag}
                            delayLongPress={120}
                            style={{ paddingVertical: 8, paddingHorizontal: 8, borderRadius: 8, backgroundColor: isActive ? `${theme.primary}22` : 'transparent', flexDirection: 'row', alignItems: 'center', gap: 8 }}
                          >
                            <MaterialCommunityIcons name="drag" size={16} color={theme.textDim} />
                            <Text style={{ flex: 1, color: theme.text }}>{item.name}</Text>
                            <TouchableOpacity onPress={() => setSelectedCategoryKey(item.key)}>
                              <Text style={{ color: selectedCategoryKey === item.key ? theme.primary : theme.textDim, fontSize: 11 }}>Wybierz</Text>
                            </TouchableOpacity>
                            <TouchableOpacity onPress={() => setDraftCategories(prev => moveUp(prev, item.key))}>
                              <MaterialIcons name="keyboard-arrow-up" size={18} color={theme.textDim} />
                            </TouchableOpacity>
                            <TouchableOpacity onPress={() => setDraftCategories(prev => moveDown(prev, item.key))}>
                              <MaterialIcons name="keyboard-arrow-down" size={18} color={theme.textDim} />
                            </TouchableOpacity>
                            <TouchableOpacity onPress={() => {
                              setDraftCategories(prev => prev.filter((c: any) => c.key !== item.key).map((c: any, i: number) => ({ ...c, position: i })));
                              setDraftChannels(prev => prev.map((ch: any) => ch.categoryRef === item.key ? { ...ch, categoryRef: null } : ch));
                            }}>
                              <MaterialIcons name="delete-outline" size={17} color="#e33835" />
                            </TouchableOpacity>
                          </TouchableOpacity>
                        )}
                      />
                    </View>
                  ) : (
                    <View style={{ flex: 1, backgroundColor: theme.surface2, borderWidth: 1, borderColor: theme.border, borderRadius: 12, padding: 10 }}>
                      <Text style={{ fontFamily: 'Orbitron', fontSize: 9, color: theme.textDim, marginBottom: 8 }}>KANAŁY (PRZYTRZYMAJ WIERSZ I PRZECIĄGNIJ)</Text>
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
                        keyExtractor={(item) => item.key}
                        activationDistance={4}
                        autoscrollThreshold={36}
                        autoscrollSpeed={140}
                        keyboardShouldPersistTaps="handled"
                        onDragEnd={({ data }) => setDraftChannels(data.map((d, i) => ({ ...d, position: i })))}
                        renderItem={({ item, drag, isActive }) => (
                          <TouchableOpacity
                            activeOpacity={0.92}
                            onLongPress={drag}
                            delayLongPress={120}
                            style={{ paddingVertical: 8, paddingHorizontal: 8, borderRadius: 8, backgroundColor: isActive ? `${theme.primary}22` : 'transparent', flexDirection: 'row', alignItems: 'center', gap: 8 }}
                          >
                            <MaterialCommunityIcons name="drag" size={16} color={theme.textDim} />
                            <View style={{ flex: 1 }}>
                              <Text style={{ color: theme.text }}># {item.name}</Text>
                              <Text style={{ color: theme.textDim, fontSize: 10 }}>{categoryNameByRef(item.categoryRef)}</Text>
                            </View>
                            <TouchableOpacity onPress={() => {
                              const idx = draftCategories.findIndex((c: any) => c.key === item.categoryRef);
                              const nextIdx = (idx + 1) % Math.max(1, draftCategories.length);
                              setDraftChannels(prev => prev.map((p: any) => p.key === item.key ? { ...p, categoryRef: draftCategories[nextIdx]?.key ?? null } : p));
                            }}>
                              <Text style={{ color: theme.primary, fontSize: 11 }}>Przenieś</Text>
                            </TouchableOpacity>
                            <TouchableOpacity onPress={() => setDraftChannels(prev => moveUp(prev, item.key))}>
                              <MaterialIcons name="keyboard-arrow-up" size={18} color={theme.textDim} />
                            </TouchableOpacity>
                            <TouchableOpacity onPress={() => setDraftChannels(prev => moveDown(prev, item.key))}>
                              <MaterialIcons name="keyboard-arrow-down" size={18} color={theme.textDim} />
                            </TouchableOpacity>
                            <TouchableOpacity onPress={() => {
                              setDraftChannels(prev => prev.filter((ch: any) => ch.key !== item.key).map((c: any, i: number) => ({ ...c, position: i })));
                            }}>
                              <MaterialIcons name="delete-outline" size={17} color="#e33835" />
                            </TouchableOpacity>
                          </TouchableOpacity>
                        )}
                      />
                    </View>
                  )}
                </View>
              )}

              <View style={{ paddingHorizontal: 16, paddingBottom: Platform.OS === 'ios' ? 24 : 14 }}>
                <TouchableOpacity
                  style={[{ marginTop: 8, backgroundColor: '#e33835', borderRadius: 12, paddingVertical: 13, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8 }, saving && { opacity: 0.6 }]}
                  onPress={submit}
                  disabled={saving}
                >
                  {saving ? <ActivityIndicator color="#fff" size={16} /> : <><MaterialCommunityIcons name="content-save" size={15} color="#fff" /><Text style={{ fontFamily: 'Orbitron', fontSize: 12, color: '#fff', fontWeight: '700' }}>ZAPISZ</Text></>}
                </TouchableOpacity>
              </View>
            </GestureHandlerRootView>
          </KeyboardAvoidingView>
        </View>
      </Modal>

      <RanksModal
        visible={ranksOpen}
        onClose={() => setRanksOpen(false)}
        clubId={club.id}
        ranks={club.ranks ?? []}
        onRefresh={async () => {
          const token = (await getAuthToken()) ?? '';
      if (!token) {
        Toast.show({ type: 'error', text1: 'Zaloguj się ponownie' });
        return;
      }
          const r = await fetch(`${API_URL}/api/clubs/${club.id}`, { headers: { Authorization: `Bearer ${token}` } });
          if (r.ok) onUpdated(await r.json());
        }}
      />
    </>
  );
}
