import { describe, expect, it } from 'vitest';
import {
  beginResumeRecovery,
  canBypassGpsLockDuringResume,
  classifyFixFreshness,
  createResumeRecoveryState,
  markResumeSourceAccepted,
  quarantineHudSpeedKmh,
  resolveResumeSpeedKmh,
  shouldAcceptResumeSource,
} from './resumeRecovery';

describe('resumeRecovery', () => {
  it('caps the first resume speed spike instead of accepting a buffered jump', () => {
    const state = createResumeRecoveryState();
    beginResumeRecovery(state, {
      now: 10_000,
      bgPauseMs: 180_000,
      seedFixTimestamp: 10_000,
      lastReliableSpeedKmh: 50,
    });

    const out = resolveResumeSpeedKmh(
      {
        latitude: 52.00135,
        longitude: 21,
        timestamp: 11_000,
        speed: null,
      },
      {
        latitude: 52,
        longitude: 21,
        timestamp: 10_000,
      },
      state,
      { now: 11_000, previousReliableKmh: 50 },
    );

    expect(out.speedKmh).toBeLessThanOrEqual(78);
    expect(out.reliable).toBe(false);
    expect(out.source).toBe('held');
  });

  it('keeps HUD speed quarantined until foreground fixes confirm acceleration', () => {
    const state = createResumeRecoveryState();
    beginResumeRecovery(state, {
      now: 10_000,
      bgPauseMs: 180_000,
      lastReliableSpeedKmh: 52,
    });

    expect(quarantineHudSpeedKmh(state, 150, { now: 10_100 })).toBe(52);
    expect(quarantineHudSpeedKmh(state, 60, { now: 10_600 })).toBe(60);
  });

  it('prevents native and Expo sources from racing in the same resume window', () => {
    const state = createResumeRecoveryState();
    beginResumeRecovery(state, {
      now: 10_000,
      bgPauseMs: 180_000,
      lastReliableSpeedKmh: 40,
    });

    expect(shouldAcceptResumeSource(state, 'native', 10_050)).toBe(true);
    markResumeSourceAccepted(state, 'native', 10_050);
    expect(shouldAcceptResumeSource(state, 'expo', 10_200, { nativeFreshMs: 150 })).toBe(false);
    expect(shouldAcceptResumeSource(state, 'expo', 11_500, { nativeFreshMs: 1450 })).toBe(true);
  });

  it('treats old native lastKnown as a seed, not a live UI fix', () => {
    const now = 180_000;
    expect(classifyFixFreshness({
      latitude: 52,
      longitude: 21,
      timestamp: now - 45_000,
      source: 'lastKnown',
      isSeed: true,
    }, now)).toBe('seed');
    expect(classifyFixFreshness({
      latitude: 52,
      longitude: 21,
      timestamp: now - 180_000,
      source: 'lastKnown',
      isSeed: true,
    }, now)).toBe('stale');
  });

  it('allows the first fresh foreground fix to bypass GPS lock during resume', () => {
    const state = createResumeRecoveryState();
    beginResumeRecovery(state, {
      now: 20_000,
      bgPauseMs: 180_000,
      lastReliableSpeedKmh: 50,
    });

    expect(canBypassGpsLockDuringResume({
      latitude: 52,
      longitude: 21,
      timestamp: 20_100,
      accuracy: 12,
      source: 'live',
    }, state, { now: 20_200 })).toBe(true);

    expect(canBypassGpsLockDuringResume({
      latitude: 52,
      longitude: 21,
      timestamp: 20_100,
      accuracy: 120,
      source: 'live',
    }, state, { now: 20_200 })).toBe(false);
  });

  it('does not let a seen but unaccepted Expo fix block a native fix', () => {
    const state = createResumeRecoveryState();
    beginResumeRecovery(state, {
      now: 30_000,
      bgPauseMs: 180_000,
      lastReliableSpeedKmh: 50,
    });
    state.lastExpoSeenAt = 30_100;

    expect(shouldAcceptResumeSource(state, 'native', 30_200, {
      expoFreshMs: 100,
    })).toBe(true);
  });
});
