import React, { useMemo, useState } from 'react';
import {
  Modal, View, Text, TouchableOpacity, FlatList, Image, Pressable,
} from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../contexts/ThemeContext';
import { Club } from './types';

type Tab = 'owner' | 'member';

interface Props {
  visible: boolean;
  ownedClubs: Club[];
  memberClubs: Club[];
  onClose: () => void;
  onOpenClub: (club: Club) => void;
  onOpenChat: (clubId: number) => void;
}

function ClubRow({
  club,
  badge,
  theme,
  onOpenClub,
  onOpenChat,
}: {
  club: Club;
  badge: string;
  theme: ReturnType<typeof useTheme>['theme'];
  onOpenClub: (c: Club) => void;
  onOpenChat: (id: number) => void;
}) {
  return (
    <TouchableOpacity
      style={{
        flexDirection: 'row', alignItems: 'center', gap: 10,
        backgroundColor: theme.surface2, borderRadius: 13,
        padding: 11, borderWidth: 1, borderColor: theme.border2,
        marginBottom: 8,
      }}
      onPress={() => onOpenClub(club)}
      activeOpacity={0.85}
    >
      <View style={{
        width: 40, height: 40, borderRadius: 10, overflow: 'hidden',
        backgroundColor: '#e3383518', alignItems: 'center', justifyContent: 'center',
        borderWidth: 1, borderColor: '#e3383530',
      }}>
        {club.avatarUrl
          ? <Image source={{ uri: club.avatarUrl }} style={{ width: 40, height: 40 }} />
          : <MaterialCommunityIcons name="shield-crown-outline" size={18} color="#e33835" />}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ fontFamily: 'Orbitron', fontSize: 7, color: '#e33835', letterSpacing: 1.5, marginBottom: 2 }}>
          {badge}
        </Text>
        <Text style={{ fontFamily: 'Orbitron', fontSize: 12, color: theme.text, fontWeight: '700' }} numberOfLines={1}>
          {club.name}
        </Text>
        <Text style={{ fontFamily: 'Orbitron', fontSize: 7, color: theme.textDim, marginTop: 2 }}>
          {club.memberCount} członków
          {club.myRank ? ` · ${club.myRank.name.toUpperCase()}` : ''}
        </Text>
      </View>
      <TouchableOpacity
        style={{
          backgroundColor: theme.surface, borderRadius: 8,
          paddingHorizontal: 9, paddingVertical: 6,
          flexDirection: 'row', alignItems: 'center', gap: 3,
          borderWidth: 1, borderColor: theme.border2,
        }}
        onPress={(e) => {
          e.stopPropagation?.();
          onOpenChat(club.id);
        }}
      >
        <MaterialCommunityIcons name="chat" size={12} color={theme.textDim} />
        <Text style={{ fontFamily: 'Orbitron', fontSize: 7, color: theme.textDim }}>CZAT</Text>
      </TouchableOpacity>
      <Feather name="chevron-right" size={15} color={theme.textDim} />
    </TouchableOpacity>
  );
}

export function MyClubsModal({
  visible, ownedClubs, memberClubs, onClose, onOpenClub, onOpenChat,
}: Props) {
  const { theme } = useTheme();
  const [tab, setTab] = useState<Tab>('owner');

  const list = useMemo(
    () => (tab === 'owner' ? ownedClubs : memberClubs),
    [tab, ownedClubs, memberClubs],
  );

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: theme.overlay }} onPress={onClose} />
      <View style={{
        backgroundColor: theme.surface,
        borderTopLeftRadius: 22, borderTopRightRadius: 22,
        maxHeight: '82%', borderWidth: 1, borderColor: theme.border2,
        paddingBottom: 20,
      }}>
        <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: theme.border3, alignSelf: 'center', marginTop: 10 }} />

        <View style={{
          flexDirection: 'row', alignItems: 'center',
          paddingHorizontal: 16, paddingTop: 12, paddingBottom: 10,
          borderBottomWidth: 1, borderBottomColor: theme.border,
        }}>
          <MaterialCommunityIcons name="shield-account" size={20} color={theme.primary} />
          <Text style={{ flex: 1, marginLeft: 8, fontFamily: 'Orbitron', fontSize: 13, color: theme.text, letterSpacing: 1.5 }}>
            MOJE KLUBY
          </Text>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <MaterialIcons name="close" size={22} color={theme.textDim} />
          </TouchableOpacity>
        </View>

        <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 14, paddingTop: 12, paddingBottom: 8 }}>
          {([
            { key: 'owner' as Tab, label: 'WŁAŚCICIEL', count: ownedClubs.length },
            { key: 'member' as Tab, label: 'CZŁONEK', count: memberClubs.length },
          ]).map(({ key, label, count }) => {
            const active = tab === key;
            return (
              <TouchableOpacity
                key={key}
                onPress={() => setTab(key)}
                style={{
                  flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: 'center',
                  backgroundColor: active ? '#e33835' : theme.surface2,
                  borderWidth: 1,
                  borderColor: active ? '#e33835' : theme.border2,
                }}
              >
                <Text style={{
                  fontFamily: 'Orbitron', fontSize: 8, fontWeight: '700',
                  color: active ? '#fff' : theme.textDim,
                }}>
                  {label} ({count})
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <FlatList
          data={list}
          keyExtractor={(c) => String(c.id)}
          contentContainerStyle={{ paddingHorizontal: 14, paddingBottom: 12, flexGrow: 1 }}
          ListEmptyComponent={(
            <View style={{ alignItems: 'center', paddingVertical: 36, gap: 8 }}>
              <MaterialCommunityIcons name="shield-off-outline" size={40} color={theme.border3} />
              <Text style={{ fontFamily: 'Orbitron', fontSize: 9, color: theme.textDim, letterSpacing: 1 }}>
                {tab === 'owner' ? 'NIE ZAŁOŻYŁEŚ KLUBU' : 'NIE NALEŻYSZ DO ŻADNEGO KLUBU'}
              </Text>
            </View>
          )}
          renderItem={({ item }) => (
            <ClubRow
              club={item}
              badge={tab === 'owner' ? 'ZAŁOŻYCIEL' : 'CZŁONEK'}
              theme={theme}
              onOpenClub={onOpenClub}
              onOpenChat={onOpenChat}
            />
          )}
        />
      </View>
    </Modal>
  );
}
