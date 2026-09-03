import { describe, expect, it } from 'vitest';
import { APP_THEME_PRESETS } from './appThemePresets';
import {
  type AppTheme,
  contrastRatio,
  darkTheme,
  ensureContrast,
  lightTheme,
  normalizeAccessibleTheme,
} from './theme';
import {
  MAX_COMBINED_FONT_SCALE,
  MIN_READABLE_FONT_SIZE,
  TEXT_SIZE_SCALES,
  TYPOGRAPHY,
  normalizeTextSizePreference,
} from './typography';

const surfaces = (theme: typeof darkTheme) => [theme.bg, theme.bgAlt, theme.surface, theme.surface2, theme.surface3];
const THEME_CASES: [string, AppTheme][] = [
  ['dark', darkTheme],
  ['light', lightTheme],
  ...APP_THEME_PRESETS.map((preset): [string, AppTheme] => [preset.id, preset.theme]),
];

describe('readability design contract', () => {
  it('never defines a typography token below the readable minimum', () => {
    expect(Math.min(...Object.values(TYPOGRAPHY).map((token) => token.fontSize))).toBe(MIN_READABLE_FONT_SIZE);
    expect(Object.values(TYPOGRAPHY).every((token) => token.lineHeight >= token.fontSize * 1.2)).toBe(true);
  });

  it('provides the three requested app scales and a 200% combined ceiling', () => {
    expect(TEXT_SIZE_SCALES).toEqual({ compact: 0.75, small: 0.9, standard: 1, large: 1.15, veryLarge: 1.3 });
    expect(MAX_COMBINED_FONT_SCALE).toBe(2);
    expect(normalizeTextSizePreference('compact')).toBe('compact');
    expect(normalizeTextSizePreference('small')).toBe('small');
    expect(normalizeTextSizePreference('large')).toBe('large');
    expect(normalizeTextSizePreference('veryLarge')).toBe('veryLarge');
    expect(normalizeTextSizePreference('broken')).toBe('standard');
  });

  it.each(THEME_CASES)('normalizes %s theme text to WCAG AA contrast', (_name, rawTheme) => {
    const theme = normalizeAccessibleTheme(rawTheme);
    for (const background of surfaces(theme)) {
      expect(contrastRatio(theme.text, background)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(theme.textMuted, background)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(theme.link, background)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('repairs intentionally unreadable custom foreground colors without mutating input', () => {
    const raw = { ...darkTheme, text: '#111111', textMuted: '#151515', link: '#161616' };
    const normalized = normalizeAccessibleTheme(raw);
    expect(raw.text).toBe('#111111');
    expect(normalized.text).not.toBe(raw.text);
    expect(contrastRatio(normalized.text, normalized.surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(ensureContrast('#121212', ['#111111'], 4.5), '#111111')).toBeGreaterThanOrEqual(4.5);
  });
});
