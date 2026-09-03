/**
 * LIVE users have historically been returned as a bare array. Newer API and
 * socket deployments can wrap the same array in an envelope. Keep the mobile
 * client tolerant while both server versions are in circulation.
 */
export type LiveUserTransport = Record<string, unknown> & {
  id: number;
  username: string;
  avatarUrl: string | null;
  avatarFrameUrl: string | null;
  lat: number;
  lng: number;
};

function asRecords(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is Record<string, unknown> => (
    item != null && typeof item === 'object' && !Array.isArray(item)
  ));
}

function decodeJsonPayload(payload: unknown): unknown {
  if (typeof payload !== 'string') return payload;
  try {
    return JSON.parse(payload);
  } catch {
    return payload;
  }
}

export function extractLiveUsersPayload(payload: unknown): Record<string, unknown>[] {
  payload = decodeJsonPayload(payload);
  if (Array.isArray(payload)) return asRecords(payload);
  if (!payload || typeof payload !== 'object') return [];

  const root = payload as Record<string, unknown>;
  if (Array.isArray(root.users)) return asRecords(root.users);

  const data = root.data;
  if (Array.isArray(data)) return asRecords(data);
  if (data && typeof data === 'object') {
    const nested = data as Record<string, unknown>;
    if (Array.isArray(nested.users)) return asRecords(nested.users);
  }

  return [];
}

export function normalizeLiveUserTransport(value: Record<string, unknown>): LiveUserTransport | null {
  const nestedLocation = value.location && typeof value.location === 'object'
    ? value.location as Record<string, unknown>
    : null;
  const idRaw = value.id ?? value.userId;
  const latRaw = value.lat ?? value.latitude ?? nestedLocation?.lat ?? nestedLocation?.latitude;
  const lngRaw = value.lng ?? value.longitude ?? nestedLocation?.lng ?? nestedLocation?.longitude;
  if (idRaw == null || latRaw == null || lngRaw == null) return null;
  const id = Number(idRaw);
  const lat = Number(latRaw);
  const lng = Number(lngRaw);
  if (!Number.isFinite(id) || id <= 0 || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;

  const avatar = value.avatarUrl ?? value.avatar;
  const avatarFrame = value.avatarFrameUrl ?? value.avatarFrame;
  return {
    ...value,
    id,
    username: typeof value.username === 'string'
      ? value.username
      : (typeof value.name === 'string' ? value.name : ''),
    avatarUrl: typeof avatar === 'string' && avatar.trim() ? avatar : null,
    avatarFrameUrl: typeof avatarFrame === 'string' && avatarFrame.trim() ? avatarFrame : null,
    lat,
    lng,
  };
}

export function parseLiveUsersPayload(payload: unknown): LiveUserTransport[] {
  const decoded = decodeJsonPayload(payload);
  let records = extractLiveUsersPayload(decoded);
  // `user:location` carries one user rather than a snapshot array.
  if (records.length === 0 && decoded && typeof decoded === 'object' && !Array.isArray(decoded)) {
    records = [decoded as Record<string, unknown>];
  }
  return records
    .map(normalizeLiveUserTransport)
    .filter((user): user is LiveUserTransport => user != null);
}
