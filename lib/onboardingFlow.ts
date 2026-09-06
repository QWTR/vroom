export const ONBOARDING_STEPS = [
  'username',
  'profile',
  'region',
  'garage',
  'music',
  'discord',
  'premium',
] as const;

export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

export function isOnboardingStep(value: unknown): value is OnboardingStep {
  return ONBOARDING_STEPS.includes(value as OnboardingStep);
}

export function nextOnboardingStep(step: OnboardingStep): OnboardingStep | null {
  const index = ONBOARDING_STEPS.indexOf(step);
  return index < ONBOARDING_STEPS.length - 1 ? ONBOARDING_STEPS[index + 1] : null;
}

export function canSkipOnboardingStep(step: OnboardingStep): boolean {
  return step !== 'username';
}
