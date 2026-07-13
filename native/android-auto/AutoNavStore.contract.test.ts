import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./AutoNavStore.kt', import.meta.url), 'utf8');
const carSession = readFileSync(new URL('./VroomCarSession.kt', import.meta.url), 'utf8');

describe('Android Auto trip checkpoint contract', () => {
  it('keeps every offline kilometre in the session checkpoint ledger', () => {
    expect(source).toContain('KEY_PENDING_DRIVE_KM');
    expect(source).not.toContain('DRIVE_PENDING_HARD_CAP_KM');
    expect(source).not.toContain('"/api/live/distance"');
    expect(source).toContain('"/api/activity/session/checkpoint"');
    expect(source).toContain('tripSessionId');
  });

  it('retries a durable checkpoint without overwriting newer GPS distance', () => {
    expect(source).toContain('isNativeTripCheckpointInFlight');
    expect(source).toContain('latestPendingKm');
    expect(source).toContain('confirmedDelta');
    expect(source).toContain('maybeUploadNativeTripCheckpoint(prefs(context), token, force = true)');
  });

  it('makes Android Auto the only distance owner while its session is active', () => {
    expect(source).toContain('KEY_AUTO_DISTANCE_OWNER_GENERATION');
    expect(source).toContain('fun setNativeDistanceOwner(context: Context, active: Boolean)');
    expect(source).toContain('.remove(KEY_LAST_TRACK_TS)');
    expect(carSession).toContain('AutoNavStore.setNativeDistanceOwner(carContext, true)');
    expect(carSession).toContain('AutoNavStore.setNativeDistanceOwner(carContext, false)');
  });
});
