import React, { useCallback } from 'react';
import {
  FlatList, View, Text, TouchableOpacity, ActivityIndicator, StyleSheet, Platform,
  type FlatListProps,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useTheme } from '../../../contexts/ThemeContext';
import { ChatMessageBubble } from './ChatMessageBubble';
import { ChatEmptyState } from './ChatLoadingState';
import { getGroupedMessageMeta } from './helpers';
import type { ChatActionCapabilities, UnifiedChatMessage } from './types';
import { VROOM_RED } from './constants';

type Props = {
  messages: UnifiedChatMessage[];
  myId: number | null;
  listRef: React.RefObject<FlatList<UnifiedChatMessage> | null>;
  loading?: boolean;
  loadingMore?: boolean;
  hasMore?: boolean;
  onLoadOlder?: () => void;
  listPaddingBottom?: number;
  capabilities: ChatActionCapabilities;
  showGroupNames?: boolean;
  onLongPressMessage?: (message: UnifiedChatMessage) => void;
  onReact?: (messageId: number, emoji: string) => void;
  onPressPhoto?: (uri: string) => void;
  onNavigateRoute?: (data: Record<string, unknown>) => void;
  renderBody?: (content: string, isMe: boolean, message: UnifiedChatMessage) => React.ReactNode;
  renderMessageFooter?: (message: UnifiedChatMessage, index: number) => React.ReactNode;
  emptyTitle?: string;
  emptySubtitle?: string;
  inverted?: boolean;
  listProps?: Partial<FlatListProps<UnifiedChatMessage>>;
};

export function ChatMessageList({
  messages,
  myId,
  listRef,
  loading = false,
  loadingMore = false,
  hasMore = false,
  onLoadOlder,
  listPaddingBottom = 8,
  capabilities,
  showGroupNames = false,
  onLongPressMessage,
  onReact,
  onPressPhoto,
  onNavigateRoute,
  renderBody,
  renderMessageFooter,
  emptyTitle = 'Brak wiadomości',
  emptySubtitle = 'Napisz pierwszą wiadomość!',
  inverted = false,
  listProps,
}: Props) {
  const { theme } = useTheme();
  const {
    contentContainerStyle: listContentContainerStyle,
    maintainVisibleContentPosition: listMaintainVisibleContentPosition,
    ...restListProps
  } = listProps ?? {};

  const renderItem = useCallback(
    ({ item, index }: { item: UnifiedChatMessage; index: number }) => {
      const meta = getGroupedMessageMeta(messages, index, myId, showGroupNames);
      return (
        <View>
          <ChatMessageBubble
            message={item}
            meta={meta}
            capabilities={capabilities}
            onLongPress={() => onLongPressMessage?.(item)}
            onReact={emoji => onReact?.(item.id, emoji)}
            onPressPhoto={onPressPhoto}
            onNavigateRoute={onNavigateRoute}
            renderBody={
              renderBody
                ? (content, isMe) => renderBody(content, isMe, item)
                : undefined
            }
          />
          {renderMessageFooter?.(item, index)}
        </View>
      );
    },
    [messages, myId, showGroupNames, capabilities, onLongPressMessage, onReact, onPressPhoto, onNavigateRoute, renderBody, renderMessageFooter],
  );

  const ListHeader = hasMore ? (
    loadingMore ? (
      <ActivityIndicator color={VROOM_RED} style={styles.loadMore} />
    ) : (
      <TouchableOpacity style={styles.loadMoreBtn} onPress={onLoadOlder} activeOpacity={0.8}>
        <View style={[styles.loadMorePill, { backgroundColor: `${VROOM_RED}15`, borderColor: `${VROOM_RED}30` }]}>
          <MaterialIcons name="keyboard-arrow-up" size={14} color={VROOM_RED} />
          <Text style={[styles.loadMoreText, { color: VROOM_RED }]}>ZAŁADUJ STARSZE</Text>
        </View>
      </TouchableOpacity>
    )
  ) : messages.length > 0 ? (
    <View style={styles.startMarker}>
      <View style={[styles.markerLine, { backgroundColor: theme.border }]} />
      <Text style={[styles.markerText, { color: theme.textDim }]}>POCZĄTEK ROZMOWY</Text>
      <View style={[styles.markerLine, { backgroundColor: theme.border }]} />
    </View>
  ) : null;

  if (loading) return null;

  return (
    <FlatList
      ref={listRef}
      data={messages}
      keyExtractor={item => String(item.id)}
      renderItem={renderItem}
      inverted={inverted}
      ListHeaderComponent={inverted ? undefined : ListHeader}
      ListFooterComponent={inverted ? ListHeader : undefined}
      ListEmptyComponent={
        <ChatEmptyState title={emptyTitle} subtitle={emptySubtitle} />
      }
      contentContainerStyle={[
        styles.content,
        { paddingBottom: listPaddingBottom },
        messages.length === 0 && styles.emptyGrow,
        listContentContainerStyle,
      ]}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
      maintainVisibleContentPosition={
        listMaintainVisibleContentPosition ?? { minIndexForVisible: 0, autoscrollToTopThreshold: 10 }
      }
      {...restListProps}
    />
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 12, paddingTop: 4, flexGrow: 1 },
  emptyGrow: { flex: 1 },
  loadMore: { marginVertical: 14 },
  loadMoreBtn: { alignItems: 'center', paddingVertical: 12 },
  loadMorePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderWidth: 1,
  },
  loadMoreText: { fontFamily: 'Orbitron', fontSize: 8, letterSpacing: 1 },
  startMarker: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 16,
  },
  markerLine: { flex: 1, height: 1 },
  markerText: { fontFamily: 'Orbitron', fontSize: 7, letterSpacing: 2 },
});
