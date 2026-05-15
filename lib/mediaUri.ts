import { API_URL } from '../constants/config';

/** Pełny URL zdjęcia/avatara — ścieżki względne z API dostają prefiks serwera. */
export function normalizeMediaUri(uri: string | null | undefined): string | null {
  if (uri == null) return null;
  const trimmed = typeof uri === 'string' ? uri.trim() : '';
  if (!trimmed) return null;
  if (trimmed.startsWith('file://') || trimmed.startsWith('content://')) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  const path = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  return `${API_URL}${path}`;
}

/** Jedna wartość z tablicy photos (string lub obiekt z url). */
export function coercePhotoRef(raw: unknown): string | null {
  if (raw == null) return null;
  if (typeof raw === 'string') return raw;
  if (typeof raw === 'object' && raw !== null) {
    const o = raw as Record<string, unknown>;
    if (typeof o.url === 'string') return o.url;
    if (typeof o.uri === 'string') return o.uri;
  }
  return null;
}

/** Zwraca poprawne URL-e do wyświetlenia (bez file:// i duplikatów). */
export function normalizePhotoList(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of list) {
    const ref = coercePhotoRef(item);
    const uri = normalizeMediaUri(ref);
    if (!uri || seen.has(uri)) continue;
    seen.add(uri);
    out.push(uri);
  }
  return out;
}
