export type PreferredFuelKey = 'pb95' | 'pb98' | 'diesel' | 'lpg';

export const PREFERRED_FUEL_OPTIONS: Array<{ key: PreferredFuelKey; label: string }> = [
  { key: 'pb95', label: 'PB95' },
  { key: 'pb98', label: 'PB98' },
  { key: 'diesel', label: 'ON / Diesel' },
  { key: 'lpg', label: 'LPG' },
];

export const PREFERRED_FUEL_LABELS: Record<PreferredFuelKey, string> = {
  pb95: 'PB95',
  pb98: 'PB98',
  diesel: 'ON',
  lpg: 'LPG',
};

const FUEL_FALLBACK_ORDER: PreferredFuelKey[] = ['pb95', 'pb98', 'diesel', 'lpg'];

export type StationPriceRow = {
  pb95?: number | null;
  pb98?: number | null;
  diesel?: number | null;
  lpg?: number | null;
};

export type StationDisplayPrice = {
  key: PreferredFuelKey;
  label: string;
  value: number;
} | null;

function isPreferredFuelKey(value: unknown): value is PreferredFuelKey {
  return value === 'pb95' || value === 'pb98' || value === 'diesel' || value === 'lpg';
}

export function normalizePreferredFuel(value: unknown): PreferredFuelKey | null {
  if (typeof value !== 'string') return null;
  const v = value.trim().toLowerCase();
  if (v === 'petrol' || v === 'gasoline' || v === 'benzyna') return 'pb95';
  if (isPreferredFuelKey(v)) return v;
  return null;
}

/**
 * Cena na pinie: preferowane paliwo aktywnego auta → pierwsze dostępne → null.
 */
export function resolveStationDisplayPrice(
  prices: StationPriceRow[] | StationPriceRow | null | undefined,
  preferredFuel?: string | null,
): StationDisplayPrice {
  const row = Array.isArray(prices) ? prices[0] : prices;
  if (!row) return null;

  const preferred = normalizePreferredFuel(preferredFuel);
  const order: PreferredFuelKey[] = preferred
    ? [preferred, ...FUEL_FALLBACK_ORDER.filter((k) => k !== preferred)]
    : FUEL_FALLBACK_ORDER;

  for (const key of order) {
    const raw = row[key];
    if (raw == null) continue;
    const value = Number(raw);
    if (!Number.isFinite(value)) continue;
    return { key, label: PREFERRED_FUEL_LABELS[key], value };
  }
  return null;
}
