/**
 * Parsowanie tagów OSM maxspeed + domyślne limity wg typu drogi (Polska).
 */

export type OsmMaxSpeedParseResult = {
  kmh: number | null;
  /** Tag none / unlimited — brak formalnego limitu (nie błąd parsowania). */
  unlimited: boolean;
};

const PL_ZONE_LIMITS: Record<string, number> = {
  'pl:urban': 50,
  'pl:rural': 90,
  'pl:motorway': 140,
  'pl:expressway': 120,
  'pl:living_street': 20,
};

/** Limit wyświetlany w HUD — odrzuca NaN i wartości poza sensownym zakresem. */
export function sanitizeDisplaySpeedLimit(limit: number | null | undefined): number | null {
  if (limit == null || !Number.isFinite(limit)) return null;
  const n = Math.round(limit);
  if (n <= 0 || n > 250) return null;
  return n;
}

/**
 * Parsuje surowy tag OSM maxspeed (liczby, strefy PL, mph, none).
 */
export function parseOsmMaxSpeed(raw: string | undefined | null): OsmMaxSpeedParseResult {
  if (raw == null || raw === '') return { kmh: null, unlimited: false };

  const trimmed = raw.trim();
  const compact = trimmed.toLowerCase().replace(/\s+/g, '');

  if (compact === 'signals' || compact === 'variable') {
    return { kmh: null, unlimited: false };
  }
  if (compact === 'none' || compact === 'unlimited') {
    return { kmh: null, unlimited: true };
  }

  const plKey = trimmed.toLowerCase().replace(/\s+/g, '');
  if (PL_ZONE_LIMITS[plKey] != null) {
    return { kmh: PL_ZONE_LIMITS[plKey], unlimited: false };
  }

  if (compact.includes('mph')) {
    const mph = parseInt(compact.replace(/[^\d]/g, ''), 10);
    if (Number.isFinite(mph) && mph > 0 && mph <= 155) {
      return { kmh: Math.round(mph * 1.60934), unlimited: false };
    }
  }

  const digitLead = compact.match(/^(\d{1,3})/);
  if (digitLead) {
    const n = parseInt(digitLead[1], 10);
    if (n > 0 && n <= 250) return { kmh: n, unlimited: false };
  }

  const loose = parseInt(trimmed.replace(/[^\d]/g, ''), 10);
  if (Number.isFinite(loose) && loose > 0 && loose <= 250) {
    return { kmh: loose, unlimited: false };
  }

  return { kmh: null, unlimited: false };
}

/** Domyślny limit gdy brak tagu maxspeed (wg highway=*). */
export function highwaySpeedFallback(highway: string | undefined | null): number | null {
  if (!highway) return null;
  switch (highway.toLowerCase()) {
    case 'motorway':
    case 'motorway_link':
      return 140;
    case 'expressway':
      return 120;
    case 'trunk':
    case 'trunk_link':
      return 120;
    case 'primary':
    case 'primary_link':
      return 90;
    case 'secondary':
    case 'secondary_link':
      return 90;
    case 'tertiary':
    case 'tertiary_link':
      return 70;
    case 'residential':
      return 30;
    case 'living_street':
      return 20;
    case 'service':
      return 20;
    default:
      return null;
  }
}

/**
 * Pełna resolucja limitu dla segmentu: maxspeed → highway fallback.
 * unlimited (none) bez highway → null (celowe ukrycie znaku, nie NaN).
 */
export function resolveOsmSpeedLimit(
  maxspeedRaw?: string | null,
  highway?: string | null,
): number | null {
  const parsed = parseOsmMaxSpeed(maxspeedRaw);
  if (parsed.kmh != null) return parsed.kmh;

  const fromHighway = highwaySpeedFallback(highway);
  if (fromHighway != null) return fromHighway;

  if (parsed.unlimited) return null;

  return null;
}
