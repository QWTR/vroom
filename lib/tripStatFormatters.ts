export function finiteStat(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, number) : 0;
}

export function formatSpeedKmh(value: unknown): string {
  return String(Math.round(finiteStat(value)));
}

export function formatDistanceKm(value: unknown): string {
  return finiteStat(value).toFixed(1);
}

export function normalizeTripSpeed(value: unknown): number {
  return Math.round(finiteStat(value));
}
