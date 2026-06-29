import React, { type ReactNode } from 'react';
import { View, Text, Image, TouchableOpacity, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '../../../contexts/ThemeContext';
import type { ChatHeaderStatus } from './types';
import { VROOM_RED_BORDER } from './constants';

type Props = {
  title: string;
  avatarUrl?: string | null;
  avatarFallback?: string;
  showOnlineDot?: boolean;
  online?: boolean;
  status?: ChatHeaderStatus;
  onPressTitle?: () => void;
  onBack?: () => void;
  right?: ReactNode;
  breadcrumb?: string;
};

function StatusCapsule({ status }: { status: ChatHeaderStatus }) {
  const { theme } = useTheme();

  if (status.kind === 'custom') return <>{status.node}</>;

  if (status.kind === 'typing') {
    return (
      <View style={styles.statusRow}>
        <MaterialCommunityIcons name="dots-horizontal" size={14} color={theme.primary} />
        <Text style={[styles.statusText, { color: theme.primary, fontStyle: 'italic' }]}>{status.text}</Text>
      </View>
    );
  }

  const label =
    status.label ??
    (status.kind === 'online' ? 'ONLINE' : status.kind === 'offline' ? 'OFFLINE' : status.label);
  const color =
    status.kind === 'badge'
      ? (status.color ?? theme.primary)
      : status.kind === 'online'
        ? theme.online
        : theme.textDim;
  const dotColor = status.kind === 'online' ? theme.online : theme.textDim;

  return (
    <View style={[styles.capsule, { backgroundColor: theme.surface2, borderColor: theme.border }]}>
      {status.kind !== 'badge' && (
        <View style={[styles.dot, { backgroundColor: dotColor }]} />
      )}
      <Text style={[styles.capsuleText, { color }]}>{label}</Text>
    </View>
  );
}

export function ChatHeader({
  title,
  avatarUrl,
  avatarFallback = '??',
  showOnlineDot = false,
  online = false,
  status,
  onPressTitle,
  onBack,
  right,
  breadcrumb,
}: Props) {
  const { theme } = useTheme();

  const resolvedStatus: ChatHeaderStatus | null =
    status ??
    (showOnlineDot
      ? { kind: online ? 'online' : 'offline' }
      : null);

  const center = (
    <TouchableOpacity
      style={styles.center}
      onPress={onPressTitle}
      activeOpacity={onPressTitle ? 0.75 : 1}
      disabled={!onPressTitle}
    >
      <View style={styles.avatarWrap}>
        {avatarUrl ? (
          <Image
            source={{ uri: avatarUrl }}
            style={[styles.avatar, { borderColor: theme.primaryBorder }]}
          />
        ) : (
          <View style={[styles.avatarFallback, { backgroundColor: theme.primaryBg, borderColor: theme.primaryBorder }]}>
            <Text style={[styles.avatarText, { color: theme.primary }]}>
              {avatarFallback.slice(0, 2).toUpperCase()}
            </Text>
          </View>
        )}
        {showOnlineDot && (
          <View
            style={[
              styles.onlineDot,
              { backgroundColor: online ? theme.online : theme.textDim, borderColor: theme.surface },
            ]}
          />
        )}
      </View>
      <View style={styles.titleBlock}>
        <Text style={[styles.title, { color: theme.text }]} numberOfLines={1}>
          {title}
        </Text>
        {resolvedStatus && <StatusCapsule status={resolvedStatus} />}
      </View>
    </TouchableOpacity>
  );

  if (breadcrumb || onBack) {
    return (
      <View style={[styles.shell, { backgroundColor: theme.surface, borderBottomColor: VROOM_RED_BORDER }]}>
        <View style={styles.row}>
          {onBack && (
            <TouchableOpacity onPress={onBack} style={[styles.iconBtn, { backgroundColor: theme.surface2, borderColor: theme.border }]}>
              <MaterialCommunityIcons name="chevron-left" size={22} color={theme.text} />
            </TouchableOpacity>
          )}
          {center}
          {right ?? <View style={styles.iconBtnPlaceholder} />}
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.shell, { backgroundColor: theme.surface, borderBottomColor: VROOM_RED_BORDER }]}>
      <View style={styles.row}>
        {center}
        {right}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    borderBottomWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  center: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  avatarWrap: { position: 'relative' },
  avatar: { width: 40, height: 40, borderRadius: 20, borderWidth: 2 },
  avatarFallback: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontFamily: 'Orbitron', fontSize: 12, fontWeight: '900' },
  onlineDot: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 11,
    height: 11,
    borderRadius: 6,
    borderWidth: 2,
  },
  titleBlock: { flex: 1, gap: 3 },
  title: { fontFamily: 'Orbitron', fontSize: 12, fontWeight: '700' },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  statusText: { fontFamily: 'Orbitron', fontSize: 8 },
  capsule: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    borderWidth: 1,
  },
  capsuleText: { fontFamily: 'Orbitron', fontSize: 7, letterSpacing: 1, fontWeight: '700' },
  dot: { width: 6, height: 6, borderRadius: 3 },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconBtnPlaceholder: { width: 36 },
});
