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
  controlBorder:  '#666c76',
  focusRing:      '#ff625f',
  text:           '#ffffff',
  textSecondary:  '#d0d3d8',
  textMuted:      '#a9aeb7',
  textDim:        '#a9aeb7',
  textFaint:      '#a9aeb7',
  textDisabled:   '#8f959f',
  primary:        '#e33835',
  primaryText:    '#ff625f',
  link:           '#ff625f',
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
  controlBorder:  '#68707c',
  focusRing:      '#9f1412',
  text:           '#000000',
  textSecondary:  '#252a33',
  textMuted:      '#4b5563',
  textDim:        '#4b5563',
  textFaint:      '#4b5563',
  textDisabled:   '#5f6875',
  primary:        '#b81815',
  primaryText:    '#9f1412',
  link:           '#9f1412',
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
export type ThemeMode = 'dark' | 'light' | 'custom' | 'preset';

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

type RgbaColor = { r: number; g: number; b: number; a: number };

function parseHexColor(value: string): RgbaColor | null {
  if (!value?.startsWith('#')) return null;
  let raw = value.slice(1);
  if (raw.length === 3 || raw.length === 4) {
    raw = raw.split('').map((part) => `${part}${part}`).join('');
  }
  if (raw.length !== 6 && raw.length !== 8) return null;
  const parsed = Number.parseInt(raw, 16);
  if (!Number.isFinite(parsed)) return null;
  return {
    r: Number.parseInt(raw.slice(0, 2), 16),
    g: Number.parseInt(raw.slice(2, 4), 16),
    b: Number.parseInt(raw.slice(4, 6), 16),
    a: raw.length === 8 ? Number.parseInt(raw.slice(6, 8), 16) / 255 : 1,
  };
}

function toHex({ r, g, b }: RgbaColor): string {
  const part = (value: number) => Math.round(Math.max(0, Math.min(255, value))).toString(16).padStart(2, '0');
  return `#${part(r)}${part(g)}${part(b)}`;
}

function composite(foreground: RgbaColor, background: RgbaColor): RgbaColor {
  const alpha = foreground.a + background.a * (1 - foreground.a);
  if (alpha <= 0) return { r: 0, g: 0, b: 0, a: 0 };
  return {
    r: (foreground.r * foreground.a + background.r * background.a * (1 - foreground.a)) / alpha,
    g: (foreground.g * foreground.a + background.g * background.a * (1 - foreground.a)) / alpha,
    b: (foreground.b * foreground.a + background.b * background.a * (1 - foreground.a)) / alpha,
    a: alpha,
  };
}

export function contrastRatio(foreground: string, background: string): number {
  const fg = parseHexColor(foreground);
  const bg = parseHexColor(background);
  if (!fg || !bg) return 1;
  const composed = composite(fg, bg);
  const lighter = Math.max(colorLuminance(toHex(composed)), colorLuminance(toHex(bg)));
  const darker = Math.min(colorLuminance(toHex(composed)), colorLuminance(toHex(bg)));
  return (lighter + 0.05) / (darker + 0.05);
}

function blend(from: RgbaColor, to: RgbaColor, amount: number): RgbaColor {
  return {
    r: from.r + (to.r - from.r) * amount,
    g: from.g + (to.g - from.g) * amount,
    b: from.b + (to.b - from.b) * amount,
    a: 1,
  };
}

function minimumContrast(color: string, backgrounds: string[]): number {
  return backgrounds.reduce((minimum, background) => Math.min(minimum, contrastRatio(color, background)), Number.POSITIVE_INFINITY);
}

/**
 * Keeps the requested hue whenever possible, then moves it toward the safer
 * black/white endpoint until it is readable on every supplied surface.
 */
export function ensureContrast(color: string, backgrounds: string[], targetRatio = 4.5): string {
  const parsed = parseHexColor(color) ?? parseHexColor('#ffffff')!;
  const opaque = toHex({ ...parsed, a: 1 });
  if (minimumContrast(opaque, backgrounds) >= targetRatio) return opaque;

  const black = parseHexColor('#000000')!;
  const white = parseHexColor('#ffffff')!;
  const endpoint = minimumContrast('#ffffff', backgrounds) >= minimumContrast('#000000', backgrounds) ? white : black;
  for (let step = 1; step <= 50; step += 1) {
    const candidate = toHex(blend(parsed, endpoint, step / 50));
    if (minimumContrast(candidate, backgrounds) >= targetRatio) return candidate;
  }
  return toHex(endpoint);
}

/** Applies WCAG-oriented foreground colors without altering persisted theme choices. */
export function normalizeAccessibleTheme(theme: AppTheme): AppTheme {
  const readingSurfaces = [theme.bg, theme.bgAlt, theme.surface, theme.surface2, theme.surface3];
  const text = ensureContrast(theme.text, readingSurfaces, 4.5);
  const textSecondary = ensureContrast(theme.textSecondary ?? theme.textMuted, readingSurfaces, 4.5);
  const textMuted = ensureContrast(theme.textMuted, readingSurfaces, 4.5);
  const primaryText = ensureContrast(theme.primaryText ?? theme.primary, readingSurfaces, 4.5);
  return {
    ...theme,
    text,
    textSecondary,
    textMuted,
    textDim: textMuted,
    textFaint: textMuted,
    textDisabled: ensureContrast(theme.textDisabled ?? textMuted, readingSurfaces, 4.5),
    primaryText,
    link: ensureContrast(theme.link ?? theme.primary, readingSurfaces, 4.5),
    icon: ensureContrast(theme.icon, readingSurfaces, 3),
    controlBorder: ensureContrast(theme.controlBorder ?? theme.border3, readingSurfaces, 3),
    focusRing: ensureContrast(theme.focusRing ?? theme.primary, readingSurfaces, 3),
    onPrimary: ensureContrast(theme.onPrimary, [theme.primary], 4.5),
    mapOverlayText: ensureContrast(theme.mapOverlayText, [theme.mapOverlay], 4.5),
    mapLabelText: ensureContrast(theme.mapLabelText, [theme.mapLabelBg], 4.5),
  };
}

export function withAlpha(hex: string, alphaHex: string): string {
  if (!hex || !hex.startsWith('#')) return hex;
  const clean = hex.length === 4
    ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`
    : hex.slice(0, 7);
  return `${clean}${alphaHex}`;
}

export function getThemeChrome(theme: AppTheme, dark: boolean) {
  return {
    pageGradient: [theme.bg, theme.bgAlt, dark ? theme.bg : theme.surface2] as const,
    heroGradient: [theme.bgAlt, theme.bg, 'transparent'] as const,
    bottomFade: ['transparent', theme.bg] as const,
    glassCard: withAlpha(theme.surface, dark ? 'aa' : 'dd'),
    glassCardStrong: withAlpha(theme.surface2, dark ? 'dd' : 'ee'),
    glassBorder: theme.primaryBorder,
    iconGlow: theme.primaryBg,
    subtleIconGlow: withAlpha(theme.primary, dark ? '22' : '18'),
    statDivider: theme.primaryBorder,
    scanLine: dark ? '#ffffff05' : '#00000005',
  };
}
