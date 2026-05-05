export type ProfileThemePreset =
  | 'default'
  | 'midnight'
  | 'sunset'
  | 'neon'
  | 'royal'
  | 'cyber'
  | 'gold'
  | 'forest'
  | 'custom';

export type ProfilePalette = {
  bg: string;
  surface: string;
  surfaceAlt: string;
  border: string;
  borderStrong: string;
  text: string;
  textDim: string;
};

const HEX6 = /^#[0-9A-Fa-f]{6}$/i;

function parseHex6(s: string | null | undefined): { r: number; g: number; b: number } | null {
  if (!s || typeof s !== 'string') return null;
  const t = s.trim();
  if (!HEX6.test(t)) return null;
  const n = parseInt(t.slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function rgbToHex(r: number, g: number, b: number): string {
  const c = (x: number) => Math.max(0, Math.min(255, Math.round(x)));
  return `#${((1 << 24) + (c(r) << 16) + (c(g) << 8) + c(b)).toString(16).slice(1).toUpperCase()}`;
}

function mixRgb(
  a: { r: number; g: number; b: number },
  b: { r: number; g: number; b: number },
  t: number,
): { r: number; g: number; b: number } {
  return {
    r: a.r + (b.r - a.r) * t,
    g: a.g + (b.g - a.g) * t,
    b: a.b + (b.b - a.b) * t,
  };
}

function relLum(rgb: { r: number; g: number; b: number }): number {
  const lin = (c: number) => {
    c /= 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const R = lin(rgb.r);
  const G = lin(rgb.g);
  const B = lin(rgb.b);
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}

/** Niestandardowy motyw profilu: kolory kart/tła z długości gradientu zapisanego w Premium (≥2×#RRGGBB). */
function deriveCustomPaletteFromHero(a: { r: number; g: number; b: number }, b: { r: number; g: number; b: number }, isDark: boolean): ProfilePalette {
  const mid = mixRgb(a, b, 0.45);
  const W = { r: 255, g: 255, b: 255 };
  const blk = { r: 0, g: 0, b: 0 };

  let bgRgb: { r: number; g: number; b: number };
  let surfaceRgb: { r: number; g: number; b: number };
  let surfaceAltRgb: { r: number; g: number; b: number };

  if (isDark) {
    bgRgb = {
      r: mid.r * 0.22,
      g: mid.g * 0.22,
      b: mid.b * 0.22,
    };
    surfaceRgb = {
      r: mid.r * 0.34,
      g: mid.g * 0.34,
      b: mid.b * 0.34,
    };
    surfaceAltRgb = {
      r: mid.r * 0.46,
      g: mid.g * 0.46,
      b: mid.b * 0.46,
    };
  } else {
    bgRgb = mixRgb(mid, W, 0.86);
    surfaceRgb = mixRgb(mid, W, 0.76);
    surfaceAltRgb = mixRgb(mid, W, 0.66);
  }

  const bg = rgbToHex(bgRgb.r, bgRgb.g, bgRgb.b);
  const surface = rgbToHex(surfaceRgb.r, surfaceRgb.g, surfaceRgb.b);
  const surfaceAlt = rgbToHex(surfaceAltRgb.r, surfaceAltRgb.g, surfaceAltRgb.b);

  const bgParsed = parseHex6(bg)!;
  const lum = relLum(bgParsed);
  const borderMix = lum > 0.45 ? mixRgb(bgParsed, blk, 0.12) : mixRgb(bgParsed, W, 0.12);
  const borderStrongMix = lum > 0.45 ? mixRgb(bgParsed, blk, 0.22) : mixRgb(bgParsed, W, 0.22);

  let text: string;
  let textDim: string;
  if (lum > 0.42) {
    text = '#0a0a0e';
    textDim = '#5c5c6b';
  } else {
    text = '#f4f4f8';
    textDim = '#a1a1b0';
  }

  return {
    bg,
    surface,
    surfaceAlt,
    border: rgbToHex(borderMix.r, borderMix.g, borderMix.b),
    borderStrong: rgbToHex(borderStrongMix.r, borderStrongMix.g, borderStrongMix.b),
    text,
    textDim,
  };
}

/** Czy są co najmniej dwa poprawne kolory #RRGGBB (gradient tła profilu). */
export function hasValidCustomHeroColors(spec: { colors?: string[] } | null | undefined): boolean {
  if (!spec?.colors?.length) return false;
  let n = 0;
  for (const c of spec.colors) {
    if (typeof c === 'string' && HEX6.test(c.trim())) {
      n++;
      if (n >= 2) return true;
    }
  }
  return false;
}

export function resolveProfilePalette(
  preset: string | null | undefined,
  opts: {
    isDark: boolean;
    customHeroGradient?: { colors?: string[] } | null;
    /** Motyw „custom” + zapisany gradient — barwi cały profil (tło, karty, tekst). */
    applySavedCustomTint?: boolean;
  },
): ProfilePalette {
  const base = getProfileThemePalette(preset);
  if (preset !== 'custom' || !opts.applySavedCustomTint || !hasValidCustomHeroColors(opts.customHeroGradient)) {
    return base;
  }
  const raw = opts.customHeroGradient?.colors ?? [];
  const pair: string[] = [];
  for (const c of raw) {
    if (typeof c === 'string' && HEX6.test(c.trim())) pair.push(c.trim().toUpperCase());
    if (pair.length >= 2) break;
  }
  if (pair.length < 2) return base;
  const p0 = parseHex6(pair[0]);
  const p1 = parseHex6(pair[1]);
  if (!p0 || !p1) return base;
  return deriveCustomPaletteFromHero(p0, p1, opts.isDark);
}

export function getProfileThemePalette(preset: string | null | undefined): ProfilePalette {
  switch (preset) {
    case 'midnight':
      return {
        bg: '#060b16',
        surface: '#0f1728',
        surfaceAlt: '#162039',
        border: '#7aa2ff22',
        borderStrong: '#7aa2ff40',
        text: '#e8eeff',
        textDim: '#9eb1d9',
      };
    case 'sunset':
      return {
        bg: '#1b0905',
        surface: '#2a130d',
        surfaceAlt: '#361a12',
        border: '#ff9a5a22',
        borderStrong: '#ff9a5a40',
        text: '#ffe9dc',
        textDim: '#d9af98',
      };
    case 'neon':
      return {
        bg: '#051510',
        surface: '#0b221b',
        surfaceAlt: '#123028',
        border: '#4de92622',
        borderStrong: '#4de92640',
        text: '#ddfff3',
        textDim: '#93ccb8',
      };
    case 'royal':
      return {
        bg: '#0d0618',
        surface: '#160c28',
        surfaceAlt: '#221238',
        border: '#c084fc33',
        borderStrong: '#c084fc55',
        text: '#f3e8ff',
        textDim: '#c4b5fd',
      };
    case 'cyber':
      return {
        bg: '#050a18',
        surface: '#0c1228',
        surfaceAlt: '#121a38',
        border: '#22d3ee33',
        borderStrong: '#38bdf855',
        text: '#ecfeff',
        textDim: '#7dd3fc',
      };
    case 'gold':
      return {
        bg: '#120f06',
        surface: '#1c170c',
        surfaceAlt: '#262014',
        border: '#f5c51833',
        borderStrong: '#eab30855',
        text: '#fffbeb',
        textDim: '#d6c08a',
      };
    case 'forest':
      return {
        bg: '#061208',
        surface: '#0c1a10',
        surfaceAlt: '#122418',
        border: '#4ade8033',
        borderStrong: '#22c55e55',
        text: '#ecfccb',
        textDim: '#a3e635',
      };
    case 'custom':
      return {
        bg: '#08080c',
        surface: '#12121a',
        surfaceAlt: '#1a1a26',
        border: '#ffffff12',
        borderStrong: '#ffffff22',
        text: '#f4f4f8',
        textDim: '#a1a1b0',
      };
    case 'default':
    default:
      return {
        bg: '#090909',
        surface: '#141414',
        surfaceAlt: '#1b1b1b',
        border: '#ffffff0a',
        borderStrong: '#ffffff18',
        text: '#ffffff',
        textDim: '#ffffff70',
      };
  }
}
