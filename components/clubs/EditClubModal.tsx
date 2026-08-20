import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { Image } from 'expo-image';
import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { SafeAreaView } from 'react-native-safe-area-context';
import ToastOriginal from 'react-native-toast-message';

import { API_URL } from '../../constants/config';
import { useTheme } from '../../contexts/ThemeContext';
import { getAuthToken } from '../../lib/getAuthToken';
import { UAv } from './ClubCard';
import {
  buildDraftStructure,
  CLUB_PERMISSION_DEFINITIONS,
  CLUB_RANK_COLORS,
  createDraftKey,
  getMemberRanks,
  groupChannelsByCategory,
  hasClubPermission,
  moveDraftItem,
  slugifyChannelName,
  type ClubManagementTab,
  type ClubPermissionKey,
  type DraftClubCategory,
  type DraftClubChannel,
} from './clubManagementModel';
import type { Club, ClubMemberItem, ClubRank } from './types';

// The package's bundled declaration omits its runtime `text1` field in this project.
const Toast = ToastOriginal as typeof ToastOriginal & { show: (params: { type?: string; text1?: string; text2?: string }) => void };

interface Props {
  visible: boolean;
  club: Club | null;
  channels?: { id: number; name: string }[];
  initialTab?: ClubManagementTab;
  onClose: () => void;
  onUpdated: (club: Club) => void;
}

interface PendingInvite {
  id: number;
  invited: { id: number; username: string; avatarUrl: string | null };
  inviter: { id: number; username: string };
  createdAt: string;
}

interface RankDraft {
  id: number | null;
  name: string;
  color: string;
  priority: string;
  permissions: Record<ClubPermissionKey, boolean>;
}

const EMPTY_PERMISSIONS: Record<ClubPermissionKey, boolean> = {
  canManage: false,
  canKick: false,
  canMute: false,
  canPin: false,
  canWriteReadOnly: false,
};

const TABS: { key: ClubManagementTab; label: string; icon: React.ComponentProps<typeof MaterialIcons>['name'] }[] = [
  { key: 'overview', label: 'Klub', icon: 'tune' },
  { key: 'channels', label: 'Kanały', icon: 'tag' },
  { key: 'roles', label: 'Role', icon: 'shield' },
  { key: 'members', label: 'Ludzie', icon: 'group' },
];

async function parseResponse<T = unknown>(response: Response): Promise<T> {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof data?.error === 'string' ? data.error : 'Nie udało się zapisać zmian';
    throw new Error(message);
  }
  return data as T;
}

async function clubAvatarFromLibrary(): Promise<string | null> {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    allowsEditing: true,
    aspect: [1, 1],
    quality: 0.9,
  });
  if (result.canceled || !result.assets?.[0]?.uri) return null;
  const compressed = await ImageManipulator.manipulateAsync(
    result.assets[0].uri,
    [{ resize: { width: 800 } }],
    { compress: 0.82, format: ImageManipulator.SaveFormat.JPEG },
  );
  return compressed.uri;
}

