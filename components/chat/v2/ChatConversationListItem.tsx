import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '../../../contexts/ThemeContext';
import { formatConversationTime } from './helpers';
import type { ConversationListData } from './types';
import { PremiumAvatar, PremiumName } from '../../user/PremiumIdentity';

type Props = {
  item: ConversationListData;
  onPress: () => void;
};

const AVATAR = 54;

export function ChatConversationListItem({ item, onPress }: Props) {
  const { theme } = useTheme();
  const identity = item.identity ?? { id: item.id, username: item.name, avatarUrl: item.avatarUrl };

  const lastText = item.lastMessage
    ? item.lastMessage.content?.trim() || (item.lastMessage.photos?.length ? '📷 Zdjęcie' : '')
    : 'Brak wiadomości';
  const lastPrefix = item.lastMessage?.isMe ? 'Ty: ' : '';

  return (
    <TouchableOpacity
      style={[styles.row, { backgroundColor: theme.bg }]}
      onPress={onPress}
      activeOpacity={0.72}
    >
      <View style={styles.avatarWrap}>
        <PremiumAvatar user={identity} size={AVATAR} />
        {!item.isGroup && item.online && (
          <View style={[styles.onlineDot, { backgroundColor: theme.online, borderColor: theme.bg }]} />
        )}
        {item.isGroup && (
          <View style={[styles.groupBadge, { backgroundColor: theme.primary, borderColor: theme.bg }]}>
            <MaterialCommunityIcons name="account-group" size={9} color="#fff" />
          </View>
        )}
      </View>

      <View style={styles.content}>
        <View style={styles.topRow}>
          <PremiumName user={identity} style={styles.name} />
          {item.lastMessage?.createdAt && (
            <Text style={[styles.time, { color: theme.textDim }]}>
              {formatConversationTime(item.lastMessage.createdAt)}
            </Text>
          )}
        </View>
        <View style={styles.bottomRow}>
          <Text style={[styles.preview, { color: theme.textDim }]} numberOfLines={1}>
            {lastPrefix}{lastText}
          </Text>
          {(item.unread ?? 0) > 0 && (
            <View style={[styles.badge, { backgroundColor: theme.primary }]}>
              <Text style={styles.badgeText}>
                {(item.unread ?? 0) > 99 ? '99+' : item.unread}
              </Text>
            </View>
          )}
        </View>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 13,
    gap: 14,
  },
  avatarWrap: { position: 'relative', width: AVATAR, height: AVATAR },
  avatar: { width: AVATAR, height: AVATAR, borderRadius: AVATAR / 2 },
  avatarFallback: {
    width: AVATAR,
    height: AVATAR,
    borderRadius: AVATAR / 2,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontFamily: 'Orbitron', fontSize: 16, fontWeight: '700' },
  onlineDot: {
    position: 'absolute',
    bottom: 2,
    right: 2,
    width: 13,
    height: 13,
    borderRadius: 7,
    borderWidth: 2,
  },
  groupBadge: {
    position: 'absolute',
    bottom: 1,
    right: 1,
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: { flex: 1, gap: 5 },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  name: { flex: 1, fontFamily: 'Orbitron', fontSize: 12, fontWeight: '700', letterSpacing: 0.5 },
  time: { fontSize: 10, flexShrink: 0 },
  bottomRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  preview: { flex: 1, fontSize: 12, lineHeight: 16 },
  badge: {
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    paddingHorizontal: 5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: '#fff', fontSize: 10, fontWeight: '700' },
});
