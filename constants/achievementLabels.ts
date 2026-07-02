import type { Achievement } from '../hooks/useAchievements';

export const CATEGORY_LABELS: Record<string, string> = {
  distance: '🛣️  Dystans',
  rides: '🚗  Przejazdy',
  single_ride: '🏁  Długie trasy',
  speed: '⚡  Prędkość',
  streak: '🔥  Serie jazdy',
  map: '🗺️  Mapa i kafelki',
  cities: '🏙️  Miasta',
  exploration: '🧭  Rewiry',
  drops: '🎁  Zrzuty',
  duels: '🆚  Pojedynki',
  discussion: '📝  Dyskusje',
  chat: '💬  Czat',
  spots: '📍  Spoty',
  social: '👥  Społeczność',
  special: '⭐  Specjalne',
};

export const CATEGORY_ORDER = [
  'distance',
  'rides',
  'single_ride',
  'speed',
  'streak',
  'map',
  'cities',
  'exploration',
  'drops',
  'duels',
  'discussion',
  'chat',
  'spots',
  'social',
  'special',
] as const;

export const ACHIEVEMENTS_PROFILE_PREVIEW_LIMIT = 10;

export const RARITY_ORDER_LIST = ['legendary', 'epic', 'rare', 'common'] as const;

export const RARITY_META: Record<string, { label: string; color: string; border: string }> = {
  legendary: { label: 'LEGENDARY', color: '#f5c518', border: '#f5c51840' },
  epic:      { label: 'EPIC',      color: '#a338e3', border: '#a338e340' },
  rare:      { label: 'RARE',      color: '#38a5e3', border: '#38a5e340' },
  common:    { label: 'COMMON',    color: '#ff0202b2', border: '#ff020240' },
};

const RARITY_ORDER: Record<string, number> = {
  legendary: 0,
  epic: 1,
  rare: 2,
  common: 3,
};

export function sortAchievementsByRarity(list: Achievement[]): Achievement[] {
  return [...list].sort((a, b) => {
    const rarityDiff = (RARITY_ORDER[a.rarity ?? 'common'] ?? 3) - (RARITY_ORDER[b.rarity ?? 'common'] ?? 3);
    if (rarityDiff !== 0) return rarityDiff;
    return (b.points ?? 0) - (a.points ?? 0);
  });
}

export function groupAchievementsByRarity(list: Achievement[]) {
  return RARITY_ORDER_LIST.reduce((acc, rarity) => {
    const items = list.filter(a => (a.rarity ?? 'common') === rarity);
    return items.length ? [...acc, { rarity, items }] : acc;
  }, [] as { rarity: string; items: Achievement[] }[]);
}

export function groupAchievementsByCategory(list: Achievement[]) {
  const byCategory = new Map<string, Achievement[]>();
  for (const item of list) {
    const key = item.category ?? 'special';
    const bucket = byCategory.get(key) ?? [];
    bucket.push(item);
    byCategory.set(key, bucket);
  }

  const ordered = [...CATEGORY_ORDER];
  for (const key of byCategory.keys()) {
    if (!ordered.includes(key as typeof CATEGORY_ORDER[number])) ordered.push(key as typeof CATEGORY_ORDER[number]);
  }

  return ordered.reduce((acc, category) => {
    const items = byCategory.get(category);
    if (!items?.length) return acc;
    return [...acc, { category, items: sortAchievementsByRarity(items) }];
  }, [] as { category: string; items: Achievement[] }[]);
}

export function pickAchievementPreview(
  unlocked: Achievement[],
  limit = ACHIEVEMENTS_PROFILE_PREVIEW_LIMIT,
): { items: Achievement[]; hasMore: boolean } {
  const sorted = sortAchievementsByRarity(unlocked);
  const items = sorted.slice(0, limit);
  return { items, hasMore: unlocked.length > items.length };
}

export function getCategoryLabel(category: string): string {
  return CATEGORY_LABELS[category] ?? category;
}
