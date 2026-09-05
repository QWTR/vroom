import type {
  ConvoyParticipant,
  ConvoyPlanEvent,
  ConvoySnapshot,
  ConvoyStatusEvent,
} from './convoyLive';
import { CONVOY_STATUS_LABELS } from './convoyLive';

export type ConvoyNoticeAction = 'meeting' | 'route';

export type ConvoyMapNotice = {
  id: string;
  kind: 'status' | 'meeting' | 'route';
  actorId: number;
  actorName: string;
  title: string;
  message: string;
  status?: string;
  action?: ConvoyNoticeAction;
  critical: boolean;
  playSound: boolean;
  sentAt: number;
};

export type ConvoyMarkerPresentation = {
  text: string;
  color: string;
  paused: boolean;
};

export type ConvoyNavigationPoint = {
  latitude: number;
  longitude: number;
  name: string;
};

export type ConvoyRouteIntent = {
  routeId: number;
  routeName: string;
  isOffroad: boolean;
  personalStart: ConvoyNavigationPoint;
  sharedStart: ConvoyNavigationPoint;
  sharedEnd: ConvoyNavigationPoint;
  points: { latitude: number; longitude: number }[];
};

const NOTICE_FRESHNESS_MS = 15_000;
const MAX_NOTICE_QUEUE = 3;

