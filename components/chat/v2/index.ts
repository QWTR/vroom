export * from './types';
export * from './constants';
export * from './helpers';
export * from './adapters';
export { SUPPORT_USER_SENDER_ID, SUPPORT_STAFF_SENDER_ID } from './adapters';

export { ChatScreenShell } from './ChatScreenShell';
export { ChatHeader } from './ChatHeader';
export { ChatMessageList } from './ChatMessageList';
export { ChatMessageBubble } from './ChatMessageBubble';
export { ChatComposer } from './ChatComposer';
export { ChatAttachmentPreviewBar } from './ChatAttachmentPreviewBar';
export { ChatReplyPreview } from './ChatReplyPreview';
export { ChatReactionBar } from './ChatReactionBar';
export { ChatMessageMenu } from './ChatMessageMenu';
export { ChatMediaGrid } from './ChatMediaGrid';
export { ChatTypingIndicator } from './ChatTypingIndicator';
export { ChatConversationListItem } from './ChatConversationListItem';
export { ChatLoadingState, ChatEmptyState } from './ChatLoadingState';

export const DM_CAPABILITIES = {
  reply: true,
  reactions: true,
  photos: true,
  routeCard: true,
  linkPreview: true,
  report: true,
  block: true,
  copy: true,
} as const;

export const PUBLIC_CAPABILITIES = {
  reply: true,
  edit: true,
  editOwnOnly: true,
  delete: true,
  deleteOwnOnly: true,
  deleteModerator: true,
  reactions: true,
  photos: true,
  video: true,
  mentions: true,
  linkPreview: true,
  report: true,
  block: true,
  copy: true,
} as const;

export const CLUB_CAPABILITIES = {
  reply: true,
  reactions: true,
  photos: true,
  mentions: true,
  pin: true,
  delete: true,
  deleteOwnOnly: true,
  deleteModerator: true,
  report: true,
  block: true,
  copy: true,
} as const;

export const MARKET_CAPABILITIES = {
  photos: true,
  copy: true,
} as const;

export const SUPPORT_CAPABILITIES = {
  photos: true,
  video: true,
  attachments: true,
  copy: true,
} as const;