export default function EditClubModal({ visible, club, initialTab = 'overview', onClose, onUpdated }: Props) {
  const { theme } = useTheme();
  const [tab, setTab] = useState<ClubManagementTab>('overview');
  const [localClub, setLocalClub] = useState<Club | null>(club);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [changed, setChanged] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<number | null>(null);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isPrivate, setIsPrivate] = useState(false);
  const [avatarUri, setAvatarUri] = useState<string | null>(null);
  const [pickingAvatar, setPickingAvatar] = useState(false);

  const [categories, setCategories] = useState<DraftClubCategory[]>([]);
  const [draftChannels, setDraftChannels] = useState<DraftClubChannel[]>([]);
  const [structureDirty, setStructureDirty] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [newChannelName, setNewChannelName] = useState('');
  const [newChannelCategoryKey, setNewChannelCategoryKey] = useState<string | null>(null);
  const [joinChannelKey, setJoinChannelKey] = useState<string | null>(null);

  const [rankDraft, setRankDraft] = useState<RankDraft | null>(null);
  const [memberSearch, setMemberSearch] = useState('');
  const [selectedMemberId, setSelectedMemberId] = useState<number | null>(null);
  const [selectedRankIds, setSelectedRankIds] = useState<number[]>([]);
  const [memberBusy, setMemberBusy] = useState(false);

  const [inviteUsername, setInviteUsername] = useState('');
  const [invites, setInvites] = useState<PendingInvite[]>([]);
  const [invitesLoading, setInvitesLoading] = useState(false);
  const [inviteBusy, setInviteBusy] = useState(false);
  const latestClubRef = useRef<Club | null>(club);

  const applyClub = useCallback((nextClub: Club, markChanged = false) => {
    latestClubRef.current = nextClub;
    setLocalClub(nextClub);
    if (markChanged) setChanged(true);
    const draft = buildDraftStructure(nextClub);
    setCategories(draft.categories);
    setDraftChannels(draft.channels);
    setJoinChannelKey(
      draft.channels.find((channel) => channel.id === nextClub.joinNotificationChannelId)?.key
      ?? draft.channels.find((channel) => channel.isDefaultGeneral)?.key
      ?? draft.channels[0]?.key
      ?? null,
    );
    setNewChannelCategoryKey(draft.categories[0]?.key ?? null);
    setStructureDirty(false);
  }, []);

  const refreshClub = useCallback(async (markChanged = false) => {
    const clubId = latestClubRef.current?.id ?? club?.id;
    if (!clubId) return null;
    const token = await getAuthToken();
    if (!token) throw new Error('Zaloguj się ponownie');
    const response = await fetch(`${API_URL}/api/clubs/${clubId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const nextClub = await parseResponse<Club>(response);
    applyClub(nextClub, markChanged);
    return nextClub;
  }, [applyClub, club?.id]);

  const loadInvites = useCallback(async () => {
    const clubId = latestClubRef.current?.id;
    if (!clubId) return;
    setInvitesLoading(true);
    try {
      const token = await getAuthToken();
      if (!token) return;
      const response = await fetch(`${API_URL}/api/clubs/${clubId}/invites`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.ok) setInvites(await response.json());
    } finally {
      setInvitesLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!visible || !club) return;
    latestClubRef.current = club;
    setLocalClub(club);
    setChanged(false);
    setTab(initialTab);
    setSelectedMemberId(null);
    setRankDraft(null);
    setMemberSearch('');
    setInviteUsername('');
    setInvites([]);
    setLoading(true);
    applyClub(club);
    void refreshClub().catch((error: Error) => {
      Toast.show({ type: 'error', text1: 'Nie udało się odświeżyć klubu', text2: error.message });
    }).finally(() => setLoading(false));

    void AsyncStorage.getItem('user').then((raw) => {
      if (!raw) return;
      const user = JSON.parse(raw);
      const userId = Number(user?.userId ?? user?.id);
      if (Number.isFinite(userId)) setCurrentUserId(userId);
    }).catch(() => {});
  }, [applyClub, club, initialTab, refreshClub, visible]);

  useEffect(() => {
    if (!localClub) return;
    setName(localClub.name);
    setDescription(localClub.description ?? '');
    setIsPrivate(localClub.isPrivate);
    setAvatarUri(null);
  }, [localClub]);

  const isOwner = localClub?.myRole === 'owner';
  const canManage = !!localClub && hasClubPermission(localClub, 'canManage');
  const canKick = !!localClub && hasClubPermission(localClub, 'canKick');
  const canMute = !!localClub && hasClubPermission(localClub, 'canMute');
  const members = useMemo(() => localClub?.members ?? [], [localClub?.members]);
  const ranks = useMemo(
    () => [...(localClub?.ranks ?? [])].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0) || a.id - b.id),
    [localClub?.ranks],
  );
  const selectedMember = members.find((member) => member.id === selectedMemberId) ?? null;
  const channelSections = useMemo(() => groupChannelsByCategory(categories, draftChannels), [categories, draftChannels]);
  const visibleMembers = useMemo(() => {
    const query = memberSearch.trim().toLocaleLowerCase('pl-PL');
    if (!query) return members;
    return members.filter((member) => (
      member.username.toLocaleLowerCase('pl-PL').includes(query)
      || getMemberRanks(member).some((rank) => rank.name.toLocaleLowerCase('pl-PL').includes(query))
    ));
  }, [memberSearch, members]);

  useEffect(() => {
    if (tab === 'members' && canManage) void loadInvites();
  }, [canManage, loadInvites, tab]);

  const closeManager = () => {
    const latest = latestClubRef.current;
    if (changed && latest) onUpdated(latest);
    else onClose();
  };

  const saveOverview = async () => {
    if (!localClub || !canManage || saving) return;
    if (!name.trim()) {
      Toast.show({ type: 'error', text1: 'Nazwa klubu jest wymagana' });
      return;
    }
    setSaving(true);
    try {
      const token = await getAuthToken();
      if (!token) throw new Error('Zaloguj się ponownie');
      const form = new FormData();
      form.append('name', name.trim());
      form.append('description', description.trim());
      form.append('isPrivate', String(isPrivate));
      form.append('joinNotificationChannelId', localClub.joinNotificationChannelId ? String(localClub.joinNotificationChannelId) : 'null');
      if (avatarUri) form.append('avatar', { uri: avatarUri, name: 'club-avatar.jpg', type: 'image/jpeg' } as never);
      const response = await fetch(`${API_URL}/api/clubs/${localClub.id}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      const updated = await parseResponse<Club>(response);
      applyClub(updated, true);
      Toast.show({ type: 'success', text1: 'Profil klubu zapisany' });
    } catch (error) {
      Toast.show({ type: 'error', text1: 'Nie zapisano zmian', text2: error instanceof Error ? error.message : undefined });
    } finally {
      setSaving(false);
    }
  };

  const markStructureDirty = () => setStructureDirty(true);

  const addCategory = () => {
    const categoryName = newCategoryName.trim();
    if (!categoryName) return;
    if (categories.some((category) => category.name.toLocaleLowerCase('pl-PL') === categoryName.toLocaleLowerCase('pl-PL'))) {
      Toast.show({ type: 'error', text1: 'Taka kategoria już istnieje' });
      return;
    }
    const category: DraftClubCategory = {
      key: createDraftKey('category'),
      id: null,
      name: categoryName,
      position: categories.length,
    };
    setCategories((current) => [...current, category]);
    setNewChannelCategoryKey(category.key);
    setNewCategoryName('');
    markStructureDirty();
  };

  const addChannel = () => {
    const channelName = slugifyChannelName(newChannelName);
    if (!channelName) {
      Toast.show({ type: 'error', text1: 'Podaj nazwę kanału' });
      return;
    }
    if (draftChannels.some((channel) => channel.name.toLocaleLowerCase('pl-PL') === channelName.toLocaleLowerCase('pl-PL'))) {
      Toast.show({ type: 'error', text1: 'Taki kanał już istnieje' });
      return;
    }
    const channel: DraftClubChannel = {
      key: createDraftKey('channel'),
      id: null,
      name: channelName,
      categoryKey: newChannelCategoryKey,
      position: draftChannels.length,
      isDefaultGeneral: false,
      isReadOnly: false,
    };
    setDraftChannels((current) => [...current, channel]);
    setNewChannelName('');
    if (!joinChannelKey) setJoinChannelKey(channel.key);
    markStructureDirty();
  };

  const saveStructure = async () => {
    if (!localClub || !canManage || saving || !structureDirty) return;
    if (categories.some((category) => !category.name.trim()) || draftChannels.some((channel) => !channel.name.trim())) {
      Toast.show({ type: 'error', text1: 'Nazwy kategorii i kanałów nie mogą być puste' });
      return;
    }
    const channelNames = draftChannels.map((channel) => channel.name.trim().toLocaleLowerCase('pl-PL'));
    if (new Set(channelNames).size !== channelNames.length) {
      Toast.show({ type: 'error', text1: 'Nazwy kanałów muszą być unikalne' });
      return;
    }
    setSaving(true);
    try {
      const token = await getAuthToken();
      if (!token) throw new Error('Zaloguj się ponownie');
      const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
      const categoryIds = new Map<string, number>();
      for (const category of categories) {
        if (category.id) {
          categoryIds.set(category.key, category.id);
          continue;
        }
        const response = await fetch(`${API_URL}/api/clubs/${localClub.id}/categories`, {
          method: 'POST', headers, body: JSON.stringify({ name: category.name.trim() }),
        });
        const created = await parseResponse<{ id: number }>(response);
        categoryIds.set(category.key, created.id);
      }

      const channelIds = new Map<string, number>();
      for (const channel of draftChannels) {
        if (channel.id) {
          channelIds.set(channel.key, channel.id);
          continue;
        }
        const response = await fetch(`${API_URL}/api/clubs/${localClub.id}/channels`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            name: channel.name.trim(),
            categoryId: channel.categoryKey ? categoryIds.get(channel.categoryKey) ?? null : null,
            isReadOnly: channel.isReadOnly,
          }),
        });
        const created = await parseResponse<{ id: number }>(response);
        channelIds.set(channel.key, created.id);
      }

      const response = await fetch(`${API_URL}/api/clubs/${localClub.id}/structure`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          categories: categories.map((category, position) => ({
            id: categoryIds.get(category.key),
            name: category.name.trim(),
            position,
          })),
          channels: draftChannels.map((channel, position) => ({
            id: channelIds.get(channel.key),
            name: channel.name.trim(),
            categoryId: channel.categoryKey ? categoryIds.get(channel.categoryKey) ?? null : null,
            position,
            isReadOnly: channel.isReadOnly,
          })),
          joinNotificationChannelId: joinChannelKey ? channelIds.get(joinChannelKey) ?? null : null,
          pruneMissing: true,
        }),
      });
      const updated = await parseResponse<Club>(response);
      applyClub(updated, true);
      Toast.show({ type: 'success', text1: 'Układ kanałów zapisany' });
    } catch (error) {
      Toast.show({ type: 'error', text1: 'Nie zapisano kanałów', text2: error instanceof Error ? error.message : undefined });
      await refreshClub().catch(() => {});
    } finally {
      setSaving(false);
    }
  };

  const startNewRank = () => setRankDraft({
    id: null,
    name: '',
    color: CLUB_RANK_COLORS[0],
    priority: '0',
    permissions: { ...EMPTY_PERMISSIONS },
  });

  const editRank = (rank: ClubRank) => setRankDraft({
    id: rank.id,
    name: rank.name,
    color: rank.color,
    priority: String(rank.priority ?? 0),
    permissions: {
      canManage: !!rank.canManage,
      canKick: !!rank.canKick,
      canMute: !!rank.canMute,
      canPin: !!rank.canPin,
      canWriteReadOnly: !!rank.canWriteReadOnly,
    },
  });

  const saveRank = async () => {
    if (!localClub || !rankDraft || !isOwner || saving) return;
    if (!rankDraft.name.trim()) {
      Toast.show({ type: 'error', text1: 'Nazwa roli jest wymagana' });
      return;
    }
    setSaving(true);
    try {
      const token = await getAuthToken();
      if (!token) throw new Error('Zaloguj się ponownie');
      const response = await fetch(`${API_URL}/api/clubs/${localClub.id}/ranks${rankDraft.id ? `/${rankDraft.id}` : ''}`, {
        method: rankDraft.id ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          name: rankDraft.name.trim(),
          color: rankDraft.color,
          priority: Number(rankDraft.priority) || 0,
          ...rankDraft.permissions,
        }),
      });
      await parseResponse(response);
      await refreshClub(true);
      setRankDraft(null);
      Toast.show({ type: 'success', text1: rankDraft.id ? 'Rola zapisana' : 'Rola utworzona' });
    } catch (error) {
      Toast.show({ type: 'error', text1: 'Nie zapisano roli', text2: error instanceof Error ? error.message : undefined });
    } finally {
      setSaving(false);
    }
  };

  const deleteRank = (rank: ClubRank) => {
    if (!localClub || !isOwner) return;
    Alert.alert('Usuń rolę', `Usunąć rolę „${rank.name}”? Zostanie odebrana wszystkim członkom.`, [
      { text: 'Anuluj', style: 'cancel' },
      {
        text: 'Usuń',
        style: 'destructive',
        onPress: async () => {
          try {
            const token = await getAuthToken();
            if (!token) throw new Error('Zaloguj się ponownie');
            const response = await fetch(`${API_URL}/api/clubs/${localClub.id}/ranks/${rank.id}`, {
              method: 'DELETE', headers: { Authorization: `Bearer ${token}` },
            });
            await parseResponse(response);
            await refreshClub(true);
            if (rankDraft?.id === rank.id) setRankDraft(null);
          } catch (error) {
            Toast.show({ type: 'error', text1: 'Nie usunięto roli', text2: error instanceof Error ? error.message : undefined });
          }
        },
      },
    ]);
  };

  const openMember = (member: ClubMemberItem) => {
    setSelectedMemberId(member.id);
    setSelectedRankIds(getMemberRanks(member).map((rank) => rank.id));
  };

  const saveMemberRanks = async () => {
    if (!localClub || !selectedMember || !isOwner || memberBusy) return;
    setMemberBusy(true);
    try {
      const token = await getAuthToken();
      if (!token) throw new Error('Zaloguj się ponownie');
      const response = await fetch(`${API_URL}/api/clubs/${localClub.id}/members/${selectedMember.userId}/ranks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ rankIds: selectedRankIds }),
      });
      await parseResponse(response);
      await refreshClub(true);
      Toast.show({ type: 'success', text1: `Role ${selectedMember.username} zapisane` });
    } catch (error) {
      Toast.show({ type: 'error', text1: 'Nie zapisano ról członka', text2: error instanceof Error ? error.message : undefined });
    } finally {
      setMemberBusy(false);
    }
  };

  const toggleMemberMute = async () => {
    if (!localClub || !selectedMember || !canMute || memberBusy) return;
    setMemberBusy(true);
    try {
      const token = await getAuthToken();
      if (!token) throw new Error('Zaloguj się ponownie');
      const response = await fetch(`${API_URL}/api/clubs/${localClub.id}/members/${selectedMember.userId}/mute`, {
        method: selectedMember.isMuted ? 'DELETE' : 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: selectedMember.isMuted ? undefined : JSON.stringify({ durationMinutes: 60 }),
      });
      await parseResponse(response);
      await refreshClub(true);
      Toast.show({ type: 'success', text1: selectedMember.isMuted ? 'Członek odciszony' : 'Członek wyciszony na godzinę' });
    } catch (error) {
      Toast.show({ type: 'error', text1: 'Nie zmieniono wyciszenia', text2: error instanceof Error ? error.message : undefined });
    } finally {
      setMemberBusy(false);
    }
  };

  const kickMember = () => {
    if (!localClub || !selectedMember || !canKick || memberBusy) return;
    Alert.alert('Wyrzuć członka', `Czy na pewno chcesz wyrzucić ${selectedMember.username}?`, [
      { text: 'Anuluj', style: 'cancel' },
      {
        text: 'Wyrzuć', style: 'destructive', onPress: async () => {
          setMemberBusy(true);
          try {
            const token = await getAuthToken();
            if (!token) throw new Error('Zaloguj się ponownie');
            const response = await fetch(`${API_URL}/api/clubs/${localClub.id}/members/${selectedMember.userId}/kick`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
              body: JSON.stringify({ reason: 'Moderacja klubu' }),
            });
            await parseResponse(response);
            setSelectedMemberId(null);
            await refreshClub(true);
            Toast.show({ type: 'success', text1: `${selectedMember.username} usunięty z klubu` });
          } catch (error) {
            Toast.show({ type: 'error', text1: 'Nie wyrzucono członka', text2: error instanceof Error ? error.message : undefined });
          } finally {
            setMemberBusy(false);
          }
        },
      },
    ]);
  };

  const sendInvite = async () => {
    if (!localClub || !canManage || !inviteUsername.trim() || inviteBusy) return;
    setInviteBusy(true);
    try {
      const token = await getAuthToken();
      if (!token) throw new Error('Zaloguj się ponownie');
      const username = inviteUsername.trim();
      const response = await fetch(`${API_URL}/api/clubs/${localClub.id}/invites`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ username }),
      });
      await parseResponse(response);
      setInviteUsername('');
      await loadInvites();
      Toast.show({ type: 'success', text1: `Zaproszono ${username}` });
    } catch (error) {
      Toast.show({ type: 'error', text1: 'Nie wysłano zaproszenia', text2: error instanceof Error ? error.message : undefined });
    } finally {
      setInviteBusy(false);
    }
  };

  const cancelInvite = async (inviteId: number) => {
    if (!localClub || !canManage) return;
    try {
      const token = await getAuthToken();
      if (!token) throw new Error('Zaloguj się ponownie');
      const response = await fetch(`${API_URL}/api/clubs/${localClub.id}/invites/${inviteId}`, {
        method: 'DELETE', headers: { Authorization: `Bearer ${token}` },
      });
      await parseResponse(response);
      setInvites((current) => current.filter((invite) => invite.id !== inviteId));
    } catch (error) {
      Toast.show({ type: 'error', text1: 'Nie anulowano zaproszenia', text2: error instanceof Error ? error.message : undefined });
    }
  };

  if (!visible || !club) return null;

  const renderOverview = () => (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <PanelHeader icon="shield-crown" title="Profil klubu" subtitle="To widzą członkowie na liście i w nagłówku klubu." />
      {!canManage && <ReadOnlyNotice />}
      <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border2 }]}>
        <TouchableOpacity
          style={styles.avatarRow}
          onPress={async () => {
            if (!canManage || pickingAvatar) return;
            setPickingAvatar(true);
            try {
              const uri = await clubAvatarFromLibrary();
              if (uri) setAvatarUri(uri);
            } finally {
              setPickingAvatar(false);
            }
          }}
          disabled={!canManage}
          accessibilityRole="button"
          accessibilityLabel="Zmień logo klubu"
        >
          <View style={[styles.avatar, { backgroundColor: theme.surface2, borderColor: theme.border2 }]}>
            {avatarUri || localClub?.avatarUrl ? (
              <Image source={{ uri: avatarUri ?? localClub?.avatarUrl ?? '' }} style={StyleSheet.absoluteFillObject} contentFit="cover" />
            ) : (
              <MaterialCommunityIcons name="shield-crown-outline" size={30} color={theme.primary} />
            )}
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.fieldTitle, { color: theme.text }]}>Logo klubu</Text>
            <Text style={[styles.fieldHint, { color: theme.textDim }]}>Kwadratowe zdjęcie, najlepiej minimum 512 × 512 px.</Text>
          </View>
          {pickingAvatar ? <ActivityIndicator color={theme.primary} /> : <MaterialIcons name="photo-camera" size={20} color={theme.textDim} />}
        </TouchableOpacity>

        <FieldLabel text="NAZWA KLUBU" color={theme.textDim} />
        <TextInput
          value={name}
          onChangeText={setName}
          editable={canManage}
          maxLength={40}
          style={[styles.input, { color: theme.text, backgroundColor: theme.bg, borderColor: theme.border }]}
          placeholder="Nazwa klubu"
          placeholderTextColor={theme.textDim}
        />
        <FieldLabel text="OPIS" color={theme.textDim} />
        <TextInput
          value={description}
          onChangeText={setDescription}
          editable={canManage}
          maxLength={200}
          multiline
          style={[styles.input, styles.multiline, { color: theme.text, backgroundColor: theme.bg, borderColor: theme.border }]}
          placeholder="O czym jest ten klub?"
          placeholderTextColor={theme.textDim}
        />
        <TouchableOpacity
          onPress={() => canManage && setIsPrivate((value) => !value)}
          activeOpacity={0.8}
          style={[styles.settingRow, { borderColor: theme.border }]}
          disabled={!canManage}
        >
          <View style={[styles.settingIcon, { backgroundColor: isPrivate ? `${theme.primary}20` : theme.surface2 }]}>
            <MaterialIcons name={isPrivate ? 'lock' : 'public'} size={19} color={isPrivate ? theme.primary : theme.textDim} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.fieldTitle, { color: theme.text }]}>Klub prywatny</Text>
            <Text style={[styles.fieldHint, { color: theme.textDim }]}>Nowe osoby dołączają wyłącznie przez zaproszenie.</Text>
          </View>
          <Switch value={isPrivate} onValueChange={setIsPrivate} disabled={!canManage} trackColor={{ false: theme.border3, true: theme.primary }} />
        </TouchableOpacity>
      </View>
      {canManage && <PrimaryButton label="Zapisz profil klubu" loading={saving} onPress={saveOverview} />}
    </ScrollView>
  );

  const renderChannels = () => (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <PanelHeader icon="view-list" title="Kategorie i kanały" subtitle="Ułóż przestrzeń klubu tak, jak serwer Discorda." />
      {!canManage && <ReadOnlyNotice />}

      {canManage && (
        <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border2 }]}>
          <FieldLabel text="NOWA KATEGORIA" color={theme.textDim} />
          <View style={styles.inlineForm}>
            <TextInput
              value={newCategoryName}
              onChangeText={setNewCategoryName}
              onSubmitEditing={addCategory}
              returnKeyType="done"
              style={[styles.input, styles.inlineInput, { color: theme.text, backgroundColor: theme.bg, borderColor: theme.border }]}
              placeholder="np. Informacje"
              placeholderTextColor={theme.textDim}
            />
            <SquareButton icon="add" onPress={addCategory} />
          </View>
          <FieldLabel text="NOWY KANAŁ TEKSTOWY" color={theme.textDim} />
          <View style={[styles.categoryPicker, { borderColor: theme.border }]}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
              {[{ key: null, name: 'Bez kategorii' }, ...categories].map((category) => {
                const active = newChannelCategoryKey === category.key;
                return (
                  <TouchableOpacity
                    key={category.key ?? 'none'}
                    onPress={() => setNewChannelCategoryKey(category.key)}
                    style={[styles.pill, { borderColor: active ? theme.primary : theme.border, backgroundColor: active ? `${theme.primary}18` : theme.surface2 }]}
                  >
                    <Text style={[styles.pillText, { color: active ? theme.primary : theme.textDim }]}>{category.name}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
          <View style={styles.inlineForm}>
            <View style={[styles.channelInputWrap, { backgroundColor: theme.bg, borderColor: theme.border }]}>
              <Text style={{ color: theme.textDim, fontSize: 18 }}>#</Text>
              <TextInput
                value={newChannelName}
                onChangeText={setNewChannelName}
                onSubmitEditing={addChannel}
                returnKeyType="done"
                autoCapitalize="none"
                style={[styles.channelInput, { color: theme.text }]}
                placeholder="nazwa-kanału"
                placeholderTextColor={theme.textDim}
              />
            </View>
            <SquareButton icon="add" onPress={addChannel} />
          </View>
        </View>
      )}

      {channelSections.map((section) => {
        const categoryIndex = categories.findIndex((category) => category.key === section.key);
        const category = categories[categoryIndex];
        return (
          <View key={section.key} style={[styles.channelSection, { backgroundColor: theme.surface, borderColor: theme.border2 }]}>
            <View style={styles.categoryHeader}>
              {category ? (
                <TextInput
                  value={category.name}
                  editable={canManage}
                  onChangeText={(value) => {
                    setCategories((current) => current.map((item) => item.key === category.key ? { ...item, name: value } : item));
                    markStructureDirty();
                  }}
                  style={[styles.categoryTitleInput, { color: theme.text }]}
                />
              ) : (
                <Text style={[styles.categoryTitleInput, { color: theme.textDim }]}>{section.name.toUpperCase()}</Text>
              )}
              {canManage && category && (
                <View style={styles.rowActions}>
                  <MiniIconButton icon="keyboard-arrow-up" disabled={categoryIndex === 0} onPress={() => { setCategories((current) => moveDraftItem(current, categoryIndex, -1)); markStructureDirty(); }} />
                  <MiniIconButton icon="keyboard-arrow-down" disabled={categoryIndex === categories.length - 1} onPress={() => { setCategories((current) => moveDraftItem(current, categoryIndex, 1)); markStructureDirty(); }} />
                  <MiniIconButton
                    icon="delete-outline"
                    danger
                    onPress={() => Alert.alert('Usuń kategorię', 'Kanały z tej kategorii trafią do sekcji „Bez kategorii”.', [
                      { text: 'Anuluj', style: 'cancel' },
                      { text: 'Usuń', style: 'destructive', onPress: () => {
                        setCategories((current) => current.filter((item) => item.key !== category.key));
                        setDraftChannels((current) => current.map((channel) => channel.categoryKey === category.key ? { ...channel, categoryKey: null } : channel));
                        if (newChannelCategoryKey === category.key) setNewChannelCategoryKey(null);
                        markStructureDirty();
                      } },
                    ])}
                  />
                </View>
              )}
            </View>
            {section.channels.length === 0 ? (
              <Text style={[styles.emptyLine, { color: theme.textDim }]}>Brak kanałów w tej kategorii</Text>
            ) : section.channels.map((channel) => {
              const channelIndex = draftChannels.findIndex((item) => item.key === channel.key);
              const protectedChannel = channel.isDefaultGeneral || channel.id === localClub?.joinNotificationChannelId;
              return (
                <View key={channel.key} style={[styles.channelRow, { borderTopColor: theme.border }]}>
                  <MaterialCommunityIcons name="pound" size={18} color={channel.isReadOnly ? theme.gold : theme.textDim} />
                  <View style={{ flex: 1 }}>
                    <TextInput
                      value={channel.name}
                      editable={canManage}
                      autoCapitalize="none"
                      onChangeText={(value) => {
                        setDraftChannels((current) => current.map((item) => item.key === channel.key ? { ...item, name: slugifyChannelName(value) } : item));
                        markStructureDirty();
                      }}
                      style={[styles.channelNameInput, { color: theme.text }]}
                    />
                    <View style={styles.channelMeta}>
                      {channel.isDefaultGeneral && <MetaBadge label="DOMYŚLNY" color={theme.primary} />}
                      {joinChannelKey === channel.key && <MetaBadge label="POWITANIA" color={theme.gold} />}
                      {channel.isReadOnly && <MetaBadge label="TYLKO ODCZYT" color="#ff922b" />}
                    </View>
                  </View>
                  {canManage && (
                    <View style={styles.rowActions}>
                      <MiniIconButton
                        icon={channel.isReadOnly ? 'lock' : 'lock-open'}
                        active={channel.isReadOnly}
                        onPress={() => { setDraftChannels((current) => current.map((item) => item.key === channel.key ? { ...item, isReadOnly: !item.isReadOnly } : item)); markStructureDirty(); }}
                      />
                      <MiniIconButton
                        icon="waving-hand"
                        active={joinChannelKey === channel.key}
                        onPress={() => { setJoinChannelKey(channel.key); markStructureDirty(); }}
                      />
                      <MiniIconButton icon="keyboard-arrow-up" disabled={channelIndex === 0} onPress={() => { setDraftChannels((current) => moveDraftItem(current, channelIndex, -1)); markStructureDirty(); }} />
                      <MiniIconButton icon="keyboard-arrow-down" disabled={channelIndex === draftChannels.length - 1} onPress={() => { setDraftChannels((current) => moveDraftItem(current, channelIndex, 1)); markStructureDirty(); }} />
                      <MiniIconButton
                        icon={protectedChannel ? 'lock-outline' : 'delete-outline'}
                        danger={!protectedChannel}
                        disabled={protectedChannel}
                        onPress={() => Alert.alert('Usuń kanał', `Usunąć #${channel.name}? Wiadomości z tego kanału zostaną skasowane.`, [
                          { text: 'Anuluj', style: 'cancel' },
                          { text: 'Usuń', style: 'destructive', onPress: () => {
                            setDraftChannels((current) => current.filter((item) => item.key !== channel.key).map((item, position) => ({ ...item, position })));
                            markStructureDirty();
                          } },
                        ])}
                      />
                    </View>
                  )}
                </View>
              );
            })}
          </View>
        );
      })}
      {canManage && (
        <PrimaryButton label={structureDirty ? 'Zapisz układ kanałów' : 'Układ zapisany'} loading={saving} disabled={!structureDirty} onPress={saveStructure} />
      )}
    </ScrollView>
  );

  const renderRoles = () => (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <PanelHeader icon="shield-account" title="Role i uprawnienia" subtitle="Jedna osoba może mieć kilka ról; uprawnienia łączą się." />
      {!isOwner && <ReadOnlyNotice text="Tylko właściciel klubu może tworzyć i przypisywać role." />}
      {isOwner && !rankDraft && <PrimaryButton label="Utwórz nową rolę" icon="add" onPress={startNewRank} compact />}

      {rankDraft && isOwner && (
        <View style={[styles.card, { backgroundColor: theme.surface, borderColor: rankDraft.color }]}>
          <View style={styles.formHeader}>
            <View style={[styles.roleDot, { backgroundColor: rankDraft.color }]} />
            <Text style={[styles.cardTitle, { color: theme.text }]}>{rankDraft.id ? 'Edytuj rolę' : 'Nowa rola'}</Text>
            <TouchableOpacity onPress={() => setRankDraft(null)} style={styles.closeButton}><MaterialIcons name="close" size={18} color={theme.textDim} /></TouchableOpacity>
          </View>
          <FieldLabel text="NAZWA ROLI" color={theme.textDim} />
          <TextInput
            value={rankDraft.name}
            onChangeText={(value) => setRankDraft((current) => current ? { ...current, name: value } : current)}
            maxLength={30}
            style={[styles.input, { color: theme.text, backgroundColor: theme.bg, borderColor: theme.border }]}
            placeholder="np. Moderator"
            placeholderTextColor={theme.textDim}
          />
          <FieldLabel text="KOLOR" color={theme.textDim} />
          <View style={styles.colorGrid}>
            {CLUB_RANK_COLORS.map((color) => (
              <TouchableOpacity
                key={color}
                onPress={() => setRankDraft((current) => current ? { ...current, color } : current)}
                style={[styles.colorButton, { backgroundColor: color }, rankDraft.color === color && styles.colorButtonActive]}
                accessibilityLabel={`Kolor ${color}`}
              >
                {rankDraft.color === color && <MaterialIcons name="check" size={16} color="#fff" />}
              </TouchableOpacity>
            ))}
          </View>
          <FieldLabel text="PRIORYTET" color={theme.textDim} />
          <Text style={[styles.fieldHint, { color: theme.textDim, marginBottom: 8 }]}>Wyższa liczba ustawia rolę wyżej na liście członków.</Text>
          <TextInput
            value={rankDraft.priority}
            onChangeText={(value) => setRankDraft((current) => current ? { ...current, priority: value.replace(/[^0-9-]/g, '') } : current)}
            keyboardType="number-pad"
            style={[styles.input, { color: theme.text, backgroundColor: theme.bg, borderColor: theme.border }]}
          />
          <FieldLabel text="UPRAWNIENIA" color={theme.textDim} />
          {CLUB_PERMISSION_DEFINITIONS.map((permission) => {
            const enabled = rankDraft.permissions[permission.key];
            return (
              <TouchableOpacity
                key={permission.key}
                onPress={() => setRankDraft((current) => current ? {
                  ...current,
                  permissions: { ...current.permissions, [permission.key]: !enabled },
                } : current)}
                style={[styles.permissionRow, { borderColor: theme.border }]}
              >
                <View style={[styles.checkbox, { borderColor: enabled ? rankDraft.color : theme.border3, backgroundColor: enabled ? rankDraft.color : 'transparent' }]}>
                  {enabled && <MaterialIcons name="check" size={14} color="#fff" />}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.permissionTitle, { color: theme.text }]}>{permission.label}</Text>
                  <Text style={[styles.permissionDescription, { color: theme.textDim }]}>{permission.description}</Text>
                </View>
              </TouchableOpacity>
            );
          })}
          <PrimaryButton label="Zapisz rolę" loading={saving} onPress={saveRank} />
        </View>
      )}

      <FieldLabel text={`ROLE · ${ranks.length}`} color={theme.textDim} />
      {ranks.length === 0 ? (
        <EmptyState icon="shield-outline" title="Brak własnych ról" subtitle="Utwórz pierwszą rolę i wybierz jej uprawnienia." />
      ) : ranks.map((rank) => {
        const enabledPermissions = CLUB_PERMISSION_DEFINITIONS.filter((permission) => rank[permission.key]).length;
        return (
          <TouchableOpacity
            key={rank.id}
            onPress={() => isOwner && editRank(rank)}
            activeOpacity={isOwner ? 0.8 : 1}
            style={[styles.roleRow, { backgroundColor: theme.surface, borderColor: `${rank.color}66` }]}
          >
            <View style={[styles.roleDot, { backgroundColor: rank.color }]} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.roleName, { color: theme.text }]}>{rank.name}</Text>
              <Text style={[styles.roleMeta, { color: theme.textDim }]}>Priorytet {rank.priority ?? 0} · {enabledPermissions} uprawnień</Text>
            </View>
            {isOwner && (
              <>
                <MiniIconButton icon="edit" onPress={() => editRank(rank)} />
                <MiniIconButton icon="delete-outline" danger onPress={() => deleteRank(rank)} />
              </>
            )}
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );

  const renderMembers = () => (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <PanelHeader icon="account-group" title={`Członkowie · ${members.length}`} subtitle="Role, wyciszenia, usuwanie i zaproszenia w jednym miejscu." />

      {canManage && (
        <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border2 }]}>
          <View style={styles.formHeader}>
            <MaterialIcons name="person-add" size={20} color={theme.primary} />
            <Text style={[styles.cardTitle, { color: theme.text }]}>Zaproś osobę</Text>
            <Text style={[styles.counter, { color: theme.textDim, backgroundColor: theme.surface2 }]}>{invites.length} oczekuje</Text>
          </View>
          <View style={styles.inlineForm}>
            <TextInput
              value={inviteUsername}
              onChangeText={setInviteUsername}
              onSubmitEditing={sendInvite}
              returnKeyType="send"
              autoCapitalize="none"
              style={[styles.input, styles.inlineInput, { color: theme.text, backgroundColor: theme.bg, borderColor: theme.border }]}
              placeholder="Dokładna nazwa użytkownika"
              placeholderTextColor={theme.textDim}
            />
            <SquareButton icon="send" onPress={sendInvite} loading={inviteBusy} />
          </View>
          {invitesLoading ? <ActivityIndicator color={theme.primary} style={{ marginTop: 8 }} /> : invites.map((invite) => (
            <View key={invite.id} style={[styles.inviteRow, { borderTopColor: theme.border }]}>
              <UAv uri={invite.invited.avatarUrl} name={invite.invited.username} size={30} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.memberName, { color: theme.text }]}>{invite.invited.username}</Text>
                <Text style={[styles.memberMeta, { color: theme.textDim }]}>Zaproszenie oczekuje</Text>
              </View>
              <MiniIconButton icon="close" danger onPress={() => void cancelInvite(invite.id)} />
            </View>
          ))}
        </View>
      )}

      <View style={[styles.searchBox, { backgroundColor: theme.surface, borderColor: theme.border2 }]}>
        <MaterialIcons name="search" size={19} color={theme.textDim} />
        <TextInput
          value={memberSearch}
          onChangeText={setMemberSearch}
          style={[styles.searchInput, { color: theme.text }]}
          placeholder="Szukaj osoby lub roli"
          placeholderTextColor={theme.textDim}
        />
        {!!memberSearch && <TouchableOpacity onPress={() => setMemberSearch('')}><MaterialIcons name="close" size={17} color={theme.textDim} /></TouchableOpacity>}
      </View>

      {selectedMember && (
        <View style={[styles.memberEditor, { backgroundColor: theme.surface, borderColor: theme.primary }]}>
          <View style={styles.formHeader}>
            <UAv uri={selectedMember.avatarUrl} name={selectedMember.username} size={42} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.memberEditorName, { color: theme.text }]}>{selectedMember.username}</Text>
              <Text style={[styles.memberMeta, { color: selectedMember.isMuted ? '#ff922b' : theme.textDim }]}>
                {selectedMember.role === 'owner' ? 'Właściciel klubu' : selectedMember.isMuted ? 'Wyciszony' : 'Członek klubu'}
              </Text>
            </View>
            <TouchableOpacity onPress={() => setSelectedMemberId(null)} style={styles.closeButton}><MaterialIcons name="close" size={18} color={theme.textDim} /></TouchableOpacity>
          </View>
          {selectedMember.role !== 'owner' && isOwner && (
            <>
              <FieldLabel text="PRZYPISANE ROLE" color={theme.textDim} />
              {ranks.length === 0 ? (
                <Text style={[styles.emptyLine, { color: theme.textDim }]}>Najpierw utwórz rolę w zakładce „Role”.</Text>
              ) : ranks.map((rank) => {
                const active = selectedRankIds.includes(rank.id);
                return (
                  <TouchableOpacity
                    key={rank.id}
                    onPress={() => setSelectedRankIds((current) => active ? current.filter((id) => id !== rank.id) : [...current, rank.id])}
                    style={[styles.memberRoleChoice, { borderColor: active ? rank.color : theme.border, backgroundColor: active ? `${rank.color}15` : theme.bg }]}
                  >
                    <View style={[styles.roleDot, { backgroundColor: rank.color }]} />
                    <Text style={[styles.permissionTitle, { flex: 1, color: theme.text }]}>{rank.name}</Text>
                    {active && <MaterialIcons name="check" size={17} color={rank.color} />}
                  </TouchableOpacity>
                );
              })}
              <PrimaryButton label="Zapisz role członka" loading={memberBusy} onPress={saveMemberRanks} compact />
            </>
          )}
          {selectedMember.role !== 'owner' && selectedMember.userId !== currentUserId && (canMute || canKick) && (
            <View style={styles.moderationRow}>
              {canMute && (
                <TouchableOpacity
                  onPress={toggleMemberMute}
                  disabled={memberBusy}
                  style={[styles.secondaryAction, { borderColor: '#ff922b66', backgroundColor: '#ff922b12' }]}
                >
                  <MaterialIcons name={selectedMember.isMuted ? 'volume-up' : 'volume-off'} size={17} color="#ff922b" />
                  <Text style={[styles.actionText, { color: '#ff922b' }]}>{selectedMember.isMuted ? 'Odcisz' : 'Wycisz 1 h'}</Text>
                </TouchableOpacity>
              )}
              {canKick && (
                <TouchableOpacity
                  onPress={kickMember}
                  disabled={memberBusy}
                  style={[styles.secondaryAction, { borderColor: '#e3383566', backgroundColor: '#e3383512' }]}
                >
                  <MaterialIcons name="person-remove" size={17} color="#e33835" />
                  <Text style={[styles.actionText, { color: '#e33835' }]}>Wyrzuć</Text>
                </TouchableOpacity>
              )}
            </View>
          )}
        </View>
      )}

      <FieldLabel text={`LISTA CZŁONKÓW · ${visibleMembers.length}`} color={theme.textDim} />
      {visibleMembers.map((member) => {
        const memberRanks = getMemberRanks(member);
        const canOpen = member.role !== 'owner' && (isOwner || canMute || canKick);
        return (
          <TouchableOpacity
            key={member.id}
            onPress={() => canOpen && openMember(member)}
            activeOpacity={canOpen ? 0.8 : 1}
            style={[styles.memberRow, { backgroundColor: theme.surface, borderColor: selectedMemberId === member.id ? theme.primary : theme.border2 }]}
          >
            <UAv uri={member.avatarUrl} name={member.username} size={38} />
            <View style={{ flex: 1 }}>
              <View style={styles.memberTitleRow}>
                <Text style={[styles.memberName, { color: theme.text }]}>{member.username}</Text>
                {member.isMuted && <MaterialIcons name="volume-off" size={13} color="#ff922b" />}
              </View>
              <View style={styles.badgeWrap}>
                {member.role === 'owner' && <MetaBadge label="WŁAŚCICIEL" color={theme.primary} />}
                {memberRanks.map((rank) => <MetaBadge key={rank.id} label={rank.name.toUpperCase()} color={rank.color} />)}
                {member.role !== 'owner' && memberRanks.length === 0 && <Text style={[styles.memberMeta, { color: theme.textDim }]}>Bez roli</Text>}
              </View>
            </View>
            {canOpen && <MaterialIcons name="chevron-right" size={20} color={theme.textDim} />}
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={closeManager}
      statusBarTranslucent={false}
    >
      <SafeAreaView style={[styles.screen, { backgroundColor: theme.bg }]} edges={['top', 'bottom']}>
        <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={[styles.header, { backgroundColor: theme.surface, borderBottomColor: theme.border }]}>
            <TouchableOpacity
              onPress={closeManager}
              style={[styles.headerButton, { backgroundColor: theme.surface2, borderColor: theme.border2 }]}
              accessibilityRole="button"
              accessibilityLabel="Zamknij ustawienia klubu"
            >
              <MaterialIcons name="close" size={20} color={theme.text} />
            </TouchableOpacity>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[styles.eyebrow, { color: theme.primary }]}>USTAWIENIA KLUBU</Text>
              <Text style={[styles.headerTitle, { color: theme.text }]} numberOfLines={1}>{localClub?.name ?? club.name}</Text>
            </View>
            <View style={[styles.statusPill, { backgroundColor: changed ? `${theme.primary}18` : theme.surface2, borderColor: changed ? `${theme.primary}55` : theme.border2 }]}>
              <View style={[styles.statusDot, { backgroundColor: changed ? theme.primary : '#4de926' }]} />
              <Text style={[styles.statusText, { color: changed ? theme.primary : theme.textDim }]}>{changed ? 'ZMIENIONO' : 'AKTUALNE'}</Text>
            </View>
          </View>

          <View style={[styles.tabBar, { backgroundColor: theme.surface, borderBottomColor: theme.border }]}>
            {TABS.map((item) => {
              const active = tab === item.key;
              return (
                <TouchableOpacity
                  key={item.key}
                  onPress={() => { setTab(item.key); setSelectedMemberId(null); }}
                  style={[styles.tab, active && { backgroundColor: `${theme.primary}16` }]}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: active }}
                >
                  <MaterialIcons name={item.icon} size={18} color={active ? theme.primary : theme.textDim} />
                  <Text style={[styles.tabLabel, { color: active ? theme.primary : theme.textDim }]}>{item.label}</Text>
                  {active && <View style={[styles.tabIndicator, { backgroundColor: theme.primary }]} />}
                </TouchableOpacity>
              );
            })}
          </View>

          <View style={styles.body}>
            {loading && !localClub ? (
              <View style={styles.loading}><ActivityIndicator color={theme.primary} size="large" /></View>
            ) : tab === 'overview' ? renderOverview() : tab === 'channels' ? renderChannels() : tab === 'roles' ? renderRoles() : renderMembers()}
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

function PanelHeader({ icon, title, subtitle }: { icon: React.ComponentProps<typeof MaterialCommunityIcons>['name']; title: string; subtitle: string }) {
  const { theme } = useTheme();
  return (
    <View style={styles.panelHeader}>
      <View style={[styles.panelIcon, { backgroundColor: `${theme.primary}18`, borderColor: `${theme.primary}45` }]}>
        <MaterialCommunityIcons name={icon} size={22} color={theme.primary} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.panelTitle, { color: theme.text }]}>{title}</Text>
        <Text style={[styles.panelSubtitle, { color: theme.textDim }]}>{subtitle}</Text>
      </View>
    </View>
  );
}

