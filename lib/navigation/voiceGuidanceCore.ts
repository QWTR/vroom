import type { Step } from '../../hooks/useGoogleDirections';
import {
  buildNavigationSpeech,
  formatNavigationInstruction,
} from '../../scripts/navigationUtils';

export type AdaptiveGuidancePhase = 'prepare' | 'approach' | 'now';

export type AdaptiveGuidanceThresholds = {
  prepareM: number;
  approachM: number | null;
  nowM: number;
};

export type NavigationVoiceCategory =
  | 'critical'
  | 'maneuver-now'
  | 'warning'
  | 'maneuver'
  | 'info';

export type VoiceCandidate = {
  identifier: string;
  language: string;
  name: string;
  quality?: string | null;
};

export type VoicePreferences = {
  guidanceEnabled: boolean;
  alertsEnabled: boolean;
  mode: 'auto' | 'manual';
  voiceIdentifier: string | null;
};

export const DEFAULT_VOICE_PREFERENCES: VoicePreferences = {
  guidanceEnabled: true,
  alertsEnabled: true,
  mode: 'auto',
  voiceIdentifier: null,
};

export function voicePreferencesFromLegacySpeechValue(
  legacyValue: string | null | undefined,
): VoicePreferences {
  const enabled = legacyValue == null ? true : legacyValue === '1';
  return {
    ...DEFAULT_VOICE_PREFERENCES,
    guidanceEnabled: enabled,
    alertsEnabled: enabled,
  };
}

export const VOICE_PRIORITY: Record<NavigationVoiceCategory, number> = {
  critical: 100,
  'maneuver-now': 90,
  warning: 70,
  maneuver: 50,
  info: 20,
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function isComplexManeuver(step: Step | null | undefined): boolean {
  const maneuver = `${step?.maneuver ?? ''} ${step?.maneuverModifier ?? ''}`.toLowerCase();
  return [
    'roundabout',
    'rotary',
    'fork',
    'ramp',
    'sharp',
    'uturn',
    'u-turn',
  ].some((token) => maneuver.includes(token));
}

export function adaptiveGuidanceThresholds(
  speedKmh: number,
  step?: Step | null,
): AdaptiveGuidanceThresholds {
  const speedMps = Math.max(0, Number.isFinite(speedKmh) ? speedKmh / 3.6 : 0);
  const complex = isComplexManeuver(step);
  return {
    prepareM: Math.round(clamp(speedMps * 25, 250, 900)),
    approachM: speedKmh >= 70 || complex
      ? Math.round(clamp(speedMps * 10, 100, 300))
      : null,
    nowM: Math.round(clamp(speedMps * 4, 35, 120)),
  };
}

export function getAdaptiveGuidancePhase(input: {
  distanceM: number;
  previousDistanceM?: number;
  speedKmh: number;
  step?: Step | null;
}): AdaptiveGuidancePhase | null {
  const { distanceM, previousDistanceM, speedKmh, step } = input;
  if (!Number.isFinite(distanceM) || distanceM < 0) return null;
  const thresholds = adaptiveGuidanceThresholds(speedKmh, step);
  const crossed = (threshold: number) => (
    previousDistanceM == null
      ? distanceM <= threshold
      : previousDistanceM > threshold && distanceM <= threshold
  );

  if (crossed(thresholds.nowM)) return 'now';
  if (thresholds.approachM != null && crossed(thresholds.approachM)) return 'approach';
  if (crossed(thresholds.prepareM)) return 'prepare';
  return null;
}

export function shouldChainFollowingManeuver(
  followingDistanceM: number | null | undefined,
  speedKmh: number,
): boolean {
  if (followingDistanceM == null || !Number.isFinite(followingDistanceM)) return false;
  const speedMps = Math.max(2, speedKmh / 3.6);
  return followingDistanceM <= 180 || followingDistanceM / speedMps <= 15;
}

export function buildAdaptiveNavigationSpeech(input: {
  step: Step;
  distanceM: number;
  phase: AdaptiveGuidancePhase;
  followingStep?: Step | null;
  followingDistanceM?: number | null;
  speedKmh: number;
}): string {
  const legacyPhase = input.phase === 'now'
    ? 'now'
    : input.phase === 'approach'
      ? 'far150'
      : 'far400';
  const primary = buildNavigationSpeech(input.step, input.distanceM, legacyPhase);
  if (
    !primary
    || input.phase === 'now'
    || !input.followingStep
    || !shouldChainFollowingManeuver(input.followingDistanceM, input.speedKmh)
  ) {
    return primary;
  }
  const following = formatNavigationInstruction(input.followingStep);
  if (!following) return primary;
  return `${primary}. Potem ${following.charAt(0).toLowerCase()}${following.slice(1)}`;
}

export function isCriticalWarning(type: string, subtype?: string | null): boolean {
  const key = `${type} ${subtype ?? ''}`.toLowerCase();
  return [
    'accident',
    'collision',
    'road_blocked',
    'blocked_lane',
    'animal',
    'on_road',
    'obstacle',
    'flooding',
    'slippery',
    'breakdown lane',
  ].some((token) => key.includes(token));
}

function isPolishVoice(voice: VoiceCandidate): boolean {
  return voice.language.toLowerCase().replace('_', '-').startsWith('pl');
}

function qualityScore(quality?: string | null): number {
  const normalized = String(quality ?? '').toLowerCase();
  if (normalized.includes('premium')) return 3;
  if (normalized.includes('enhanced')) return 2;
  if (normalized.includes('default')) return 1;
  return 0;
}

export function resolvePreferredPolishVoice(
  voices: VoiceCandidate[],
  preferences: VoicePreferences,
): VoiceCandidate | null {
  const polish = voices.filter(isPolishVoice);
  if (!polish.length) return null;
  if (preferences.mode === 'manual' && preferences.voiceIdentifier) {
    const selected = polish.find((voice) => voice.identifier === preferences.voiceIdentifier);
    if (selected) return selected;
  }
  return [...polish].sort((a, b) => (
    qualityScore(b.quality) - qualityScore(a.quality)
    || a.name.localeCompare(b.name, 'pl')
    || a.identifier.localeCompare(b.identifier)
  ))[0];
}

export function mergeVoicePreferences(
  value: Partial<VoicePreferences> | null | undefined,
): VoicePreferences {
  return {
    guidanceEnabled: value?.guidanceEnabled !== false,
    alertsEnabled: value?.alertsEnabled !== false,
    mode: value?.mode === 'manual' ? 'manual' : 'auto',
    voiceIdentifier: typeof value?.voiceIdentifier === 'string' && value.voiceIdentifier
      ? value.voiceIdentifier
      : null,
  };
}
