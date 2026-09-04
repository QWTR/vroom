export type LiveUserMarkerMetrics = {
  avatar: number;
  labelWidth: number;
  nameSize: number;
  statusSize: number;
};

function interpolate(value: number, from: number, to: number, outFrom: number, outTo: number) {
  if (value <= from) return outFrom;
  if (value >= to) return outTo;
  return outFrom + ((value - from) / (to - from)) * (outTo - outFrom);
}

export function liveUserMarkerMetrics(zoom: number): LiveUserMarkerMetrics {
  const safeZoom = Number.isFinite(zoom) ? zoom : 11;
  return {
    avatar: Math.round(interpolate(safeZoom, 3, 18, 34, 42)),
    labelWidth: Math.round(interpolate(safeZoom, 3, 18, 72, 88)),
    nameSize: interpolate(safeZoom, 3, 18, 9.5, 11),
    statusSize: interpolate(safeZoom, 3, 18, 7.2, 8.2),
  };
}

export function formatLiveMarkerUsername(username: string): string {
  const clean = username.trim() || 'Użytkownik';
  return clean.length <= 15 ? clean : `${clean.slice(0, 14)}…`;
}