function ReadOnlyNotice({ text = 'Masz dostęp tylko do podglądu tych ustawień.' }: { text?: string }) {
  const { theme } = useTheme();
  return (
    <View style={[styles.notice, { backgroundColor: `${theme.gold}10`, borderColor: `${theme.gold}55` }]}>
      <MaterialIcons name="lock-outline" size={17} color={theme.gold} />
      <Text style={[styles.noticeText, { color: theme.textDim }]}>{text}</Text>
    </View>
  );
}

function FieldLabel({ text, color }: { text: string; color: string }) {
  return <Text style={[styles.fieldLabel, { color }]}>{text}</Text>;
}

function PrimaryButton({
  label, onPress, loading = false, disabled = false, compact = false, icon = 'check',
}: {
  label: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  compact?: boolean;
  icon?: React.ComponentProps<typeof MaterialIcons>['name'];
}) {
  const { theme } = useTheme();
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled || loading}
      activeOpacity={0.85}
      style={[styles.primaryButton, compact && styles.primaryButtonCompact, { backgroundColor: theme.primary }, (disabled || loading) && { opacity: 0.45 }]}
    >
      {loading ? <ActivityIndicator size="small" color={theme.onPrimary} /> : <MaterialIcons name={icon} size={18} color={theme.onPrimary} />}
      <Text style={[styles.primaryButtonText, { color: theme.onPrimary }]}>{label}</Text>
    </TouchableOpacity>
  );
}

