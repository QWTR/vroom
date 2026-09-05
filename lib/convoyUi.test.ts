import { describe, expect, it } from 'vitest';
import type { ConvoyParticipant } from './convoyLive';
import {
  buildConvoyMeetingIntent,
  buildConvoyRouteIntent,
  enqueueConvoyNotice,
  mergeLiveAndConvoyUserIds,
  noticeFromPlanEvent,
  noticeFromStatusEvent,
  resolveConvoyHudOffsets,
  resolveConvoyMarkerPresentation,
} from './convoyUi';

const participant = (patch: Partial<ConvoyParticipant> = {}): ConvoyParticipant => ({
  userId: 7,
  role: 'participant',
  quickStatus: 'ok',
  connection: 'live',
  user: { id: 7, username: 'Anna' },
  ...patch,
});

describe('convoy map UI', () => {
  it('prioritizes paused and urgent convoy status', () => {
    expect(resolveConvoyMarkerPresentation(participant({ connection: 'paused' })).text).toBe('WSTRZYMANY');
    expect(resolveConvoyMarkerPresentation(participant({ role: 'moderator', quickStatus: 'problem' }))).toMatchObject({
      text: 'MODERATOR · PROBLEM',
      color: '#FF5A5F',
    });
  });

  it('ignores own and stale realtime notices', () => {
    const now = Date.now();
    expect(noticeFromStatusEvent({
      event: { userId: 7, status: 'fuel', sentAt: now }, participants: [participant()], currentUserId: 7, now,
    })).toBeNull();
    expect(noticeFromStatusEvent({
      event: { userId: 7, status: 'fuel', sentAt: now - 20_000 }, participants: [participant()], currentUserId: 8, now,
    })).toBeNull();
    expect(noticeFromStatusEvent({
      event: { userId: 7, status: 'fuel', sentAt: now - 500 }, participants: [participant()], currentUserId: 8, now,
      foregroundSince: now,
    })).toBeNull();
  });

  it('creates a fresh plan alert with a navigation action for other participants', () => {
    const now = Date.now();
    expect(noticeFromPlanEvent({
      event: { eventId: 'evt-plan', convoyId: 'c1', actorId: 7, changed: ['route'], sentAt: now },
      participants: [participant()], currentUserId: 8, now,
    })).toMatchObject({ id: 'evt-plan', kind: 'route', action: 'route', playSound: true });
  });

  it('deduplicates and caps the notice queue', () => {
    const make = (id: string) => ({
      id, kind: 'status' as const, actorId: 7, actorName: 'Anna', title: 'Anna', message: 'OK',
      critical: false, playSound: true, sentAt: 1,
    });
    let queue = enqueueConvoyNotice([], make('1'));
    queue = enqueueConvoyNotice(queue, make('1'));
    queue = enqueueConvoyNotice(queue, make('2'));
    queue = enqueueConvoyNotice(queue, make('3'));
    queue = enqueueConvoyNotice(queue, make('4'));
    expect(queue.map((item) => item.id)).toEqual(['2', '3', '4']);
  });

  it('places each measured HUD element below the previous one', () => {
    expect(resolveConvoyHudOffsets({ controlsTop: 12, primaryHeight: 180, dockHeight: 54, noticeHeight: 68, navigating: true }))
      .toEqual({ dockTop: 200, noticeTop: 262, alertTop: 338, speedPanelTop: 348 });
    expect(resolveConvoyHudOffsets({ controlsTop: 12, primaryHeight: 52, dockHeight: 54, noticeHeight: 0, navigating: true }).dockTop)
      .toBe(196);
  });

  it('uses each participant GPS for approach while keeping the same shared route', () => {
    const snapshot = {
      convoy: {
        id: 'c1', code: 'ABC', name: 'Test', hostId: 7, status: 'active', expiresAt: '',
        voiceEnabled: true, voiceMode: 'open' as const, admissionMode: 'instant' as const,
        route: { id: 3, name: 'Wspólna', points: [
          { latitude: 52, longitude: 21, order: 0 },
          { latitude: 53, longitude: 22, order: 1 },
        ] },
      },
      participants: [],
    };
    const anna = buildConvoyRouteIntent(snapshot, { latitude: 50, longitude: 19 });
    const jan = buildConvoyRouteIntent(snapshot, { latitude: 51, longitude: 20 });
    expect(anna?.personalStart).toMatchObject({ latitude: 50, longitude: 19 });
    expect(jan?.personalStart).toMatchObject({ latitude: 51, longitude: 20 });
    expect(anna?.sharedStart).toEqual(jan?.sharedStart);
  });

  it('deduplicates LIVE and convoy marker ids and rejects an unset meeting point', () => {
    expect(mergeLiveAndConvoyUserIds([7, 8], [participant(), participant({ userId: 9, user: { id: 9, username: 'Jan' } })], 8))
      .toEqual([7, 9]);
    expect(buildConvoyMeetingIntent(null, { latitude: 52, longitude: 21 })).toBeNull();
  });
});
