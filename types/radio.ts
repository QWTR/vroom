import type { PublicUserIdentity } from '../components/user/PremiumIdentity';

export type RadioMode = 'global' | 'city' | 'private';
export type RadioTransmitMode = 'ptt' | 'vad';
export type PrivateVoiceMode = 'open' | 'cb' | 'moderated';

export type RadioPreferences = {
  radiusKm: number;
  citySlug: string | null;
  transmitMode: RadioTransmitMode;
  vadSensitivity: number;
};

export type RadioParticipant = {
  userId: number;
  user: PublicUserIdentity;
  role: 'host' | 'moderator' | 'participant' | string;
  speaking: boolean;
  transmitMode: RadioTransmitMode;
};

export type RadioSnapshot = {
  selfUserId: number;
  active: {
    mode: RadioMode;
    key: string;
    title: string;
    radiusKm?: number;
    citySlug?: string;
    convoyId?: string;
    voiceMode?: PrivateVoiceMode;
    roomName: string;
    downlinkRooms?: string[];
  };
  participants: RadioParticipant[];
  speakers: RadioParticipant[];
  pendingSpeakerIds: number[];
  serverAt: number;
  generation?: number;
  mutedOnConnect?: boolean;
};

export type RadioConfig = {
  flags: { enabled: boolean; global: boolean; city: boolean; private: boolean; publicRelay?: boolean; beta: boolean };
  voiceConfigured: boolean;
  preferences: RadioPreferences;
  active: RadioSnapshot | null;
  limits: {
    radiusMinKm: number;
    radiusMaxKm: number;
    publicSpeakers: number;
    privateOpenSpeakers: number;
    publicTransmitSeconds: number;
    publicCooldownSeconds: number;
  };
};

export type RadioCity = { slug: string; name: string; voivodeship: string | null };