function SquareButton({ icon, onPress, loading = false }: { icon: React.ComponentProps<typeof MaterialIcons>['name']; onPress: () => void; loading?: boolean }) {
  const { theme } = useTheme();
  return (
    <TouchableOpacity onPress={onPress} disabled={loading} style={[styles.squareButton, { backgroundColor: theme.primary }]}>
      {loading ? <ActivityIndicator color={theme.onPrimary} size="small" /> : <MaterialIcons name={icon} size={19} color={theme.onPrimary} />}
    </TouchableOpacity>
  );
}

function MiniIconButton({
  icon, onPress, danger = false, disabled = false, active = false,
}: {
  icon: React.ComponentProps<typeof MaterialIcons>['name'];
  onPress: () => void;
  danger?: boolean;
  disabled?: boolean;
  active?: boolean;
}) {
  const { theme } = useTheme();
  const color = danger ? '#e33835' : active ? theme.primary : theme.textDim;
  return (
    <TouchableOpacity onPress={onPress} disabled={disabled} style={[styles.miniIconButton, disabled && { opacity: 0.3 }]} hitSlop={6}>
      <MaterialIcons name={icon} size={18} color={color} />
    </TouchableOpacity>
  );
}

function MetaBadge({ label, color }: { label: string; color: string }) {
  return (
    <View style={[styles.metaBadge, { borderColor: `${color}66`, backgroundColor: `${color}15` }]}>
      <Text style={[styles.metaBadgeText, { color }]} numberOfLines={1}>{label}</Text>
    </View>
  );
}

