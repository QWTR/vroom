import type { AppTheme } from '../../../constants/theme';
import type { ChatActionCapabilities, ChatMenuAction, GroupedMessageMeta, UnifiedChatMessage } from './types';

const MEDIA_BASE = 'https://v-room.app';

export function formatChatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('pl', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

export function formatConversationTime(iso: string): string {
  try {
    const date = new Date(iso);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffM = Math.floor(diffMs / 60000);
    const diffH = Math.floor(diffMs / 3600000);
    const diffD = Math.floor(diffMs / 86400000);
    if (diffM < 1) return 'teraz';
    if (diffM < 60) return `${diffM}min`;
    if (diffH < 24) return `${diffH}h`;
    if (diffD < 7) return `${diffD}d`;
    return date.toLocaleDateString('pl', { day: '2-digit', month: '2-digit' });
  } catch {
    return '';
  }
}

export function normalizeChatMediaUri(uri: string, baseUrl = MEDIA_BASE): string {
  if (!uri) return uri;
  if (/^https?:\/\//i.test(uri) || /^file:\/\//i.test(uri) || /^content:\/\//i.test(uri)) return uri;
  return `${baseUrl}${uri.startsWith('/') ? uri : `/${uri}`}`;
}

export function extractChatUrl(text: string): string | null {
  if (!text) return null;
  const match = text.match(/https?:\/\/[^\s]+/);
  return match ? match[0] : null;
}

export function parseRouteMessage(content: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(content);
    if (parsed?.type === 'route') return parsed;
  } catch {}
  return null;
}

export function parseVroomkiMessage(content: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(content);
    if (parsed?.type === 'vroomki') return parsed;
  } catch {}
  return null;
}

export function replyPreviewLabel(reply: {
  content?: string | null;
  photos?: string[];
  videos?: string[];
}): string {
  const text = reply.content?.trim();
  if (text) return text;
  if (reply.photos?.length) return '📷 Zdjęcie';
  if (reply.videos?.length) return '🎬 Film';
  return '…';
}

export function getGroupedMessageMeta(
  messages: UnifiedChatMessage[],
  index: number,
  myId: number | null,
  showGroupNames = false,
): GroupedMessageMeta {
  const item = messages[index];
  const isMe = item.senderId === myId;
  const prevMsg = messages[index - 1];
  const nextMsg = messages[index + 1];
  const isFirst = !prevMsg || prevMsg.senderId !== item.senderId;
  const isLast = !nextMsg || nextMsg.senderId !== item.senderId;
  return {
    isMe,
    isFirst,
    isLast,
    showAvatar: !isMe && isLast,
    showName: !isMe && isFirst && showGroupNames,
  };
}

export function getBubbleRadii(isMe: boolean, isFirst: boolean, isLast: boolean) {
  const R = 18;
  const T = 5;
  return isMe
    ? {
        borderTopLeftRadius: R,
        borderBottomLeftRadius: R,
        borderTopRightRadius: isFirst ? R : T,
        borderBottomRightRadius: isLast ? R : T,
      }
    : {
        borderTopRightRadius: R,
        borderBottomRightRadius: R,
        borderTopLeftRadius: isFirst ? R : T,
        borderBottomLeftRadius: isLast ? R : T,
      };
}

export function buildChatActions(opts: {
  message: UnifiedChatMessage;
  myId: number | null;
  capabilities: ChatActionCapabilities;
  isModerator?: boolean;
  onReply?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  onPin?: () => void;
  onReport?: () => void;
  onBlock?: () => void;
  onCopy?: () => void;
}): ChatMenuAction[] {
  const { message, myId, capabilities, isModerator } = opts;
  const isMe = message.senderId === myId;
  const actions: ChatMenuAction[] = [];

  if (capabilities.reply && opts.onReply) {
    actions.push({ id: 'reply', icon: 'reply', label: 'Odpowiedz', onPress: opts.onReply });
  }
  if (capabilities.edit && opts.onEdit && (!capabilities.editOwnOnly || isMe)) {
    actions.push({ id: 'edit', icon: 'edit', label: 'Edytuj', onPress: opts.onEdit });
  }
  if (capabilities.pin && opts.onPin && isModerator) {
    actions.push({
      id: 'pin',
      icon: 'push-pin',
      label: message.isPinned ? 'Odepnij' : 'Przypnij',
      color: '#FFD700',
      onPress: opts.onPin,
    });
  }
  const canDelete =
    capabilities.delete &&
    opts.onDelete &&
    ((capabilities.deleteOwnOnly && isMe) ||
      capabilities.deleteModerator && isModerator ||
      (!capabilities.deleteOwnOnly && !capabilities.deleteModerator));
  if (canDelete) {
    actions.push({
      id: 'delete',
      icon: 'delete-outline',
      label: 'Usuń',
      color: '#e33835',
      destructive: true,
      onPress: opts.onDelete!,
    });
  }
  if (capabilities.copy && message.content && opts.onCopy) {
    actions.push({ id: 'copy', icon: 'content-copy', label: 'Kopiuj', onPress: opts.onCopy });
  }
  if (capabilities.report && !isMe && opts.onReport) {
    actions.push({
      id: 'report',
      icon: 'flag',
      label: 'Zgłoś treść',
      color: '#FF9800',
      onPress: opts.onReport,
    });
  }
  if (capabilities.block && !isMe && opts.onBlock) {
    actions.push({
      id: 'block',
      icon: 'block',
      label: 'Zablokuj użytkownika',
      color: '#e33835',
      destructive: true,
      onPress: opts.onBlock,
    });
  }
  return actions;
}

export function getMyBubbleStyle(theme: AppTheme, isDark: boolean) {
  return {
    backgroundColor: theme.primary,
    borderWidth: 1,
    borderColor: isDark ? '#e3383560' : theme.primaryBorder,
  };
}

export function getTheirBubbleStyle(theme: AppTheme, isDark: boolean) {
  return {
    backgroundColor: isDark ? theme.surface2 : theme.surface,
    borderWidth: 1,
    borderColor: theme.border2,
  };
}
