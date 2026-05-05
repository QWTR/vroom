import type { ProfileGradientSpec } from '../../constants/profilePremiumExtras';

const HEX6 = /^#[0-9A-Fa-f]{6}$/i;

function clamp01(n: unknown, def: number): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return def;
  return Math.max(0, Math.min(1, v));
}

/** Końcówki hex (#RRGGBB) — expo-linear-gradient rzuca przy złych/zbyt krótkich stringach */
export function sanitizeHexList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const x of raw) {
    if (typeof x !== 'string') continue;
    const t = x.trim();
    if (HEX6.test(t)) out.push(t.toUpperCase());
    if (out.length >= 5) break;
  }
  return out;
}

export function linearGradientFromSpec(
  spec: ProfileGradientSpec | null | undefined,
  fallback: string[],
): { colors: string[]; start: { x: number; y: number }; end: { x: number; y: number } } | null {
  const cols = sanitizeHexList(spec?.colors);
  const colors = cols.length >= 2 ? cols : sanitizeHexList(fallback);
  if (colors.length < 2) return null;
  return {
    colors,
    start: {
      x: clamp01(spec?.start?.x, 0),
      y: clamp01(spec?.start?.y, 0),
    },
    end: {
      x: clamp01(spec?.end?.x, 1),
      y: clamp01(spec?.end?.y, 1),
    },
  };
}
