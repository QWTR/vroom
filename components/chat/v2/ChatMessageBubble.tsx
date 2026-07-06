import React from 'react';
import { View, Text, Image, TouchableOpacity, StyleSheet } from 'react-native';
import { useTheme } from '../../../contexts/ThemeContext';
import { UserBadges } from '../../user/UserBadges';
import { ProvinceBadge } from '../../user/ProvinceBadge';
import { RouteMessageCard } from '../RouteMessageCard';
import { VroomkiMessageCard } from '../VroomkiMessageCard';
// @ts-ignore
import { LinkPreviewCard } from '../LinkPreviewCard';
import { ChatMediaGrid } from './ChatMediaGrid';
import { ChatReactionBar } from './ChatReactionBar';
import {
  extractChatUrl,
  formatChatTime,
  getBubbleRadii,
  getMyBubbleStyle,
  getTheirBubbleStyle,
} from './helpers';
import type { ChatActionCapabilities, GroupedMessageMeta, UnifiedChatMessage } from './types';
import { VROOM_RED, VROOM_RED_BORDER } from './constants';

type Props = {
  message: UnifiedChatMessage;
  meta: GroupedMessageMeta;
  capabilities: ChatActionCapabilities;
  showGroupNames?: boolean;
  onLongPress?: () => void;
  onReact?: (emoji: string) => void;
  onPressPhoto?: (uri: string) => void;
  onNavigateRoute?: (data: Record<string, unknown>) => void;
  renderBody?: (content: string, isMe: boolean) => React.ReactNode;
};

export function ChatMessageBubble({
  message,
  meta,
  capabilities,
  onLongPress,
  onReact,
  onPressPhoto,
  onNavigateRoute,
  renderBody,
}: Props) {
  const { theme, isDark } = useTheme();
  const { isMe, isFirst, isLast, showAvatar, showName } = meta;

  const bubbleRadius = getBubbleRadii(isMe, isFirst, isLast);
  const myStyle = getMyBubbleStyle(theme, isDark);
  const theirStyle = getTheirBubbleStyle(theme, isDark);
  const linkUrl = capabilities.linkPreview && !message.routeData && !message.vroomkiData ? extractChatUrl(message.content) : null;
  const hasMedia = message.photos.length > 0 || message.videos.length > 0;

  if (message.vroomkiData && capabilities.vroomkiCard) {
    return (
      <View style={[styles.row, isMe ? styles.rowMe : styles.rowThem, { marginBottom: isLast ? 8 : 2 }]}>
        {!isMe && <AvatarSlot show={showAvatar} user={message.sender} />}
        <View style={isMe ? styles.alignEnd : styles.alignStart}>
          {showName && <SenderName user={message.sender} />}
          <VroomkiMessageCard data={message.vroomkiData as any} isMe={isMe} />
          <Text style={[styles.timeStandalone, { color: isDark ? '#ffffff40' : '#00000040' }]}>
            {formatChatTime(message.createdAt)}
          </Text>
        </View>
      </View>
    );
  }

  if (message.routeData && capabilities.routeCard) {
    return (
      <View style={[styles.row, isMe ? styles.rowMe : styles.rowThem, { marginBottom: isLast ? 8 : 2 }]}>
        {!isMe && <AvatarSlot show={showAvatar} user={message.sender} />}
        <View style={isMe ? styles.alignEnd : styles.alignStart}>
          {showName && <SenderName user={message.sender} />}
            <RouteMessageCard
              data={message.routeData as any}
              isMe={isMe}
              onNavigate={onNavigateRoute ? (data) => onNavigateRoute(data as unknown as Record<string, unknown>) : () => {}}
            />
          <Text style={[styles.timeStandalone, { color: isDark ? '#ffffff40' : '#00000040' }]}>
            {formatChatTime(message.createdAt)}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.row, isMe ? styles.rowMe : styles.rowThem, { marginBottom: isLast ? 8 : 2 }]}>
      {!isMe && <AvatarSlot show={showAvatar} user={message.sender} />}

      <View style={isMe ? styles.alignEnd : styles.alignStart}>
        <TouchableOpacity
          style={[
            styles.bubble,
            hasMedia && styles.mediaBubble,
            bubbleRadius,
            isMe ? myStyle : theirStyle,
          ]}
          onLongPress={onLongPress}
          activeOpacity={0.85}
          delayLongPress={300}
        >
          {showName && <SenderName user={message.sender} />}

          {message.isPinned && (
            <Text style={[styles.pinned, { color: isMe ? '#ffffffaa' : '#FFD700' }]}>📌 PRZYPIĘTE</Text>
          )}

          {message.replyTo && (
            <View
              style={[
                styles.replyQuote,
                { borderLeftColor: isMe ? '#ffffff90' : `${VROOM_RED}60` },
              ]}
            >
              <Text style={[styles.replyAuthor, { color: isMe ? '#ffffffaa' : `${VROOM_RED}aa` }]}>
                {message.replyTo.sender.username}
              </Text>
              <Text style={[styles.replyText, { color: isMe ? '#ffffff70' : theme.textDim }]} numberOfLines={1}>
                {message.replyTo.content}
              </Text>
            </View>
          )}

          {(message.photos.length > 0 || message.videos.length > 0) && (
            <ChatMediaGrid
              photos={message.photos}
              videos={capabilities.video ? message.videos : []}
              onPressPhoto={onPressPhoto}
            />
          )}

          {!!message.content && (
            renderBody ? (
              renderBody(message.content, isMe)
            ) : (
              <Text style={[styles.body, { color: isMe ? '#fff' : theme.textMuted }]}>
                {message.content}
              </Text>
            )
          )}

          {linkUrl && <LinkPreviewCard url={linkUrl} isMe={isMe} theme={theme} />}

          <View style={styles.timeRow}>
            {message.editedAt && (
              <Text style={[styles.edited, { color: isMe ? '#ffffff50' : theme.textFaint }]}>
                edytowano
              </Text>
            )}
            <Text style={[styles.time, { color: isMe ? '#ffffff60' : theme.textDim }]}>
              {formatChatTime(message.createdAt)}
            </Text>
          </View>
        </TouchableOpacity>

        {capabilities.reactions && message.reactions && message.reactions.length > 0 && (
          <ChatReactionBar reactions={message.reactions} onReact={onReact} />
        )}
      </View>
    </View>
  );
}

