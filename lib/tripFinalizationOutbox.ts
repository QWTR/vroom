export type PendingTripFinalization = {
  tripSessionId: string;
  payload: Record<string, unknown>;
  createdAt: number;
};

type StoredOutbox = {
  version: 1;
  items: PendingTripFinalization[];
};

function isPendingFinalization(value: unknown): value is PendingTripFinalization {
  const item = value as PendingTripFinalization | null;
  return Boolean(
    item
      && typeof item.tripSessionId === 'string'
      && item.tripSessionId.length > 0
      && item.payload
      && typeof item.payload === 'object'
      && Number.isFinite(item.createdAt),
  );
}

/** Accepts the old single-item shape so an update cannot discard a queued trip. */
export function parseTripFinalizationOutbox(raw: string | null): PendingTripFinalization[] {
  if (!raw) return [];
  try {
    const value = JSON.parse(raw) as StoredOutbox | PendingTripFinalization;
    if (Array.isArray((value as StoredOutbox).items)) {
      return (value as StoredOutbox).items.filter(isPendingFinalization);
    }
    return isPendingFinalization(value) ? [value] : [];
  } catch {
    return [];
  }
}

export function serializeTripFinalizationOutbox(items: PendingTripFinalization[]): string {
  return JSON.stringify({ version: 1, items });
}

/** One idempotent server session may have only its newest final payload queued. */
export function enqueueTripFinalization(
  items: PendingTripFinalization[],
  next: PendingTripFinalization,
): PendingTripFinalization[] {
  return [...items.filter((item) => item.tripSessionId !== next.tripSessionId), next];
}

export function removeTripFinalization(
  items: PendingTripFinalization[],
  tripSessionId: string,
): PendingTripFinalization[] {
  return items.filter((item) => item.tripSessionId !== tripSessionId);
}