function EmptyState({ icon, title, subtitle }: { icon: React.ComponentProps<typeof MaterialCommunityIcons>['name']; title: string; subtitle: string }) {
  const { theme } = useTheme();
  return (
    <View style={[styles.emptyState, { backgroundColor: theme.surface, borderColor: theme.border2 }]}>
      <MaterialCommunityIcons name={icon} size={36} color={theme.border3} />
      <Text style={[styles.emptyTitle, { color: theme.text }]}>{title}</Text>
      <Text style={[styles.emptySubtitle, { color: theme.textDim }]}>{subtitle}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { minHeight: 70, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1 },
  headerButton: { width: 40, height: 40, borderRadius: 13, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  eyebrow: { fontFamily: 'Orbitron', fontSize: 7, fontWeight: '800', letterSpacing: 1.8, marginBottom: 3 },
  headerTitle: { fontFamily: 'Orbitron', fontSize: 14, fontWeight: '900' },
  statusPill: { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 999, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 5 },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusText: { fontFamily: 'Orbitron', fontSize: 6, fontWeight: '800' },
  tabBar: { height: 62, flexDirection: 'row', borderBottomWidth: 1, paddingHorizontal: 6 },
  tab: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 3, borderRadius: 10, marginVertical: 6, position: 'relative' },
  tabLabel: { fontFamily: 'Orbitron', fontSize: 7, fontWeight: '700' },
  tabIndicator: { position: 'absolute', height: 2, left: 13, right: 13, bottom: -6, borderRadius: 2 },
  body: { flex: 1 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: 14, paddingBottom: 40, gap: 12 },
  panelHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 2 },
  panelIcon: { width: 46, height: 46, borderRadius: 15, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  panelTitle: { fontFamily: 'Orbitron', fontSize: 14, fontWeight: '900', marginBottom: 4 },
  panelSubtitle: { fontSize: 11, lineHeight: 16 },
  card: { borderRadius: 18, borderWidth: 1, padding: 14 },
  cardTitle: { flex: 1, fontFamily: 'Orbitron', fontSize: 11, fontWeight: '800' },
  formHeader: { flexDirection: 'row', alignItems: 'center', gap: 9, marginBottom: 12 },
  closeButton: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center' },
  avatarRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 18 },
  avatar: { width: 68, height: 68, borderRadius: 19, overflow: 'hidden', borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  fieldLabel: { fontFamily: 'Orbitron', fontSize: 7, fontWeight: '800', letterSpacing: 1.4, marginBottom: 7, marginTop: 2 },
  fieldTitle: { fontSize: 13, fontWeight: '700', marginBottom: 3 },
  fieldHint: { fontSize: 10, lineHeight: 14 },
  input: { minHeight: 46, borderRadius: 12, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10, fontSize: 13, marginBottom: 14 },
  multiline: { minHeight: 92, textAlignVertical: 'top' },
  settingRow: { flexDirection: 'row', alignItems: 'center', gap: 11, borderTopWidth: 1, paddingTop: 14 },
  settingIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  notice: { flexDirection: 'row', alignItems: 'center', gap: 9, borderRadius: 12, borderWidth: 1, padding: 11 },
  noticeText: { flex: 1, fontSize: 11, lineHeight: 16 },
  primaryButton: { minHeight: 48, borderRadius: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 16 },
  primaryButtonCompact: { minHeight: 42, alignSelf: 'flex-start' },
  primaryButtonText: { fontFamily: 'Orbitron', fontSize: 9, fontWeight: '900', letterSpacing: 0.5 },
  inlineForm: { flexDirection: 'row', alignItems: 'stretch', gap: 8 },
  inlineInput: { flex: 1, marginBottom: 12 },
  squareButton: { width: 46, height: 46, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  categoryPicker: { borderTopWidth: 1, paddingTop: 9, paddingBottom: 9, marginBottom: 7 },
  pill: { borderRadius: 999, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 6 },
  pillText: { fontSize: 10, fontWeight: '600' },
  channelInputWrap: { flex: 1, height: 46, flexDirection: 'row', alignItems: 'center', gap: 7, borderRadius: 12, borderWidth: 1, paddingHorizontal: 12 },
  channelInput: { flex: 1, paddingVertical: 9, fontSize: 13 },
  channelSection: { borderRadius: 16, borderWidth: 1, overflow: 'hidden' },
  categoryHeader: { minHeight: 46, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 6 },
  categoryTitleInput: { flex: 1, fontFamily: 'Orbitron', fontSize: 9, fontWeight: '900', letterSpacing: 1, paddingVertical: 5 },
  rowActions: { flexDirection: 'row', alignItems: 'center' },
  miniIconButton: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center' },
  channelRow: { minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: 8, borderTopWidth: 1, paddingHorizontal: 11, paddingVertical: 7 },
  channelNameInput: { fontSize: 13, fontWeight: '600', paddingVertical: 2 },
  channelMeta: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 4, marginTop: 3 },
  metaBadge: { maxWidth: 130, borderRadius: 999, borderWidth: 1, paddingHorizontal: 6, paddingVertical: 2 },
  metaBadgeText: { fontFamily: 'Orbitron', fontSize: 6, fontWeight: '800' },
  emptyLine: { fontSize: 11, fontStyle: 'italic', paddingHorizontal: 12, paddingBottom: 12 },
  roleDot: { width: 12, height: 12, borderRadius: 6 },
  colorGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 9, marginBottom: 16 },
  colorButton: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  colorButtonActive: { borderWidth: 3, borderColor: '#fff' },
  permissionRow: { flexDirection: 'row', alignItems: 'center', gap: 10, borderTopWidth: 1, paddingVertical: 11 },
  checkbox: { width: 23, height: 23, borderRadius: 7, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  permissionTitle: { fontSize: 12, fontWeight: '700', marginBottom: 2 },
  permissionDescription: { fontSize: 9, lineHeight: 13 },
  roleRow: { minHeight: 62, flexDirection: 'row', alignItems: 'center', gap: 11, borderRadius: 14, borderWidth: 1, padding: 12 },
  roleName: { fontSize: 13, fontWeight: '700', marginBottom: 3 },
  roleMeta: { fontSize: 9 },
  emptyState: { alignItems: 'center', borderRadius: 16, borderWidth: 1, borderStyle: 'dashed', padding: 24 },
  emptyTitle: { fontFamily: 'Orbitron', fontSize: 10, fontWeight: '800', marginTop: 9, marginBottom: 5 },
  emptySubtitle: { fontSize: 10, textAlign: 'center', lineHeight: 15 },
  counter: { fontFamily: 'Orbitron', fontSize: 7, fontWeight: '800', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 5 },
  inviteRow: { flexDirection: 'row', alignItems: 'center', gap: 9, borderTopWidth: 1, paddingTop: 9, marginTop: 8 },
  searchBox: { height: 48, flexDirection: 'row', alignItems: 'center', gap: 9, borderRadius: 14, borderWidth: 1, paddingHorizontal: 12 },
  searchInput: { flex: 1, paddingVertical: 9, fontSize: 13 },
  memberEditor: { borderRadius: 18, borderWidth: 1, padding: 14 },
  memberEditorName: { fontSize: 15, fontWeight: '800', marginBottom: 4 },
  memberRoleChoice: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 9, borderRadius: 11, borderWidth: 1, paddingHorizontal: 11, marginBottom: 7 },
  moderationRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
  secondaryAction: { flex: 1, minHeight: 42, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderRadius: 11, borderWidth: 1 },
  actionText: { fontFamily: 'Orbitron', fontSize: 8, fontWeight: '800' },
  memberRow: { minHeight: 62, flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 14, borderWidth: 1, padding: 11 },
  memberTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  memberName: { fontSize: 13, fontWeight: '700' },
  memberMeta: { fontSize: 9 },
  badgeWrap: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 4, marginTop: 5 },
});
