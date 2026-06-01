/** Akcenty sekcji Społeczności — spójne w całym module. */
export const COMMUNITY_ACCENTS = {
  primary:   '#e33835',
  grid:      '#FFD700',
  clubs:     '#00bfff',
  public:    '#4de926',
  duel:      '#FFD700',
  duelAlt:   '#e33835',
} as const;

export type CommunityModuleAccent = keyof typeof COMMUNITY_ACCENTS | string;
