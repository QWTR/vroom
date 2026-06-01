export type DailyDuelCarSide = {
  id: number;
  brand: string;
  specs: string;
  power: number;
  photo: string | null;
  photos: string[];
  owner: { id: number; username: string; avatarUrl: string | null };
};

export type DailyDuelData = {
  id: number;
  carA: DailyDuelCarSide;
  carB: DailyDuelCarSide;
  votesA: number;
  votesB: number;
  percentA: number;
  percentB: number;
  totalVotes: number;
  myVoteCarId: number | null;
  endsAt: string;
  duelDate: string;
};

export function formatDuelCount(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}K`;
  return String(n);
}

export function formatDuelTimer(msLeft: number): string {
  if (msLeft <= 0) return '00:00:00';
  let leftSec = Math.floor(msLeft / 1000);
  const hours = Math.floor(leftSec / 3600);
  leftSec -= hours * 3600;
  const minutes = Math.floor(leftSec / 60);
  const seconds = leftSec - minutes * 60;
  const hh = String(hours).padStart(2, '0');
  const mm = String(minutes).padStart(2, '0');
  const ss = String(seconds).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

export function getCarPhotos(car: DailyDuelCarSide): string[] {
  if (car.photos?.length) return car.photos;
  return car.photo ? [car.photo] : [];
}

export function carDisplayLabel(car: DailyDuelCarSide): string {
  const brand = (car.brand || '').trim().toUpperCase();
  const specs = (car.specs || '').trim();
  const short = specs.split(/[·•|]/)[0]?.trim().toUpperCase() ?? '';
  return short ? `${brand} ${short}`.trim() : brand || 'AUTO';
}
