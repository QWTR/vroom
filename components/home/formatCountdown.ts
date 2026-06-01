export function formatCountdown(targetIso: string | null, nowMs: number): string | null {
  if (!targetIso) return null;
  const targetMs = new Date(targetIso).getTime();
  if (!Number.isFinite(targetMs)) return null;
  let leftSec = Math.floor((targetMs - nowMs) / 1000);
  if (leftSec <= 0) return 'za chwilę';
  const days = Math.floor(leftSec / 86400);
  leftSec -= days * 86400;
  const hours = Math.floor(leftSec / 3600);
  leftSec -= hours * 3600;
  const minutes = Math.floor(leftSec / 60);
  const seconds = leftSec - minutes * 60;
  const hh = String(hours).padStart(2, '0');
  const mm = String(minutes).padStart(2, '0');
  const ss = String(seconds).padStart(2, '0');
  return days > 0 ? `${days}d ${hh}:${mm}:${ss}` : `${hh}:${mm}:${ss}`;
}
