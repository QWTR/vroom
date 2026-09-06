import { describe, expect, it } from 'vitest';
import {
  ONBOARDING_STEPS,
  canSkipOnboardingStep,
  isOnboardingStep,
  nextOnboardingStep,
} from './onboardingFlow';

describe('onboarding state machine', () => {
  it('moves through every setup screen in order', () => {
    expect(ONBOARDING_STEPS.map(nextOnboardingStep)).toEqual([
      'profile', 'region', 'garage', 'music', 'discord', 'premium', null,
    ]);
  });

  it('makes the username the only non-skippable profile step', () => {
    expect(canSkipOnboardingStep('username')).toBe(false);
    for (const step of ONBOARDING_STEPS.slice(1)) expect(canSkipOnboardingStep(step)).toBe(true);
  });

  it('rejects unknown persisted state', () => {
    expect(isOnboardingStep('garage')).toBe(true);
    expect(isOnboardingStep('finished')).toBe(false);
  });
});
