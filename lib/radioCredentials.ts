import type { RadioMode } from '../types/radio';

export type RadioRoomCredential = {
  token: string;
  serverUrl: string;
  roomName?: string;
  expiresIn?: number;
};

export type RadioTokenResponse = RadioRoomCredential & {
  uplink?: RadioRoomCredential;
  downlinks?: RadioRoomCredential[];
  mutedOnConnect?: boolean;
  channel?: { mode?: RadioMode; title?: string; key?: string };
};

export type NormalizedRadioCredentials = {
  publisher: RadioRoomCredential;
  listeners: RadioRoomCredential[];
  usesPublicRelay: boolean;
};

function validCredential(value: unknown): value is RadioRoomCredential {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<RadioRoomCredential>;
  return typeof candidate.token === 'string'
    && candidate.token.length > 0
    && typeof candidate.serverUrl === 'string'
    && /^wss?:\/\//i.test(candidate.serverUrl);
}

function validNamedCredential(value: unknown): value is RadioRoomCredential & { roomName: string } {
  return validCredential(value)
    && typeof value.roomName === 'string'
    && value.roomName.length > 0;
}

export function normalizeRadioCredentials(
  payload: unknown,
  mode: RadioMode,
): NormalizedRadioCredentials {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Serwer CB zwrócił nieprawidłową odpowiedź połączenia.');
  }

  const response = payload as RadioTokenResponse;
  if (mode === 'private') {
    if (!validCredential(response)) {
      throw new Error('Serwer CB nie zwrócił danych prywatnego kanału audio.');
    }
    return { publisher: response, listeners: [], usesPublicRelay: false };
  }

  if (!validNamedCredential(response.uplink)) {
    throw new Error('Serwer CB nie zwrócił danych nadawania publicznego.');
  }
  if (!Array.isArray(response.downlinks) || response.downlinks.length === 0) {
    throw new Error('Serwer CB nie zwrócił kanałów odbiorczych.');
  }
  if (!response.downlinks.every(validNamedCredential)) {
    throw new Error('Serwer CB zwrócił nieprawidłowy kanał odbiorczy.');
  }

  return {
    publisher: response.uplink,
    listeners: response.downlinks,
    usesPublicRelay: true,
  };
}

export function radioUserIdFromRelay(
  identity: string,
  trackName?: string,
): number | null {
  const direct = /^user:(\d+)$/.exec(String(identity || ''));
  if (direct) return Number(direct[1]);
  const relay = /:(\d+)$/.exec(String(identity || ''));
  if (/^relay-out:/.test(String(identity || '')) && relay) return Number(relay[1]);
  const track = /^speaker-(\d+)$/.exec(String(trackName || ''));
  return track ? Number(track[1]) : null;
}
