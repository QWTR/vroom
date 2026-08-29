import type { PublicUserIdentity } from '../components/user/PremiumIdentity';

export type ConvoyRoute = {
  id: number;
  name: string;
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
  user: PublicUserIdentity;
  position?: ConvoyPosition | null;
};

export type ConvoySnapshot = {
  convoy: {
    id: string;
    code: string;
    name: string;
    hostId: number;
    status: string;
    expiresAt: string;
    route?: ConvoyRoute | null;
    meetingLat?: number | null;
    meetingLng?: number | null;
  };
  participants: ConvoyParticipant[];
  summary?: { participantCount: number; stats?: unknown; visibleUntil: string } | null;
};

export const CONVOY_STATUS_LABELS: Record<string, string> = {
  ok: 'OK',
  fuel: 'TANKOWANIE',
  stop: 'POSTÓJ',
  lost: 'ZGUBIŁEM GRUPĘ',
  problem: 'PROBLEM',
};
