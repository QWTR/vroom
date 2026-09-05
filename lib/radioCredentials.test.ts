import { describe, expect, it } from 'vitest';
import { normalizeRadioCredentials, radioUserIdFromRelay } from './radioCredentials';

const credential = (roomName: string) => ({
  token: `token-${roomName}`,
  serverUrl: 'wss://voice.v-room.app',
  roomName,
});

describe('normalizeRadioCredentials', () => {
  it('accepts a private single-room response', () => {
    const result = normalizeRadioCredentials(credential('private-room'), 'private');
    expect(result.publisher.roomName).toBe('private-room');
    expect(result.listeners).toEqual([]);
    expect(result.usesPublicRelay).toBe(false);
  });

  it('accepts the public uplink/downlinks contract', () => {
    const result = normalizeRadioCredentials({
      uplink: credential('uplink'),
      downlinks: [credential('down-1'), credential('down-2')],
    }, 'global');
    expect(result.publisher.roomName).toBe('uplink');
    expect(result.listeners.map((row) => row.roomName)).toEqual(['down-1', 'down-2']);
    expect(result.usesPublicRelay).toBe(true);
  });

  it('rejects the old single-room shape for public channels with a useful error', () => {
    expect(() => normalizeRadioCredentials(credential('old-room'), 'city'))
      .toThrow('danych nadawania publicznego');
  });

  it('rejects a non-array downlinks value instead of iterating an object', () => {
    expect(() => normalizeRadioCredentials({ uplink: credential('uplink'), downlinks: {} }, 'global'))
      .toThrow('kanałów odbiorczych');
  });
});

describe('radioUserIdFromRelay', () => {
  it('reads direct and relayed speaker identities', () => {
    expect(radioUserIdFromRelay('user:12')).toBe(12);
    expect(radioUserIdFromRelay('relay-out:node-a:34')).toBe(34);
    expect(radioUserIdFromRelay('unknown', 'speaker-56')).toBe(56);
  });
});
