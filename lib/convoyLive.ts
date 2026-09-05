import type { PublicUserIdentity } from '../components/user/PremiumIdentity';

export type ConvoyRoute = {
  id: number;
  name: string;
  isOffroad?: boolean;
  points?: { latitude: number; longitude: number; order?: number }[];
  waypoints?: { latitude: number; longitude: number; order?: number; label?: string | null }[];
};

export type ConvoyPosition = {
  userId?: number;
  lat: number;
  lng: number;
  heading?: number | null;
  speedKmh?: number | null;
  at?: number;
};

export type ConvoyParticipant = {
  userId: number;
  role: string;
  quickStatus?: string | null;
  connection?: string;
  convoyHostId?: number;
  user: PublicUserIdentity & { avatarFrameUrl?: string | null };
  position?: ConvoyPosition | null;
  voiceMuted?: boolean;
  voiceApproved?: boolean;
};

export type ConvoyStatusEvent = {
  eventId?: string;
  convoyId?: string;
  userId: number;
  status: string;
  sentAt?: string | number;
  connection?: string;
};

export type ConvoyPlanEvent = {
  eventId?: string;
  convoyId?: string;
  actorId: number;
  sentAt?: string | number;
  changed?: Array<'route' | 'meeting'>;
  routeId?: number | null;
  meetingLat?: number | null;
  meetingLng?: number | null;
};

export type ConvoySnapshot = {
  convoy: {
    id: string;
    code: string;
    name: string;
    hostId: number;
    status: string;
    maxParticipants?: number;
    expiresAt: string;
    route?: ConvoyRoute | null;
    meetingLat?: number | null;
    meetingLng?: number | null;
    voiceEnabled: boolean;
    voiceMode: 'open' | 'cb' | 'moderated';
    admissionMode: 'instant' | 'lobby';
  };
  participants: ConvoyParticipant[];
  waiting?: ConvoyParticipant[];
  summary?: { participantCount: number; stats?: unknown; visibleUntil: string } | null;
};

export const CONVOY_STATUS_LABELS: Record<string, string> = {
  ok: 'OK',
  fuel: 'TANKOWANIE',
  stop: 'POSTÓJ',
  lost: 'ZGUBIŁEM GRUPĘ',
  problem: 'PROBLEM',
};
