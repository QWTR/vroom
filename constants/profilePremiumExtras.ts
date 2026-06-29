export type ProfileSectionAccentMode = 'theme' | 'gradient' | 'solid';
export type ProfileAvatarRingAnim = 'none' | 'rotate' | 'pulse' | 'breathe';
export type ProfileVisitEntranceAnim =
  | 'none'
  | 'apex-reveal'
  | 'garage-ignition'
  | 'neon-impact'
  | 'hyper-tunnel'
  | 'sparkle'
  | 'hero-flash'
  | 'rings'
  | 'glow'
  | 'sweep'
  | 'shockwave'
  | 'confetti'
  | 'lightning'
  | 'curtain'
  | 'portal'
  | 'meteor'
  | 'iris'
  | 'turbo'
  | 'signal'
  | 'chromaburst';
export type ProfileHeroMotion =
  | 'none'
  | 'apex-grid'
  | 'ignition'
  | 'neon-rain'
  | 'turbo-pulse'
  | 'shimmer'
  | 'float'
  | 'pulse'
  | 'aurora'
  | 'embers'
  | 'kenburns'
  | 'glitch'
  | 'vortex'
  | 'prism'
  | 'matrix'
  | 'storm'
  | 'hologram'
  | 'neon-grid';

export const PROFILE_HERO_MOTIONS: ProfileHeroMotion[] = [
  'none', 'apex-grid', 'ignition', 'neon-rain', 'turbo-pulse', 'aurora', 'vortex',
  'embers', 'glitch', 'kenburns',
];

export const PROFILE_VISIT_ENTRANCE_ANIMS: ProfileVisitEntranceAnim[] = [
  'none', 'apex-reveal', 'garage-ignition', 'neon-impact', 'hyper-tunnel',
  'portal', 'turbo', 'lightning', 'chromaburst', 'iris',
];
/** Punkt kadrowania wgranego banera (zdjęcie użytkownika). */
export type ProfileBannerFocusPoint = 'top' | 'center' | 'bottom';

export type ProfileGradientSpec = {
  colors: string[];
  start: { x: number; y: number };
  end: { x: number; y: number };
};

export type ProfilePremiumExtras = {
  customHeroGradient: ProfileGradientSpec | null;
  sectionAccentMode: ProfileSectionAccentMode;
  sectionAccentGradient: ProfileGradientSpec | null;
  sectionAccentSolid: string | null;
  /** Obramowanie pierścienia avatara (Premium) */
  avatarRingGradient: ProfileGradientSpec | null;
  avatarRingAnim: ProfileAvatarRingAnim;
  visitEntranceAnim: ProfileVisitEntranceAnim;
  heroMotion: ProfileHeroMotion;
  /** Kadrowanie banera Premium (POST /profile/banner) — top / center / bottom. */
  bannerFocusPoint: ProfileBannerFocusPoint;
  globalEntranceAnimationId: string | null;
  globalBackgroundAnimationId: string | null;
};

export const DEFAULT_PROFILE_PREMIUM_EXTRAS: ProfilePremiumExtras = {
  customHeroGradient:     null,
  sectionAccentMode:      'theme',
  sectionAccentGradient:  null,
  sectionAccentSolid:     null,
  avatarRingGradient:     null,
  avatarRingAnim:         'none',
  visitEntranceAnim:      'none',
  heroMotion:             'none',
  bannerFocusPoint:       'center',
  globalEntranceAnimationId: null,
  globalBackgroundAnimationId: null,
};

export function mergeProfilePremiumExtras(raw: unknown): ProfilePremiumExtras {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ...DEFAULT_PROFILE_PREMIUM_EXTRAS };
  }
  const o = raw as Record<string, unknown>;
  return {
    ...DEFAULT_PROFILE_PREMIUM_EXTRAS,
    ...(typeof o.customHeroGradient === 'object' && o.customHeroGradient
      ? { customHeroGradient: o.customHeroGradient as ProfileGradientSpec }
      : {}),
    ...(typeof o.sectionAccentMode === 'string' ? { sectionAccentMode: o.sectionAccentMode as ProfileSectionAccentMode } : {}),
    ...(typeof o.sectionAccentGradient === 'object' && o.sectionAccentGradient
      ? { sectionAccentGradient: o.sectionAccentGradient as ProfileGradientSpec }
      : {}),
    ...(typeof o.sectionAccentSolid === 'string' ? { sectionAccentSolid: o.sectionAccentSolid } : {}),
    ...(typeof o.avatarRingGradient === 'object' && o.avatarRingGradient
      ? { avatarRingGradient: o.avatarRingGradient as ProfileGradientSpec }
      : {}),
    ...(typeof o.avatarRingAnim === 'string' ? { avatarRingAnim: o.avatarRingAnim as ProfileAvatarRingAnim } : {}),
    ...(typeof o.visitEntranceAnim === 'string' ? { visitEntranceAnim: o.visitEntranceAnim as ProfileVisitEntranceAnim } : {}),
    ...(typeof o.heroMotion === 'string' ? { heroMotion: o.heroMotion as ProfileHeroMotion } : {}),
    ...(o.bannerFocusPoint === 'top' || o.bannerFocusPoint === 'center' || o.bannerFocusPoint === 'bottom'
      ? { bannerFocusPoint: o.bannerFocusPoint as ProfileBannerFocusPoint }
      : {}),
    ...(typeof o.globalEntranceAnimationId === 'string' ? { globalEntranceAnimationId: o.globalEntranceAnimationId } : {}),
    ...(typeof o.globalBackgroundAnimationId === 'string' ? { globalBackgroundAnimationId: o.globalBackgroundAnimationId } : {}),
  };
}
