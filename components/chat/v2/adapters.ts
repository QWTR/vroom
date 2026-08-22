import { API_URL } from '../../../constants/config';
import type { BugReportMsg } from '../../../hooks/useBugReportSocket';
import { normalizeChatMediaUri, parseRouteMessage, parseVroomkiMessage, replyPreviewLabel } from './helpers';
import type { UnifiedChatMessage, UnifiedChatUser } from './types';

function mapUser(u: {
  id: number;
  username: string;
  avatarUrl?: string | null;
  online?: boolean;
  isPremium?: boolean;
  isAdmin?: boolean;
  nickColor?: string | null;
  province?: string | null;
}): UnifiedChatUser {
  return {
    id: u.id,
    username: u.username,
    avatarUrl: u.avatarUrl ?? null,
    online: u.online,
    isPremium: u.isPremium,
    isAdmin: u.isAdmin,
    nickColor: u.nickColor,
    province: u.province,
  };
}

export function mapDmMessageToUnified(msg: {
  id: number;
  content: string;
  photos?: string[];
  createdAt: string;
  senderId: number;
  sender: Parameters<typeof mapUser>[0];
  replyTo?: {
    id: number;
    content: string;
    sender: { id: number; username: string };
  } | null;
  reactions?: { emoji: string; count: number; myReaction: boolean }[];
  clientRequestId?: string | null;
  deliveryStatus?: 'sending' | 'sent' | 'delivered' | 'read' | 'failed';
  deliveryError?: string | null;
}): UnifiedChatMessage {
  const routeData = parseRouteMessage(msg.content);
  const vroomkiData = routeData ? null : parseVroomkiMessage(msg.content);
  return {
    id: msg.id,
    senderId: msg.senderId,
    sender: mapUser(msg.sender),
    content: routeData || vroomkiData ? '' : msg.content,
    photos: (msg.photos ?? []).map(u => normalizeChatMediaUri(u)),
    videos: [],
    createdAt: msg.createdAt,
    replyTo: msg.replyTo
      ? {
          id: msg.replyTo.id,
          content: msg.replyTo.content || replyPreviewLabel({ content: msg.replyTo.content, photos: ['x'] }),
          sender: msg.replyTo.sender,
          hasMedia: !msg.replyTo.content,
        }
      : null,
    reactions: msg.reactions,
    clientRequestId: msg.clientRequestId,
    deliveryStatus: msg.deliveryStatus,
    deliveryError: msg.deliveryError,
    routeData,
    vroomkiData,
    raw: msg,
  };
}

export function mapPublicMessageToUnified(msg: {
  id: number;
  content: string | null;
  photos?: string[];
  videos?: string[];
  createdAt: string;
  editedAt?: string | null;
  senderId: number;
  sender: Parameters<typeof mapUser>[0];
  replyTo?: {
    id: number;
    content: string | null;
    photos?: string[];
    videos?: string[];
    sender: { id: number; username: string };
  } | null;
  reactions?: { emoji: string; count: number; myReaction: boolean }[];
}): UnifiedChatMessage {
  return {
    id: msg.id,
    senderId: msg.senderId,
    sender: mapUser(msg.sender),
    content: msg.content ?? '',
    photos: (msg.photos ?? []).map(u => normalizeChatMediaUri(u, API_URL)),
    videos: (msg.videos ?? []).map(u => normalizeChatMediaUri(u, API_URL)),
    createdAt: msg.createdAt,
    editedAt: msg.editedAt,
    replyTo: msg.replyTo
      ? {
          id: msg.replyTo.id,
          content: replyPreviewLabel(msg.replyTo),
          sender: msg.replyTo.sender,
          hasMedia: !!(msg.replyTo.photos?.length || msg.replyTo.videos?.length),
        }
      : null,
    reactions: msg.reactions,
    raw: msg,
  };
}

export function mapClubMessageToUnified(msg: {
  id: number;
  content: string | null;
  photos?: string[];
  createdAt: string;
  senderId: number;
  isPinned?: boolean;
  sender: Parameters<typeof mapUser>[0];
  replyTo?: {
    id: number;
    content: string | null;
    sender: { id: number; username: string };
  } | null;
  reactions?: { emoji: string; count: number; myReaction: boolean }[];
}): UnifiedChatMessage {
  return {
    id: msg.id,
    senderId: msg.senderId,
    sender: mapUser(msg.sender),
    content: msg.content ?? '',
    photos: (msg.photos ?? []).map(u => normalizeChatMediaUri(u, API_URL)),
    videos: [],
    createdAt: msg.createdAt,
    isPinned: msg.isPinned,
    replyTo: msg.replyTo
      ? {
          id: msg.replyTo.id,
          content: replyPreviewLabel({ content: msg.replyTo.content, photos: msg.photos }),
          sender: msg.replyTo.sender,
          hasMedia: !msg.replyTo.content,
        }
      : null,
    reactions: msg.reactions,
    raw: msg,
  };
}

export function mapMarketMessageToUnified(msg: {
  id: number;
  content: string;
  photos?: string[];
  createdAt: string;
  senderId: number;
  sender: { id: number; username: string; avatarUrl?: string | null };
}): UnifiedChatMessage {
  return {
    id: msg.id,
    senderId: msg.senderId,
    sender: mapUser(msg.sender),
    content: msg.content,
    photos: (msg.photos ?? []).map(u => normalizeChatMediaUri(u, API_URL)),
    videos: [],
    createdAt: msg.createdAt,
    raw: msg,
  };
}

export const SUPPORT_USER_SENDER_ID = 1;
export const SUPPORT_STAFF_SENDER_ID = 2;

export function mapSupportMessageToUnified(msg: BugReportMsg): UnifiedChatMessage {
  const isStaff = msg.authorKind !== 'user';
  const senderId = isStaff ? SUPPORT_STAFF_SENDER_ID : SUPPORT_USER_SENDER_ID;
  return {
    id: msg.id,
    senderId,
    sender: {
      id: senderId,
      username: isStaff
        ? (msg.staffEmail?.split('@')[0]?.toUpperCase() ?? 'SUPPORT')
        : 'TY',
      avatarUrl: null,
      subtitle: isStaff ? (msg.staffEmail ?? 'SUPPORT') : null,
      isAdmin: isStaff,
    },
    content: msg.body,
    photos: (msg.photos ?? []).map(u => normalizeChatMediaUri(u, API_URL)),
    videos: (msg.videos ?? []).map(u => normalizeChatMediaUri(u, API_URL)),
    createdAt: msg.createdAt,
    raw: msg,
  };
}

export function isSupportMessageFromMe(msg: BugReportMsg): boolean {
  return msg.authorKind === 'user';
}
