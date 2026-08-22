export type PerformanceProfile = 'standard' | 'battery' | 'smooth';

export type ScenePhase = 'cold' | 'active' | 'warm' | 'suspended' | 'backgroundDrive';

export type SceneLocationMode = 'off' | 'casual' | 'trip';
export type SceneAnimationTier = 'off' | 'reduced' | 'full';

export type SceneCapabilities = {
  phase: ScenePhase;
  uiVisible: boolean;
  interactive: boolean;
  networkAllowed: boolean;
  locationMode: SceneLocationMode;
  animationTier: SceneAnimationTier;
  mediaAllowed: boolean;
  nativeSurfaceAllowed: boolean;
};

export type ScenePolicyInput = {
  focused: boolean;
  appActive: boolean;
  suspended: boolean;
  tripActive?: boolean;
  covered?: boolean;
  profile?: PerformanceProfile;
};

export const DEFAULT_PERFORMANCE_PROFILE: PerformanceProfile = 'standard';
export const SCENE_SUSPEND_DELAY_MS = 2_000;

export function isPerformanceProfile(value: unknown): value is PerformanceProfile {
  return value === 'standard' || value === 'battery' || value === 'smooth';
}

export function resolveSceneCapabilities(input: ScenePolicyInput): SceneCapabilities {
  const profile = input.profile ?? DEFAULT_PERFORMANCE_PROFILE;
  const tripActive = input.tripActive === true;
  const covered = input.covered === true;

  if (!input.appActive) {
    if (tripActive) {
      return {
        phase: 'backgroundDrive',
        uiVisible: false,
        interactive: false,
        networkAllowed: true,
        locationMode: 'trip',
        animationTier: 'off',
        mediaAllowed: false,
        nativeSurfaceAllowed: false,
      };
    }
    return {
      phase: 'suspended',
      uiVisible: false,
      interactive: false,
      networkAllowed: false,
      locationMode: 'off',
      animationTier: 'off',
      mediaAllowed: false,
      nativeSurfaceAllowed: false,
    };
  }

  if (!input.focused) {
    if (tripActive) {
      return {
        phase: 'backgroundDrive',
        uiVisible: false,
        interactive: false,
        networkAllowed: true,
        locationMode: 'trip',
        animationTier: 'off',
        mediaAllowed: false,
        nativeSurfaceAllowed: false,
      };
    }
    return {
      phase: input.suspended ? 'suspended' : 'warm',
      uiVisible: false,
      interactive: false,
      networkAllowed: false,
      locationMode: 'off',
      animationTier: 'off',
      mediaAllowed: false,
      nativeSurfaceAllowed: !input.suspended,
    };
  }

  return {
    phase: 'active',
    uiVisible: true,
    interactive: !covered,
    networkAllowed: true,
    locationMode: tripActive ? 'trip' : 'casual',
    animationTier: covered ? 'off' : profile === 'battery' ? 'reduced' : 'full',
    mediaAllowed: !covered,
    nativeSurfaceAllowed: !covered,
  };
}

export type MapFpsInput = {
  profile: PerformanceProfile;
  speedKmh: number;
  interacting?: boolean;
  cameraAnimating?: boolean;
  idleForMs?: number;
};

export function resolveMapFps(input: MapFpsInput): 15 | 30 | 60 {
  const speed = Number.isFinite(input.speedKmh) ? Math.max(0, input.speedKmh) : 0;
  const idleForMs = Math.max(0, input.idleForMs ?? 0);
  const activeMotion = input.interacting === true || input.cameraAnimating === true;

  if (input.profile === 'battery') {
    return !activeMotion && speed < 1 && idleForMs >= 3_000 ? 15 : 30;
  }
  if (input.profile === 'smooth') {
    return !activeMotion && speed < 1 && idleForMs >= 10_000 ? 30 : 60;
  }
  if (activeMotion || speed > 10) return 60;
  if (speed >= 1 || idleForMs < 5_000) return 30;
  return 15;
}

export function mediaPreloadRadius(profile: PerformanceProfile): 0 | 1 {
  return profile === 'battery' ? 0 : 1;
}
