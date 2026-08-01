// @ts-nocheck
import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, Modal, TouchableOpacity, TextInput,
  ActivityIndicator, Switch, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Dimensions, Alert,
} from 'react-native';
import { Image } from 'expo-image';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import Toast from 'react-native-toast-message';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getAuthToken } from '../../lib/getAuthToken';
import { useTheme } from '../../contexts/ThemeContext';
import { useKeyboardInset } from '../../hooks/useKeyboardInset';
import { API_URL } from '../../constants/config';
import { Club } from './types';
import RanksModal from './RanksModal';

const mkId = () => `tmp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
const SHEET_H = Dimensions.get('window').height * 0.85;

interface Props {
  visible: boolean;
  club: Club | null;
  channels?: { id: number; name: string }[];
  onClose: () => void;
  onUpdated: (club: Club) => void;
}

async function compressClubAvatar(uri: string): Promise<string> {
  const out = await ImageManipulator.manipulateAsync(
    uri,
    [{ resize: { width: 800 } }],
    { compress: 0.82, format: ImageManipulator.SaveFormat.JPEG },
  );
  return out.uri;
}

export default function EditClubModal({ visible, club, channels = [], onClose, onUpdated }: Props) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const keyboardInset = useKeyboardInset(visible);
  const [tab, setTab] = useState<'general' | 'channels' | 'roles'>('general');
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [priv, setPriv] = useState(false);
  const [avatar, setAvatar] = useState<string | null>(null);
  const [joinChannelId, setJoinChannelId] = useState<number | null>(null);
  const [newCategory, setNewCategory] = useState('');
  const [newChannel, setNewChannel] = useState('');
  const [selectedCategoryKey, setSelectedCategoryKey] = useState<string | null>(null);
  const [draftCategories, setDraftCategories] = useState<any[]>([]);
  const [draftChannels, setDraftChannels] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);
  const [pickingAvatar, setPickingAvatar] = useState(false);
  const [ranksOpen, setRanksOpen] = useState(false);
  const [loadingClub, setLoadingClub] = useState(false);
  const structureDirtyRef = useRef(false);

  const footerPaddingBottom = keyboardInset > 0
    ? keyboardInset + 10
    : Math.max(insets.bottom, Platform.OS === 'ios' ? 20 : 14);

  const initFromClub = (c: Club) => {
    setName(c.name);
    setDesc(c.description ?? '');
    setPriv(c.isPrivate);
    setAvatar(null);
    setJoinChannelId(c.joinNotificationChannelId ?? null);

    const cats = [...(c.categories ?? [])]
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
      .map((cat: any, i: number) => ({ key: `cat_${cat.id}`, id: cat.id, name: cat.name, position: i }));

    const chs = [...(c.channels ?? [])]
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
      .map((ch: any, i: number) => ({
        key: `ch_${ch.id}`,
        id: ch.id,
        name: ch.name,
        categoryRef: ch.categoryId ? `cat_${ch.categoryId}` : null,
        position: i,
        isReadOnly: !!ch.isReadOnly,
        isDefaultGeneral: !!ch.isDefaultGeneral,
      }));

    setDraftCategories(cats);
    setDraftChannels(chs);
    setSelectedCategoryKey(cats[0]?.key ?? null);
    structureDirtyRef.current = false;
  };

  useEffect(() => {
    if (!club || !visible) return;
    let cancelled = false;

    const load = async () => {
      setLoadingClub(true);
      try {
        let source = club;
        const needsDetail =
          !Array.isArray(club.categories)
          || !Array.isArray(club.channels)
          || (club.categories.length === 0 && club.channels.length === 0);

        if (needsDetail) {
          const token = (await getAuthToken()) ?? '';
          if (token) {
            const r = await fetch(`${API_URL}/api/clubs/${club.id}`, {
              headers: { Authorization: `Bearer ${token}` },
            });
            if (r.ok && !cancelled) source = await r.json();
          }
        }

        if (!cancelled) initFromClub(source);
      } catch {
        if (!cancelled) initFromClub(club);
      } finally {
        if (!cancelled) setLoadingClub(false);
      }
    };

    setTab('general');
    void load();
    return () => { cancelled = true; };
  }, [club?.id, visible]);

  const pick = async () => {
    if (pickingAvatar) return;
    setPickingAvatar(true);
    try {
      const r = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.85,
      });
      if (r.canceled || !r.assets?.[0]?.uri) return;
      const compressed = await compressClubAvatar(r.assets[0].uri);
      setAvatar(compressed);
    } catch (e: any) {
      Toast.show({ type: 'error', text1: 'Błąd zdjęcia', text2: e?.message ?? 'Nie udało się wybrać zdjęcia' });
    } finally {
      setPickingAvatar(false);
    }
  };

  const addCategory = () => {
    if (!newCategory.trim()) return;
    const key = mkId();
    structureDirtyRef.current = true;
    setDraftCategories(prev => [...prev, { key, id: null, name: newCategory.trim(), position: prev.length }]);
    setSelectedCategoryKey(key);
    setNewCategory('');
  };

  const addChannel = () => {
    if (!newChannel.trim()) return;
    const key = mkId();
    const catKey = selectedCategoryKey ?? draftCategories[0]?.key ?? null;
    structureDirtyRef.current = true;
    setDraftChannels(prev => [...prev, { key, id: null, name: newChannel.trim(), categoryRef: catKey, position: prev.length, isReadOnly: false, isDefaultGeneral: false }]);
    setNewChannel('');
  };

  const moveUp = (arr: any[], key: string) => {
    const idx = arr.findIndex((x: any) => x.key === key);
    if (idx <= 0) return arr;
    structureDirtyRef.current = true;
    const copy = [...arr];
    const [item] = copy.splice(idx, 1);
    copy.splice(idx - 1, 0, item);
    return copy.map((x: any, i: number) => ({ ...x, position: i }));
  };

  const moveDown = (arr: any[], key: string) => {
    const idx = arr.findIndex((x: any) => x.key === key);
    if (idx < 0 || idx >= arr.length - 1) return arr;
    structureDirtyRef.current = true;
    const copy = [...arr];
    const [item] = copy.splice(idx, 1);
    copy.splice(idx + 1, 0, item);
    return copy.map((x: any, i: number) => ({ ...x, position: i }));
  };

  const categoryNameByRef = (ref: string | null) => draftCategories.find((c: any) => c.key === ref)?.name ?? 'Brak kategorii';

  const submit = async () => {
    if (!club || saving) return;
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
        form.append('avatar', { uri: avatar, name: 'avatar.jpg', type: 'image/jpeg' } as any);
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

      if (structureDirtyRef.current) {
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
            body: JSON.stringify({ name: ch.name, categoryId: categoryId ?? null, isReadOnly: !!ch.isReadOnly }),
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
          name: c.name,
          position: idx,
        })).filter((c: any) => !!c.id);

        const channelsPayload = draftChannels.map((ch, idx) => ({
          id: channelIdByKey.get(ch.key) ?? ch.id,
          position: idx,
          categoryId: ch.categoryRef ? (categoryIdByKey.get(ch.categoryRef) ?? null) : null,
          name: ch.name,
          isReadOnly: !!ch.isReadOnly,
        })).filter((c: any) => !!c.id);

        const structRes = await fetch(`${API_URL}/api/clubs/${club.id}/structure`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            categories: categoriesPayload,
            channels: channelsPayload,
            joinNotificationChannelId: joinChannelId,
            pruneMissing: true,
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
  const channelOptions = draftChannels.length > 0
    ? draftChannels.filter(ch => ch.id).map(ch => ({ id: ch.id, name: ch.name }))
    : (club.channels ?? channels);

  const renderCategoryRow = (item: any) => (
    <View
      key={item.key}
      style={{ paddingVertical: 8, paddingHorizontal: 8, borderRadius: 8, flexDirection: 'row', alignItems: 'center', gap: 8, borderBottomWidth: 1, borderBottomColor: theme.border }}
    >
      <TextInput
        value={item.name}
        onChangeText={(name) => {
          structureDirtyRef.current = true;
          setDraftCategories(prev => prev.map((c: any) => c.key === item.key ? { ...c, name } : c));
        }}
        style={{ flex: 1, color: theme.text, paddingVertical: 3 }}
      />
      <TouchableOpacity onPress={() => setSelectedCategoryKey(item.key)}>
        <Text style={{ color: selectedCategoryKey === item.key ? theme.primary : theme.textDim, fontSize: 11 }}>Wybierz</Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={() => setDraftCategories(prev => moveUp(prev, item.key))}>
        <MaterialIcons name="keyboard-arrow-up" size={18} color={theme.textDim} />
      </TouchableOpacity>
      <TouchableOpacity onPress={() => setDraftCategories(prev => moveDown(prev, item.key))}>
        <MaterialIcons name="keyboard-arrow-down" size={18} color={theme.textDim} />
      </TouchableOpacity>
      <TouchableOpacity onPress={() => Alert.alert('Usuń kategorię', 'Kanały zostaną przeniesione poza kategorię.', [
        { text: 'Anuluj', style: 'cancel' },
        { text: 'Usuń', style: 'destructive', onPress: () => {
          structureDirtyRef.current = true;
          setDraftCategories(prev => prev.filter((c: any) => c.key !== item.key).map((c: any, i: number) => ({ ...c, position: i })));
          setDraftChannels(prev => prev.map((ch: any) => ch.categoryRef === item.key ? { ...ch, categoryRef: null } : ch));
        } },
      ])}>
        <MaterialIcons name="delete-outline" size={17} color="#e33835" />
      </TouchableOpacity>
    </View>
  );

  const renderChannelRow = (item: any) => {
    const protectedChannel = item.isDefaultGeneral || item.id === joinChannelId;
    return (
    <View
      key={item.key}
      style={{ paddingVertical: 8, paddingHorizontal: 8, borderRadius: 8, flexDirection: 'row', alignItems: 'center', gap: 8, borderBottomWidth: 1, borderBottomColor: theme.border }}
    >
      <View style={{ flex: 1 }}>
        <TextInput
          value={item.name}
          onChangeText={(name) => {
            structureDirtyRef.current = true;
            setDraftChannels(prev => prev.map((ch: any) => ch.key === item.key ? { ...ch, name } : ch));
          }}
          style={{ color: theme.text, paddingVertical: 1 }}
        />
        <Text style={{ color: theme.textDim, fontSize: 10 }}>{categoryNameByRef(item.categoryRef)}</Text>
        {protectedChannel && <Text style={{ color: theme.gold, fontSize: 9 }}>{item.isDefaultGeneral ? 'DOMYŚLNY · CHRONIONY' : 'POWITALNY · CHRONIONY'}</Text>}
      </View>
      <TouchableOpacity onPress={() => {
        structureDirtyRef.current = true;
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
      <TouchableOpacity
        onPress={() => {
          if (protectedChannel) return;
          Alert.alert('Usuń kanał', `Usunąć #${item.name}?`, [
            { text: 'Anuluj', style: 'cancel' },
            { text: 'Usuń', style: 'destructive', onPress: () => {
              structureDirtyRef.current = true;
              setDraftChannels(prev => prev.filter((ch: any) => ch.key !== item.key).map((c: any, i: number) => ({ ...c, position: i })));
            } },
          ]);
        }}
        disabled={protectedChannel}
      >
        <MaterialIcons name={protectedChannel ? 'lock' : 'delete-outline'} size={17} color={protectedChannel ? theme.textDim : '#e33835'} />
      </TouchableOpacity>
      <TouchableOpacity
        onPress={() => {
          structureDirtyRef.current = true;
          setDraftChannels(prev => prev.map((ch: any) => ch.key === item.key ? { ...ch, isReadOnly: !ch.isReadOnly } : ch));
        }}
        style={{ alignItems: 'center' }}
      >
        <MaterialIcons name={item.isReadOnly ? 'lock' : 'lock-open'} size={17} color={item.isReadOnly ? theme.primary : theme.textDim} />
        <Text style={{ color: theme.textDim, fontSize: 7 }}>READ ONLY</Text>
      </TouchableOpacity>
    </View>
  );};

  return (
    <>
      <Modal
        visible={visible && !ranksOpen}
        animationType="slide"
        transparent
        onRequestClose={onClose}
        presentationStyle="overFullScreen"
        statusBarTranslucent
        navigationBarTranslucent
      >
        <View style={styles.overlay}>
          <TouchableOpacity style={StyleSheet.absoluteFillObject} activeOpacity={1} onPress={onClose} />
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            enabled={Platform.OS === 'ios'}
            keyboardVerticalOffset={18}
            style={styles.kav}
          >
            <View style={[styles.sheet, { backgroundColor: theme.surface, borderColor: theme.border2 }]}>
              <View style={styles.handleWrap}>
                <View style={[styles.handle, { backgroundColor: theme.border3 }]} />
              </View>

              <View style={styles.mainTabs}>
                <TouchableOpacity onPress={() => setTab('general')} style={[styles.tabBtn, { backgroundColor: tab === 'general' ? `${theme.primary}22` : theme.surface2, borderColor: tab === 'general' ? theme.primary : theme.border }]}>
                  <Text style={[styles.tabText, { color: tab === 'general' ? theme.primary : theme.textDim }]}>OGÓLNE</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setTab('channels')} style={[styles.tabBtn, { backgroundColor: tab === 'channels' ? `${theme.primary}22` : theme.surface2, borderColor: tab === 'channels' ? theme.primary : theme.border }]}>
                  <Text style={[styles.tabText, { color: tab === 'channels' ? theme.primary : theme.textDim }]}>KANAŁY</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setTab('roles')} style={[styles.tabBtn, { backgroundColor: tab === 'roles' ? `${theme.primary}22` : theme.surface2, borderColor: tab === 'roles' ? theme.primary : theme.border }]}>
                  <Text style={[styles.tabText, { color: tab === 'roles' ? theme.primary : theme.textDim }]}>ROLE</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.body}>
                {loadingClub ? (
                  <View style={styles.loadingBox}>
                    <ActivityIndicator color={theme.primary} />
                    <Text style={{ color: theme.textDim, fontFamily: 'Orbitron', fontSize: 10, marginTop: 10 }}>Ładowanie ustawień…</Text>
                  </View>
                ) : tab === 'general' ? (
                  <ScrollView
                    style={styles.flex}
                    contentContainerStyle={styles.generalScroll}
                    keyboardShouldPersistTaps="handled"
                    keyboardDismissMode="on-drag"
                  >
                    <TouchableOpacity style={{ alignSelf: 'center', marginBottom: 14 }} onPress={pick} disabled={pickingAvatar || saving}>
                      <View style={styles.avatarBox}>
                        {pickingAvatar ? (
                          <ActivityIndicator color="#e33835" />
                        ) : avatarSrc ? (
                          <Image key={avatarSrc} source={{ uri: avatarSrc }} style={styles.avatarImg} contentFit="cover" />
                        ) : (
                          <MaterialCommunityIcons name="shield-crown-outline" size={28} color="#e33835" />
                        )}
                      </View>
                      <Text style={{ textAlign: 'center', fontFamily: 'Orbitron', fontSize: 9, color: theme.textDim, marginTop: 6 }}>Zmień logo klubu</Text>
                    </TouchableOpacity>

                    <TextInput
                      style={[styles.input, { backgroundColor: theme.surface2, color: theme.text, borderColor: theme.border }]}
                      value={name}
                      onChangeText={setName}
                      placeholder="Nazwa klubu *"
                      placeholderTextColor={theme.textDim}
                    />
                    <TextInput
                      style={[styles.input, styles.inputMultiline, { backgroundColor: theme.surface2, color: theme.text, borderColor: theme.border }]}
                      value={desc}
                      onChangeText={setDesc}
                      placeholder="Opis"
                      placeholderTextColor={theme.textDim}
                      multiline
                    />
                    <TouchableOpacity style={[styles.privateRow, { backgroundColor: theme.surface2, borderColor: theme.border }]} onPress={() => setPriv(v => !v)}>
                      <MaterialIcons name={priv ? 'lock' : 'lock-open'} size={17} color={priv ? '#e33835' : theme.textDim} />
                      <View style={styles.flex}>
                        <Text style={{ fontFamily: 'Orbitron', fontSize: 10, color: theme.text, fontWeight: '700' }}>PRYWATNY KLUB</Text>
                      </View>
                      <Switch value={priv} onValueChange={setPriv} trackColor={{ true: '#e33835' }} />
                    </TouchableOpacity>

                    <View style={{ marginBottom: 14 }}>
                      <Text style={{ fontFamily: 'Orbitron', fontSize: 9, color: theme.textDim, marginBottom: 6 }}>KANAŁ POWITAŃ</Text>
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                        {channelOptions.map(ch => (
                          <TouchableOpacity key={ch.id} onPress={() => setJoinChannelId(ch.id)} style={{ paddingHorizontal: 8, paddingVertical: 5, borderRadius: 999, borderWidth: 1, borderColor: joinChannelId === ch.id ? '#e33835' : theme.border }}>
                            <Text style={{ fontSize: 11, color: joinChannelId === ch.id ? '#e33835' : theme.textDim }}># {ch.name}</Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    </View>

                    <TouchableOpacity
                      style={styles.ranksBtn}
                      onPress={() => setRanksOpen(true)}
                    >
                      <MaterialCommunityIcons name="shield-star" size={16} color="#FFD700" />
                      <Text style={{ fontFamily: 'Orbitron', fontSize: 10, color: '#FFD700', fontWeight: '700' }}>RANGI I UPRAWNIENIA</Text>
                    </TouchableOpacity>
                  </ScrollView>
                ) : tab === 'channels' ? (
                  <View style={styles.structureWrap}>
                    <View style={[styles.structurePanel, { backgroundColor: theme.surface2, borderColor: theme.border }]}>
                      <Text style={{ fontFamily: 'Orbitron', fontSize: 9, color: theme.textDim, marginBottom: 8 }}>KATEGORIE I KANAŁY · STRZAŁKI ZMIENIAJĄ KOLEJNOŚĆ</Text>
                      <View style={styles.addRow}>
                        <TextInput
                          value={newCategory}
                          onChangeText={setNewCategory}
                          placeholder="Nowa kategoria"
                          placeholderTextColor={theme.textDim}
                          style={[styles.addInput, { backgroundColor: theme.bg, color: theme.text, borderColor: theme.border }]}
                        />
                        <TouchableOpacity
                          onPress={addCategory}
                          style={styles.addBtn}
                        >
                          <MaterialIcons name="add" size={18} color="#fff" />
                        </TouchableOpacity>
                      </View>
                      <View style={styles.addRow}>
                        <TextInput value={newChannel} onChangeText={setNewChannel} placeholder="Nowy kanał" placeholderTextColor={theme.textDim} style={[styles.addInput, { backgroundColor: theme.bg, color: theme.text, borderColor: theme.border }]} />
                        <TouchableOpacity onPress={addChannel} style={styles.addBtn}><MaterialIcons name="add" size={18} color="#fff" /></TouchableOpacity>
                      </View>
                      <ScrollView
                        style={styles.flex}
                        contentContainerStyle={{ paddingBottom: 8 }}
                        keyboardShouldPersistTaps="handled"
                        nestedScrollEnabled
                      >
                        <Text style={{ color: theme.textDim, fontFamily: 'Orbitron', fontSize: 8, marginVertical: 6 }}>KATEGORIE</Text>
                        {draftCategories.map(renderCategoryRow)}
                        <Text style={{ color: theme.textDim, fontFamily: 'Orbitron', fontSize: 8, marginVertical: 6 }}>KANAŁY</Text>
                        {draftChannels.map(renderChannelRow)}
                      </ScrollView>
                    </View>
                  </View>
                ) : (
                  <View style={{ flex: 1, paddingHorizontal: 16, justifyContent: 'center' }}>
                    <TouchableOpacity style={styles.ranksBtn} onPress={() => setRanksOpen(true)}>
                      <MaterialCommunityIcons name="shield-star" size={20} color="#FFD700" />
                      <Text style={{ fontFamily: 'Orbitron', fontSize: 11, color: '#FFD700', fontWeight: '700' }}>OTWÓRZ ROLE I UPRAWNIENIA</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>

              <View style={[styles.footer, { paddingBottom: footerPaddingBottom }]}>
                <TouchableOpacity
                  style={[styles.saveBtn, saving && { opacity: 0.6 }]}
                  onPress={submit}
                  disabled={saving || loadingClub}
                >
                  {saving
                    ? <ActivityIndicator color="#fff" size="small" />
                    : <>
                      <MaterialCommunityIcons name="content-save" size={15} color="#fff" />
                      <Text style={styles.saveText}>ZAPISZ</Text>
                    </>
                  }
                </TouchableOpacity>
              </View>
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

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: '#000000bb', justifyContent: 'flex-end' },
  kav: { width: '100%' },
  sheet: {
    height: SHEET_H,
    maxHeight: '92%',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: 1,
    overflow: 'hidden',
  },
  handleWrap: { alignItems: 'center', paddingTop: 12, paddingBottom: 10 },
  handle: { width: 36, height: 4, borderRadius: 2 },
  mainTabs: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, marginBottom: 10 },
  tabBtn: { flex: 1, paddingVertical: 8, borderRadius: 8, borderWidth: 1 },
  tabText: { textAlign: 'center', fontFamily: 'Orbitron', fontSize: 9 },
  body: { flex: 1, minHeight: 0 },
  flex: { flex: 1 },
  loadingBox: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  generalScroll: { paddingHorizontal: 16, paddingBottom: 16 },
  structureWrap: { flex: 1, paddingHorizontal: 16, minHeight: 0 },
  subTabs: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  structurePanel: { flex: 1, minHeight: 0, borderWidth: 1, borderRadius: 12, padding: 10 },
  addRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  addInput: { flex: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, borderWidth: 1 },
  addBtn: { backgroundColor: '#e33835', borderRadius: 8, paddingHorizontal: 10, justifyContent: 'center' },
  emptyText: { color: '#888', fontSize: 12, textAlign: 'center', paddingVertical: 16 },
  footer: { flexShrink: 0, paddingHorizontal: 16, paddingTop: 8 },
  saveBtn: {
    backgroundColor: '#e33835',
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
  },
  saveText: { fontFamily: 'Orbitron', fontSize: 12, color: '#fff', fontWeight: '700' },
  avatarBox: {
    width: 72,
    height: 72,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: '#e3383515',
    borderWidth: 2,
    borderColor: '#e3383540',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarImg: { width: 72, height: 72 },
  input: {
    borderRadius: 11,
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontSize: 14,
    borderWidth: 1,
    marginBottom: 9,
  },
  inputMultiline: { minHeight: 64, textAlignVertical: 'top', fontSize: 13, marginBottom: 10 },
  privateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 12,
    borderRadius: 11,
    padding: 12,
    borderWidth: 1,
  },
  ranksBtn: {
    marginTop: 6,
    backgroundColor: '#FFD7001A',
    borderWidth: 1,
    borderColor: '#FFD70055',
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
  },
});
