import { describe, expect, it } from 'vitest';
import { extractLiveUsersPayload, parseLiveUsersPayload } from './liveUsersPayload';

describe('extractLiveUsersPayload', () => {
  const user = { id: 7, lat: 51.1, lng: 19.4 };

  it('accepts the legacy bare array', () => {
    expect(extractLiveUsersPayload([user])).toEqual([user]);
  });

  it('accepts API and socket envelopes', () => {
    expect(extractLiveUsersPayload({ users: [user] })).toEqual([user]);
    expect(extractLiveUsersPayload({ data: { users: [user] } })).toEqual([user]);
    expect(extractLiveUsersPayload({ data: [user] })).toEqual([user]);
  });

  it('turns malformed payloads into an empty list', () => {
    expect(extractLiveUsersPayload(null)).toEqual([]);
    expect(extractLiveUsersPayload({ users: null })).toEqual([]);
    expect(extractLiveUsersPayload({ users: ['bad', null] })).toEqual([]);
  });

  it('normalizes deployed field aliases and rejects bad coordinates', () => {
    expect(parseLiveUsersPayload({ users: [{
      userId: '12',
      name: 'Kierowca',
      avatar: '/avatar.jpg',
      latitude: '52.1',
      longitude: '19.3',
    }] })).toEqual([expect.objectContaining({
      id: 12,
      username: 'Kierowca',
      avatarUrl: '/avatar.jpg',
      lat: 52.1,
      lng: 19.3,
    })]);
    expect(parseLiveUsersPayload({ data: { users: [{
      id: 13,
      username: 'Drugi',
      location: { lat: 50.8, lng: 20.1 },
    }] } })).toEqual([expect.objectContaining({ id: 13, lat: 50.8, lng: 20.1 })]);
    expect(parseLiveUsersPayload([{ id: 2, lat: 120, lng: 19 }])).toEqual([]);
    expect(parseLiveUsersPayload([{ id: null, lat: null, lng: null }])).toEqual([]);
  });

  it('accepts a single socket event and serialized legacy snapshots', () => {
    expect(parseLiveUsersPayload({ userId: '8', latitude: 51, longitude: 19, name: 'Ola' }))
      .toMatchObject([{ id: 8, lat: 51, lng: 19, username: 'Ola' }]);
    expect(parseLiveUsersPayload(JSON.stringify({
      users: [{ id: 9, lat: 52, lng: 20, username: 'Jan' }],
    }))).toMatchObject([{ id: 9, lat: 52, lng: 20, username: 'Jan' }]);
  });
});