function eventTime(value: string | number | undefined, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function actorName(participants: ConvoyParticipant[], id: number): string {
  return participants.find((participant) => participant.userId === id)?.user.username || 'Uczestnik konwoju';
}

export function convoyStatusColor(status: string | null | undefined): string {
  if (status === 'problem') return '#FF5A5F';
  if (status === 'lost') return '#FF922B';
  if (status === 'fuel') return '#FFD447';
  if (status === 'stop') return '#52A7FF';
  return '#38E54D';
}

export function resolveConvoyMarkerPresentation(
  participant: ConvoyParticipant,
): ConvoyMarkerPresentation {
  if (participant.connection === 'paused') {
    return { text: 'WSTRZYMANY', color: '#FF922B', paused: true };
  }

  const status = participant.quickStatus || 'ok';
  const statusLabel = CONVOY_STATUS_LABELS[status] || status.toUpperCase();
  const roleLabel = participant.userId === participant.convoyHostId || participant.role === 'host'
    ? 'PROWADZĄCY'
    : participant.role === 'moderator'
      ? 'MODERATOR'
      : 'KONWÓJ';
  const color = status !== 'ok'
    ? convoyStatusColor(status)
    : roleLabel === 'PROWADZĄCY'
      ? '#FFD447'
      : roleLabel === 'MODERATOR'
        ? '#18D7A0'
        : '#31C8FF';

  return { text: `${roleLabel} · ${statusLabel}`, color, paused: false };
}

export function noticeFromStatusEvent({
  event,
  participants,
  currentUserId,
  now = Date.now(),
  foregroundSince = 0,
}: {
  event: ConvoyStatusEvent;
  participants: ConvoyParticipant[];
  currentUserId: number;
  now?: number;
  foregroundSince?: number;
}): ConvoyMapNotice | null {
  const sentAt = eventTime(event.sentAt, now);
  if (event.userId === currentUserId || sentAt < foregroundSince || now - sentAt > NOTICE_FRESHNESS_MS) return null;
  const name = actorName(participants, event.userId);
  const label = CONVOY_STATUS_LABELS[event.status] || event.status.toUpperCase();
  return {
    id: event.eventId || `status:${event.convoyId || 'active'}:${event.userId}:${event.status}:${sentAt}`,
    kind: 'status',
    actorId: event.userId,
    actorName: name,
    title: name,
    message: label,
    status: event.status,
    critical: event.status === 'problem' || event.status === 'lost',
    playSound: true,
    sentAt,
  };
}

export function noticeFromPlanEvent({
  event,
  participants,
  currentUserId,
  now = Date.now(),
  foregroundSince = 0,
}: {
  event: ConvoyPlanEvent;
  participants: ConvoyParticipant[];
  currentUserId: number;
  now?: number;
  foregroundSince?: number;
}): ConvoyMapNotice | null {
  const sentAt = eventTime(event.sentAt, now);
  if (event.actorId === currentUserId || sentAt < foregroundSince || now - sentAt > NOTICE_FRESHNESS_MS) return null;
  const change = event.changed?.includes('meeting')
    ? 'meeting'
    : event.changed?.includes('route')
      ? 'route'
      : null;
  if (!change) return null;
  const name = actorName(participants, event.actorId);
  return {
    id: event.eventId || `plan:${event.convoyId || 'active'}:${event.actorId}:${change}:${sentAt}`,
    kind: change,
    actorId: event.actorId,
    actorName: name,
    title: name,
    message: change === 'meeting' ? 'Ustawił nowy punkt zbiórki' : 'Zmienił trasę konwoju',
    action: change,
    critical: false,
    playSound: true,
    sentAt,
  };
}

export function enqueueConvoyNotice(
  queue: ConvoyMapNotice[],
  notice: ConvoyMapNotice,
): ConvoyMapNotice[] {
  if (queue.some((item) => item.id === notice.id)) return queue;
  return [...queue, notice].slice(-MAX_NOTICE_QUEUE);
}

export function mergeLiveAndConvoyUserIds(
  liveUserIds: number[],
  convoyParticipants: ConvoyParticipant[],
  selfUserId: number | string | null,
): number[] {
  const ids = new Set([...liveUserIds, ...convoyParticipants.map((participant) => participant.userId)]);
  return [...ids].filter((id) => String(id) !== String(selfUserId));
}

export function buildConvoyMeetingIntent(
  snapshot: ConvoySnapshot | null,
  location: { latitude: number; longitude: number } | null,
): { start: ConvoyNavigationPoint; end: ConvoyNavigationPoint } | null {
  const rawLat = snapshot?.convoy.meetingLat;
  const rawLng = snapshot?.convoy.meetingLng;
  if (rawLat == null || rawLng == null || !location) return null;
  const latitude = Number(rawLat);
  const longitude = Number(rawLng);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return {
    start: { ...location, name: 'Moja pozycja' },
    end: { latitude, longitude, name: 'Punkt zbiórki konwoju' },
  };
}

export function buildConvoyRouteIntent(
  snapshot: ConvoySnapshot | null,
  location: { latitude: number; longitude: number } | null,
): ConvoyRouteIntent | null {
  const route = snapshot?.convoy.route;
  if (!route || !location) return null;
  const points = (route.points ?? [])
    .slice()
    .sort((a, b) => Number(a.order ?? 0) - Number(b.order ?? 0))
    .map((point) => ({ latitude: Number(point.latitude), longitude: Number(point.longitude) }))
    .filter((point) => Number.isFinite(point.latitude) && Number.isFinite(point.longitude));
  if (points.length < 2) return null;
  return {
    routeId: route.id,
    routeName: route.name,
    isOffroad: route.isOffroad === true,
    personalStart: { ...location, name: 'Moja pozycja' },
    sharedStart: { ...points[0], name: 'Start trasy konwoju' },
    sharedEnd: { ...points[points.length - 1], name: route.name || 'Trasa konwoju' },
    points,
  };
}

export function resolveConvoyHudOffsets({
  controlsTop,
  primaryHeight,
  dockHeight,
  noticeHeight,
  alertHeight = 0,
  navigating,
}: {
  controlsTop: number;
  primaryHeight: number;
  dockHeight: number;
  noticeHeight: number;
  alertHeight?: number;
  navigating: boolean;
}) {
  const minimumPrimaryHeight = navigating ? 120 : 44;
  const safePrimaryHeight = primaryHeight >= minimumPrimaryHeight ? primaryHeight : navigating ? 176 : 52;
  const dockTop = controlsTop + safePrimaryHeight + 8;
  const dockBottom = dockTop + Math.max(0, dockHeight);
  const noticeTop = dockBottom + 8;
  const stackBottom = noticeTop + Math.max(0, noticeHeight);
  const alertTop = stackBottom + 8;
  const finalStackBottom = alertTop + Math.max(0, alertHeight);
  return {
    dockTop,
    noticeTop,
    alertTop,
    speedPanelTop: Math.max(navigating ? 188 : 160, finalStackBottom + 10),
  };
}
