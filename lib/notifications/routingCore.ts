export type NotificationData = Record<string, unknown> & {
  v?: number | string;
  notificationId?: number | string;
  type?: string;
  url?: string;
};

const numeric = (value: unknown): string | null => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? String(parsed) : null;
};

const params = (values: Record<string, unknown>): string => {
  const query = Object.entries(values)
    .filter(([, value]) => value !== null && value !== undefined && value !== '')
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join('&');
  return query ? `?${query}` : '';
};

export function isSafeInternalNotificationUrl(value: unknown): value is string {
  return typeof value === 'string'
    && value.startsWith('/')
    && !value.startsWith('//')
    && !value.includes('://')
    && value.length <= 500;
}

export function resolveNotificationUrl(data: NotificationData | null | undefined): string {
  if (!data) return '/notifications';
  if (isSafeInternalNotificationUrl(data.url)) return data.url;

  const type = String(data.type || '');
  const conversationId = numeric(data.conversationId);
  const messageId = numeric(data.messageId);
  const postId = numeric(data.postId);
  const commentId = numeric(data.commentId);
  const vroomkiId = numeric(data.vroomkiPostId ?? data.vroomkiId);
  const clubId = numeric(data.clubId);
  const channelId = numeric(data.channelId);
  const meetId = numeric(data.meetId);

  if (type === 'new_message' && conversationId) return `/Community/chats/${conversationId}${params({ messageId })}`;
  if (type === 'market_message' && conversationId) return `/Community/market/chat/${conversationId}${params({ messageId })}`;
  if (['like_post', 'like_post_comment', 'comment_post', 'comment_reply', 'mention_discussion', 'discussion_post_new', 'followed_post_new'].includes(type) && postId) return `/Community/community/community${params({ postId, commentId })}`;
  if (['like_vroomki', 'like_vroomki_comment', 'comment_vroomki', 'comment_vroomki_reply', 'followed_vroomki_new', 'vroomki_published'].includes(type) && vroomkiId) return `/Community/vroomki${params({ vroomkiId, commentId })}`;
  if (['club_chat', 'mention_club'].includes(type) && clubId) return `/Community/clubs/${clubId}${params({ channelId, messageId })}`;
  if (type === 'club_invite') return `/Community/clubs/clubs${params({ inviteId: numeric(data.inviteId), clubId })}`;
  if (['mention_public_chat', 'public_chat_message'].includes(type)) return `/Community/public/public${params({ messageId })}`;
  if (['like_spot', 'comment_spot'].includes(type) && numeric(data.spotId)) return `/(tabs)/spotmap${params({ spotId: numeric(data.spotId), commentId })}`;
  if (['like_car', 'comment_car'].includes(type) && numeric(data.carId)) return `/profile/car-detail${params({ id: numeric(data.carId), commentId })}`;
  if (type === 'friend_request') return `/notifications${params({ focus: numeric(data.notificationId) })}`;
  if (type === 'friend_accepted' && numeric(data.userId)) return `/profile/${numeric(data.userId)}`;
  if (type === 'meet_participant_applied' && meetId) return `/Community/meets/applications${params({ id: meetId })}`;
  if (['meet_nearby_invite', 'meet_joined', 'meet_participant_approved', 'meet_participant_rejected', 'meet_reminder'].includes(type) && meetId) return `/Community/meets/meet${params({ id: meetId })}`;
  if (type === 'geo_drop_available' && numeric(data.dropId)) return `/(tabs)/map${params({ dropId: numeric(data.dropId), lat: data.lat, lng: data.lng })}`;
  if (['daily_duel_available', 'comeback_digest'].includes(type)) return '/Community/duel/vote';
  if (type === 'achievement') return `/profile/achievements${params({ achievementKey: data.achievementKey })}`;
  if (type === 'bug_report_reply' && numeric(data.bugReportId)) return `/profile/bug-report/${numeric(data.bugReportId)}`;
  if (['market_sale', 'market_purchase', 'market_released'].includes(type)) return `/Community/market/orders${params({ orderId: data.orderId })}`;
  if (type === 'vehicle_order_ready' && numeric(data.orderId)) return `/shop/vehicle-order/${numeric(data.orderId)}`;
  if (type === 'streak_at_risk') return '/(tabs)';
  if (type === 'navigation') return '/(tabs)/map';
  if (['grid_round_ready', 'grid_vote_ending'].includes(type)) return `/Community/grid/vote${params({ eventId: numeric(data.eventId), battleId: numeric(data.battleId) })}`;
  if (type === 'partner_event_update' && numeric(data.eventId)) return `/partner/events/${numeric(data.eventId)}`;
  return '/notifications';
}

export function notificationNavigationKey(data: NotificationData): string {
  return `${String(data.type || 'notification')}:${String(data.notificationId || resolveNotificationUrl(data))}`;
}

export function shouldPresentForegroundNotification(data: NotificationData | null | undefined): boolean {
  if (!data) return false;
  const type = String(data.type || '');
  if (['vroomki_publish_status', 'vroomki_published', 'vroomki_publish_failed'].includes(type)) return true;
  const notificationId = Number(data.notificationId);
  return Number.isInteger(notificationId) && notificationId > 0;
}
