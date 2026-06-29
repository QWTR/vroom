import type { ReactNode } from 'react';

export type UnifiedChatContext = 'dm' | 'public' | 'club' | 'market' | 'support';

export interface UnifiedChatUser {
  id: number;
  username: string;
  avatarUrl: string | null;
  online?: boolean;
  isPremium?: boolean;
  isAdmin?: boolean;
  nickColor?: string | null;
  province?: string | null;
  subtitle?: string | null;
}

export interface UnifiedChatAttachment {
  type: 'photo' | 'video';
  uri: string;
}

export interface UnifiedChatReaction {
  emoji: string;
  count: number;
  myReaction: boolean;
}

export interface UnifiedChatReply {
  id: number;
  content: string;
  sender: { id: number; username: string };
  hasMedia?: boolean;
}

export interface UnifiedChatMessage {
  id: number;
  senderId: number;
  sender: UnifiedChatUser;
  content: string;
  photos: string[];
  videos: string[];
  createdAt: string;
  editedAt?: string | null;
  replyTo?: UnifiedChatReply | null;
  reactions?: UnifiedChatReaction[];
  isPinned?: boolean;
  routeData?: Record<string, unknown> | null;
  isRead?: boolean;
  /** Original API message — passed back to screen handlers */
  raw?: unknown;
}

export interface ChatActionCapabilities {
  reply?: boolean;
  edit?: boolean;
  editOwnOnly?: boolean;
  delete?: boolean;
  deleteOwnOnly?: boolean;
  deleteModerator?: boolean;
  reactions?: boolean;
  photos?: boolean;
  video?: boolean;
  mentions?: boolean;
  pin?: boolean;
  report?: boolean;
  block?: boolean;
  copy?: boolean;
  routeCard?: boolean;
  linkPreview?: boolean;
  attachments?: boolean;
}

export interface GroupedMessageMeta {
  isMe: boolean;
  isFirst: boolean;
  isLast: boolean;
  showAvatar: boolean;
  showName: boolean;
}

export interface ChatMenuAction {
  id: string;
  icon: string;
  label: string;
  color?: string;
  destructive?: boolean;
  onPress: () => void;
}

export interface ConversationListData {
  id: number;
  name: string;
  avatarUrl: string | null;
  isGroup?: boolean;
  online?: boolean;
  lastMessage?: {
    content: string;
    photos?: string[];
    createdAt: string;
    isMe?: boolean;
  } | null;
  unread?: number;
}

export type ChatHeaderStatus =
  | { kind: 'online'; label?: string }
  | { kind: 'offline'; label?: string }
  | { kind: 'typing'; text: string }
  | { kind: 'badge'; label: string; color?: string }
  | { kind: 'custom'; node: ReactNode };
