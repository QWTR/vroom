const TECHNICAL_ACTIVITY_SOURCES = new Set([
  'trip-checkpoint',
  'background-passive',
]);

const FINAL_ACTIVITY_SOURCES = new Set([
  'drive_final',
  'navigation_final',
]);

export function isVisibleRideHistoryItem(item: any): boolean {
  if (!item || item.visibleInHistory === false) return false;

  const source = typeof item.source === 'string' ? item.source : '';
  const distance = Number(item.distance ?? 0);

  if (TECHNICAL_ACTIVITY_SOURCES.has(source)) return false;

  if (FINAL_ACTIVITY_SOURCES.has(source)) {
    return Number.isFinite(distance) && distance >= 0.05;
  }

  // Match server: distance >= 1 km is enough even without route geometry.
  return Number.isFinite(distance) && distance >= 1;
}

export function filterVisibleRideHistory(items: any[]): any[] {
  return (Array.isArray(items) ? items : []).filter(isVisibleRideHistoryItem);
}