function SenderName({ user }: { user: UnifiedChatMessage['sender'] }) {
  const { theme } = useTheme();
  return (
    <View style={styles.nameRow}>
      <Text style={[styles.name, { color: user.nickColor || VROOM_RED }]}>
        {user.username}
      </Text>
      {!!user.province && (
        <ProvinceBadge province={user.province} compact theme={theme} />
      )}
      <UserBadges isAdmin={user.isAdmin} isPremium={user.isPremium} compact />
    </View>
  );
}

function AvatarSlot({ show, user }: { show: boolean; user: UnifiedChatMessage['sender'] }) {
  const { theme } = useTheme();
  return (
    <View style={styles.avatarSlot}>
      {show && (
        user.avatarUrl ? (
          <Image source={{ uri: user.avatarUrl }} style={[styles.avatar, { borderColor: VROOM_RED_BORDER }]} />
        ) : (
          <View style={[styles.avatarFallback, { backgroundColor: theme.surface2, borderColor: VROOM_RED_BORDER }]}>
            <Text style={[styles.avatarText, { color: VROOM_RED }]}>
              {user.username?.slice(0, 2).toUpperCase()}
            </Text>
          </View>
        )
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: 6, marginVertical: 1 },
  rowMe: { justifyContent: 'flex-end', paddingLeft: 48 },
  rowThem: { justifyContent: 'flex-start', paddingRight: 48 },
  alignEnd: { alignItems: 'flex-end' },
  alignStart: { alignItems: 'flex-start' },
  avatarSlot: { width: 30, alignItems: 'center', justifyContent: 'flex-end' },
  avatar: { width: 28, height: 28, borderRadius: 14, borderWidth: 1.5 },
  avatarFallback: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontFamily: 'Orbitron', fontSize: 9, fontWeight: '700' },
  bubble: { maxWidth: '100%', paddingHorizontal: 12, paddingVertical: 8, gap: 4 },
  mediaBubble: { paddingHorizontal: 6, paddingTop: 6, paddingBottom: 8, gap: 8 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 },
  name: { fontFamily: 'Orbitron', fontSize: 9, fontWeight: '700' },
  pinned: { fontFamily: 'Orbitron', fontSize: 7, letterSpacing: 1, marginBottom: 2 },
  replyQuote: {
    backgroundColor: '#00000020',
    borderRadius: 8,
    borderLeftWidth: 3,
    paddingHorizontal: 8,
    paddingVertical: 4,
    marginBottom: 4,
    gap: 2,
  },
  replyAuthor: { fontFamily: 'Orbitron', fontSize: 8, fontWeight: '700' },
  replyText: { fontSize: 11 },
  body: { fontSize: 14, lineHeight: 20 },
  timeRow: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-end', gap: 6 },
  edited: { fontSize: 8, fontStyle: 'italic' },
  time: { fontSize: 9 },
  timeStandalone: { fontSize: 9, alignSelf: 'flex-end', marginTop: 2 },
});
