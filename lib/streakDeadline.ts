/** Lokalna kopia logiki serwera — deadline resetu streaku (PL, grace 04:00). */
const STREAK_TZ = 'Europe/Warsaw';
const STREAK_DAY_GRACE_MS = 4 * 60 * 60 * 1000;

const ymdFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: STREAK_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function streakYmdFromMs(ms: number): string {
  return ymdFormatter.format(new Date(ms - STREAK_DAY_GRACE_MS));
}

export function getNextStreakResetIso(nowMs = Date.now()): string {
  const currentDay = streakYmdFromMs(nowMs);
  let lo = nowMs;
  let hi = nowMs + 50 * 3600000;
  while (hi - lo > 500) {
    const mid = Math.floor((lo + hi) / 2);
    if (streakYmdFromMs(mid) === currentDay) lo = mid;
    else hi = mid;
  }
  return new Date(hi).toISOString();
}
