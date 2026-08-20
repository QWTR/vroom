import type { Club, ClubChannel, ClubMemberItem, ClubRank } from './types';

export type ClubManagementTab = 'overview' | 'channels' | 'roles' | 'members';

export interface DraftClubCategory {
  key: string;
  id: number | null;
  name: string;
  position: number;
}

export interface DraftClubChannel {
  key: string;
  id: number | null;
  name: string;
  categoryKey: string | null;
  position: number;
  isDefaultGeneral: boolean;
  isReadOnly: boolean;
}

export const CLUB_RANK_COLORS = [
  '#e33835', '#ff7a45', '#f5c518', '#4de926', '#00bfff', '#748ffc', '#b36bff', '#f06595',
];

export const CLUB_PERMISSION_DEFINITIONS = [
  { key: 'canManage', label: 'Zarządzanie klubem', description: 'Edycja profilu klubu, kategorii i kanałów.' },
  { key: 'canKick', label: 'Wyrzucanie członków', description: 'Może usuwać członków z klubu.' },
  { key: 'canMute', label: 'Wyciszanie członków', description: 'Może czasowo blokować wysyłanie wiadomości.' },
  { key: 'canPin', label: 'Przypinanie wiadomości', description: 'Może przypinać i odpinać wiadomości.' },
  { key: 'canWriteReadOnly', label: 'Kanały tylko do odczytu', description: 'Może pisać na zablokowanych kanałach.' },
] as const;

export type ClubPermissionKey = typeof CLUB_PERMISSION_DEFINITIONS[number]['key'];

export function createDraftKey(prefix: 'category' | 'channel'): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function slugifyChannelName(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase('pl-PL')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ł/g, 'l')
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
}

export function buildDraftStructure(club: Pick<Club, 'categories' | 'channels'>): {
  categories: DraftClubCategory[];
  channels: DraftClubChannel[];
} {
  const categories = [...(club.categories ?? [])]
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0) || a.id - b.id)
    .map((category, index) => ({
      key: `category_${category.id}`,
      id: category.id,
      name: category.name,
      position: index,
    }));

  const channels = [...(club.channels ?? [])]
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0) || a.id - b.id)
    .map((channel, index) => ({
      key: `channel_${channel.id}`,
      id: channel.id,
      name: channel.name,
      categoryKey: channel.categoryId ? `category_${channel.categoryId}` : null,
      position: index,
      isDefaultGeneral: !!channel.isDefaultGeneral,
      isReadOnly: !!channel.isReadOnly,
    }));

  return { categories, channels };
}

export function moveDraftItem<T extends { position: number }>(items: T[], index: number, direction: -1 | 1): T[] {
  const nextIndex = index + direction;
  if (index < 0 || nextIndex < 0 || nextIndex >= items.length) return items;
  const next = [...items];
  const [item] = next.splice(index, 1);
  next.splice(nextIndex, 0, item);
  return next.map((entry, position) => ({ ...entry, position }));
}

export function getMemberRanks(member: Pick<ClubMemberItem, 'ranks' | 'rank'>): ClubRank[] {
  const ranks = Array.isArray(member.ranks) ? member.ranks : (member.rank ? [member.rank] : []);
  return [...ranks].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0) || a.id - b.id);
}

export function hasClubPermission(club: Pick<Club, 'myRole' | 'myRanks' | 'myRank'>, permission: ClubPermissionKey): boolean {
  if (club.myRole === 'owner') return true;
  const ranks = Array.isArray(club.myRanks) ? club.myRanks : (club.myRank ? [club.myRank] : []);
  return ranks.some((rank) => rank[permission] === true);
}

export function groupChannelsByCategory(
  categories: DraftClubCategory[],
  channels: DraftClubChannel[],
): { key: string; name: string; channels: DraftClubChannel[] }[] {
  const sections = categories.map((category) => ({
    key: category.key,
    name: category.name,
    channels: channels.filter((channel) => channel.categoryKey === category.key),
  }));
  const uncategorized = channels.filter((channel) => channel.categoryKey == null);
  if (uncategorized.length > 0) sections.push({ key: 'uncategorized', name: 'Bez kategorii', channels: uncategorized });
  return sections;
}

export function mapDraftChannelToClubChannel(channel: DraftClubChannel, categoryId: number | null): ClubChannel {
  return {
    id: channel.id ?? 0,
    name: channel.name,
    categoryId,
    position: channel.position,
    isDefaultGeneral: channel.isDefaultGeneral,
    isReadOnly: channel.isReadOnly,
  };
}
