import type { TextStyle } from 'react-native';

export type TypographyVariant =
  | 'display'
  | 'h1'
  | 'h2'
  | 'h3'
  | 'body'
  | 'bodySmall'
  | 'label'
  | 'button'
  | 'caption'
  | 'micro';

export type TextSizePreference = 'compact' | 'small' | 'standard' | 'large' | 'veryLarge';

export const TEXT_SIZE_SCALES: Record<TextSizePreference, number> = {
  compact: 0.75,
  small: 0.9,
  standard: 1,
  large: 1.15,
  veryLarge: 1.3,
};

export const TYPOGRAPHY: Record<TypographyVariant, Required<Pick<TextStyle, 'fontSize' | 'lineHeight' | 'fontWeight'>>> = {
  display:   { fontSize: 32, lineHeight: 40, fontWeight: '800' },
  h1:        { fontSize: 28, lineHeight: 35, fontWeight: '800' },
  h2:        { fontSize: 22, lineHeight: 29, fontWeight: '700' },
  h3:        { fontSize: 18, lineHeight: 25, fontWeight: '700' },
  body:      { fontSize: 16, lineHeight: 24, fontWeight: '400' },
  bodySmall: { fontSize: 14, lineHeight: 21, fontWeight: '400' },
  label:     { fontSize: 14, lineHeight: 19, fontWeight: '600' },
  button:    { fontSize: 16, lineHeight: 20, fontWeight: '700' },
  caption:   { fontSize: 13, lineHeight: 18, fontWeight: '500' },
  micro:     { fontSize: 12, lineHeight: 16, fontWeight: '600' },
};

export const MIN_READABLE_FONT_SIZE = 12;
export const MIN_INPUT_FONT_SIZE = 16;
export const MAX_COMBINED_FONT_SCALE = 2;

export function normalizeTextSizePreference(value: unknown): TextSizePreference {
  return value === 'compact' || value === 'small' || value === 'large' || value === 'veryLarge' ? value : 'standard';
}

export function manropeFamilyForWeight(weight: TextStyle['fontWeight']): string {
  const numeric = weight === 'bold'
    ? 700
    : weight === 'normal' || weight == null
      ? 400
      : Number.parseInt(String(weight), 10) || 400;
  if (numeric >= 800) return 'Manrope_800ExtraBold';
  if (numeric >= 700) return 'Manrope_700Bold';
  if (numeric >= 600) return 'Manrope_600SemiBold';
  if (numeric >= 500) return 'Manrope_500Medium';
  return 'Manrope_400Regular';
}
