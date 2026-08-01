export interface ClubRank {
  id:        number;
  name:      string;
  color:     string;
  canKick:   boolean;
  canMute:   boolean;
  canPin:    boolean;
  canManage: boolean;
  canWriteReadOnly?: boolean;
  priority:  number;
}

export interface ClubMemberItem {
  id:        number;
  userId:    number;
  // Bezpośrednio lub zagnieżdżone w user{} — defensive w komponencie
  username:  string;
  avatarUrl: string | null;
  role:      string;
  ranks?:    ClubRank[];
  /** Compatibility with older API responses. */
  rank:      ClubRank | null;
  joinedAt:  string;
  isMuted:   boolean;
  // Opcjonalna zagnieżdżona struktura z niektórych endpointów
  user?: {
    id:        number;
    username:  string;
    avatarUrl: string | null;
  };
}

export interface Club {
  id:          number;
  name:        string;
  description: string | null;
  avatarUrl:   string | null;
  isPrivate:   boolean;
  createdAt:   string;
  owner:       { id: number; username: string; avatarUrl: string | null };
  memberCount: number;
  isMember:    boolean;
  myRole:      'owner' | 'ranked' | 'member' | null;
  myRank:      ClubRank | null;
  myRanks?:    ClubRank[];
  /** Gdy true: brak push z czatu tego klubu (tylko dla Ciebie) */
  myClubPushMuted?: boolean;
  ranks?:      ClubRank[];
  categories?: { id: number; name: string; position: number }[];
  channels?:   ClubChannel[];
  joinNotificationChannelId?: number | null;
  members?:    ClubMemberItem[];
}

export interface ClubChannel {
  id: number;
  name: string;
  categoryId: number | null;
  position: number;
  isDefaultGeneral?: boolean;
  isReadOnly?: boolean;
}