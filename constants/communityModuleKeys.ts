/** Stable keys for community module icons (admin slot: community_module_icon). */
export const COMMUNITY_MODULE_KEYS = [
  'discussions',
  'chats',
  'events',
  'rankings',
  'grid',
  'clubs',
  'public_chat',
  'market',
] as const;

export type CommunityModuleKey = (typeof COMMUNITY_MODULE_KEYS)[number];

export const COMMUNITY_MODULE_LABELS: Record<CommunityModuleKey, string> = {
  discussions: 'Dyskusje',
  chats: 'Chat',
  events: 'Wydarzenia',
  rankings: 'Rankingi',
  grid: 'The Grid',
  clubs: 'Kluby',
  public_chat: 'Czat ogólny',
  market: 'Giełda',
};
