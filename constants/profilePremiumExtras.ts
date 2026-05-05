export type ProfileSectionAccentMode = 'theme' | 'gradient' | 'solid';
export type ProfileAvatarRingAnim = 'none' | 'rotate' | 'pulse' | 'breathe';
export type ProfileVisitEntranceAnim =
  | 'none'
  | 'sparkle'
  | 'hero-flash'
  | 'rings'
  | 'glow'
  | 'sweep';
export type ProfileHeroMotion = 'none' | 'shimmer' | 'float' | 'pulse';

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
  };
}
