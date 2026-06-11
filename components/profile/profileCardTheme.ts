import type { AppTheme } from '../../constants/theme';

/** Lokalna paleta profilu przekazywana do subkomponentów (zamiast globalnego useTheme). */
export type ProfileCardTheme = Partial<AppTheme> & {
  surfaceAlt?: string;
};

export function resolveProfileCardTheme(global: AppTheme, profile?: ProfileCardTheme): AppTheme {
  if (!profile) return global;
  const alt = profile.surfaceAlt ?? profile.primaryBg ?? profile.surface;
  return {
    ...global,
    ...profile,
    surface3: profile.surface3 ?? alt ?? global.surface3,
    surface4: profile.surface4 ?? alt ?? global.surface4,
    border2: profile.border2 ?? profile.border ?? global.border2,
    textMuted: profile.textMuted ?? profile.textDim ?? global.textMuted,
    textFaint: profile.textFaint ?? profile.textDim ?? global.textFaint,
  };
}

export const GLASS_SHADOW = {
  shadowColor: '#000',
  shadowOpacity: 0.3,
  shadowRadius: 10,
  shadowOffset: { width: 0, height: 4 },
  elevation: 5,
} as const;

export const GLASS_BORDER = 'rgba(255,255,255,0.08)';

/** Semi-transparent surface for iOS-style widgets (#RRGGBB → #RRGGBB80). */
export function glassSurface(hex: string, alpha = '80'): string {
  if (/^#[0-9A-Fa-f]{6}$/i.test(hex)) return `${hex}${alpha}`;
  return hex;
}
