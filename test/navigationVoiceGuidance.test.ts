import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import type { Step } from '../hooks/useGoogleDirections';
import {
  adaptiveGuidanceThresholds,
  buildAdaptiveNavigationSpeech,
  getAdaptiveGuidancePhase,
  resolvePreferredPolishVoice,
  shouldChainFollowingManeuver,
  voicePreferencesFromLegacySpeechValue,
} from '../lib/navigation/voiceGuidanceCore';

const turnRight = {
  maneuver: 'turn-right',
  maneuverModifier: 'right',
  html_instructions: 'Turn right',
  distance: { text: '400 m', value: 400 },
} as Step;

describe('adaptive navigation voice guidance', () => {
  it('uses the current CarPlay speech helper on navigation start', () => {
    const coordinator = fs.readFileSync(
      path.join(
        process.cwd(),
        'modules/vroom-carplay/ios/VroomCarPlayCoordinator.swift',
      ),
      'utf8',
    );
    expect(coordinator).not.toContain('speakIfNeeded(');
    expect(coordinator).toContain('key: "navigation-start"');
  });

  it.each([
    [30, 250, 35],
    [50, 347, 56],
    [90, 625, 100],
    [120, 833, 120],
  ])('calculates clamped prepare/now thresholds at %i km/h', (
    speedKmh,
    prepareM,
    nowM,
  ) => {
    const thresholds = adaptiveGuidanceThresholds(speedKmh, turnRight);
    expect(thresholds.prepareM).toBe(prepareM);
    expect(thresholds.nowM).toBe(nowM);
  });

  it('adds the middle cue only at high speed or for a complex maneuver', () => {
    expect(adaptiveGuidanceThresholds(50, turnRight).approachM).toBeNull();
    expect(adaptiveGuidanceThresholds(90, turnRight).approachM).toBe(250);
    expect(adaptiveGuidanceThresholds(50, {
      ...turnRight,
      maneuver: 'roundabout',
    }).approachM).toBe(139);
  });

  it('does not miss the now cue when GPS jumps over multiple thresholds', () => {
    expect(getAdaptiveGuidancePhase({
      distanceM: 25,
      previousDistanceM: 700,
      speedKmh: 90,
      step: turnRight,
    })).toBe('now');
  });

  it('chains close maneuvers and says potem only once in the early cue', () => {
    const next = {
      ...turnRight,
      maneuver: 'turn-left',
      maneuverModifier: 'left',
      html_instructions: 'Turn left',
    } as Step;
    expect(shouldChainFollowingManeuver(180, 50)).toBe(true);
    expect(shouldChainFollowingManeuver(220, 90)).toBe(true);
    expect(shouldChainFollowingManeuver(400, 50)).toBe(false);
    expect(buildAdaptiveNavigationSpeech({
      step: turnRight,
      distanceM: 350,
      phase: 'prepare',
      followingStep: next,
      followingDistanceM: 120,
      speedKmh: 50,
    }).toLowerCase()).toContain('potem');
    expect(buildAdaptiveNavigationSpeech({
      step: turnRight,
      distanceM: 40,
      phase: 'now',
      followingStep: next,
      followingDistanceM: 120,
      speedKmh: 50,
    }).toLowerCase()).not.toContain('potem');
  });

  it('prefers an enhanced Polish voice and falls back from a removed manual voice', () => {
    const voices = [
      { identifier: 'en-basic', language: 'en-US', name: 'English', quality: 'Enhanced' },
      { identifier: 'pl-basic', language: 'pl-PL', name: 'Polski 1', quality: 'Default' },
      { identifier: 'pl-enhanced', language: 'pl_PL', name: 'Polski 2', quality: 'Enhanced' },
    ];
    expect(resolvePreferredPolishVoice(voices, {
      guidanceEnabled: true,
      alertsEnabled: true,
      mode: 'auto',
      voiceIdentifier: null,
    })?.identifier).toBe('pl-enhanced');
    expect(resolvePreferredPolishVoice(voices, {
      guidanceEnabled: true,
      alertsEnabled: true,
      mode: 'manual',
      voiceIdentifier: 'removed',
    })?.identifier).toBe('pl-enhanced');
    expect(resolvePreferredPolishVoice(voices, {
      guidanceEnabled: true,
      alertsEnabled: true,
      mode: 'manual',
      voiceIdentifier: 'pl-basic',
    })?.identifier).toBe('pl-basic');
  });

  it('migrates the old master mute without unmuting the user', () => {
    expect(voicePreferencesFromLegacySpeechValue('0')).toMatchObject({
      guidanceEnabled: false,
      alertsEnabled: false,
    });
    expect(voicePreferencesFromLegacySpeechValue('1')).toMatchObject({
      guidanceEnabled: true,
      alertsEnabled: true,
    });
  });
});
