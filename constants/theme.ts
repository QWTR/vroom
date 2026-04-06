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
};

export const lightTheme = {
  bg:             '#e8e8e8',
  bgAlt:          '#efefef',
  surface:        '#ffffff',
  surface2:       '#f5f5f5',
  surface3:       '#ffffff',
  surface4:       '#ececec',
  border:         '#00000018',
  border2:        '#00000025',
  border3:        '#00000035',
  text:           '#0a0a0a',
  textMuted:      '#333333',
  textDim:        '#666666',
  textFaint:      '#999999',
  primary:        '#c0201d',
  primaryBg:      '#c0201d18',
  primaryBorder:  '#c0201d40',
  primaryBorder2: '#c0201d60',
  icon:           '#0a0a0a',
  tabBg:          '#f5f5f5f5',
  tabBorder:      '#00000020',
  overlay:        '#000000bb',
  online:         '#2db518',
  gold:           '#c8960a',
  warning:        '#d4720a',
  danger:         '#c0201d',
  info:           '#1565c0',
  success:        '#2e7d32',
};

export type AppTheme = typeof darkTheme;
export type ThemeMode = 'dark' | 'light' | 'custom';

export const THEME_MODE_KEY        = 'app_theme';
export const CUSTOM_THEME_KEY      = 'app_custom_theme';

export function buildCustomTheme(overrides: Partial<AppTheme>): AppTheme {
  return { ...darkTheme, ...overrides };
}