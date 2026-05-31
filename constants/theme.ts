export const darkTheme = {
  bg:             '#0a0a0a',
  bgAlt:          '#0f0f0f',
  surface:        '#111111',
  surface2:       '#161616',
  surface3:       '#1a1a1a',
  surface4:       '#252525',
  border:         '#ffffff08',
  border2:        '#ffffff10',
  border3:        '#ffffff15',
  text:           '#ffffff',
  textMuted:      '#ffffff70',
  textDim:        '#ffffff40',
  textFaint:      '#ffffff20',
  primary:        '#e33835',
  primaryBg:      '#e3383518',
  primaryBorder:  '#e3383535',
  primaryBorder2: '#e3383550',
  icon:           '#ffffff',
  tabBg:          '#0a0a0af5',
  tabBorder:      '#ffffff10',
  overlay:        '#000000cc',
  online:         '#4de926',
  gold:           '#f5c518',
  warning:        '#FF9800',
  danger:         '#e33835',
  info:           '#2196F3',
  success:        '#4CAF50',
  onPrimary:      '#ffffff',
  mapOverlay:     '#141414e8',
  mapOverlayText: '#ffffff',
  mapLabelBg:     '#0a0a0add',
  mapLabelText:   '#ffffff',
};

export const lightTheme = {
  bg:             '#dcdcdc',
  bgAlt:          '#e8e8e8',
  surface:        '#ffffff',
  surface2:       '#f2f2f2',
  surface3:       '#fafafa',
  surface4:       '#e4e4e4',
  border:         '#00000040',
  border2:        '#00000055',
  border3:        '#00000065',
  text:           '#000000',
  textMuted:      '#141414',
  textDim:        '#2a2a2a',
  textFaint:      '#4a4a4a',
  primary:        '#b81815',
  primaryBg:      '#b8181518',
  primaryBorder:  '#b8181548',
  primaryBorder2: '#b8181568',
  icon:           '#000000',
  tabBg:          '#f0f0f0f5',
  tabBorder:      '#00000035',
  overlay:        '#000000bb',
  online:         '#1a9610',
  gold:           '#a67c00',
  warning:        '#c45a00',
  danger:         '#b81815',
  info:           '#0d47a1',
  success:        '#1b5e20',
  onPrimary:      '#ffffff',
  mapOverlay:     '#fffffff5',
  mapOverlayText: '#000000',
  mapLabelBg:     '#fffffff2',
  mapLabelText:   '#000000',
};

export type AppTheme = typeof darkTheme;
export type ThemeMode = 'dark' | 'light' | 'custom';

export const THEME_MODE_KEY        = 'app_theme';
export const CUSTOM_THEME_KEY      = 'app_custom_theme';

/** Relative luminance 0–1 for hex colors (#rgb or #rrggbb). */
export function colorLuminance(hex: string): number {
  const raw = hex.replace('#', '').slice(0, 6);
  if (raw.length !== 6) return 0;
  const r = parseInt(raw.slice(0, 2), 16) / 255;
  const g = parseInt(raw.slice(2, 4), 16) / 255;
  const b = parseInt(raw.slice(4, 6), 16) / 255;
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function isThemeDark(theme: AppTheme): boolean {
  return colorLuminance(theme.bg) < 0.5;
}

export function buildCustomTheme(overrides: Partial<AppTheme>): AppTheme {
  return { ...darkTheme, ...overrides };
}
