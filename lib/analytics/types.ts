export type AnalyticsPriority = 'low' | 'medium' | 'high';

export type AnalyticsEventName =
  | 'session_started'
  | 'screen_viewed'
  | 'screen_engagement'
  | 'ui_action'
  | 'content_impression'
  | 'content_opened'
  | 'content_watch'
  | 'search_submitted'
  | 'filter_applied'
  | 'push_opened'
  | 'share_started'
  | 'navigation_started'
  | 'navigation_completed'
  | 'funnel_step';

export type AnalyticsEventInput = {
  eventName: AnalyticsEventName;
  priority?: AnalyticsPriority;
  screenName?: string;
  surface?: string;
  entityType?: 'post' | 'vroomki' | 'meet' | 'spot' | 'profile' | 'market' | 'map';
  entityId?: string | number;
  position?: number;
  durationMs?: number;
  properties?: Record<string, string | number | boolean | null>;
};

export type AnalyticsEnvelope = AnalyticsEventInput & {
  eventId: string;
  eventVersion: 1;
  occurredAt: string;
  sessionId: string;
  platform: string;
  appVersion: string;
};
