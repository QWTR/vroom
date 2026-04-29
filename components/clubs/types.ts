export interface ClubRank {
  id:        number;
  name:      string;
  color:     string;
  canKick:   boolean;
  canMute:   boolean;
  canPin:    boolean;
  canManage: boolean;
  priority:  number;
}

export interface ClubMemberItem {
  id:        number;
  userId:    number;
  // Bezpośrednio lub zagnieżdżone w user{} — defensive w komponencie
  username:  string;
  avatarUrl: string | null;
  role:      string;
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
  /** Gdy true: brak push z czatu tego klubu (tylko dla Ciebie) */
  myClubPushMuted?: boolean;
  ranks?:      ClubRank[];
  categories?: { id: number; name: string; position: number }[];
  channels?:   { id: number; name: string; categoryId: number | null; position: number; isDefaultGeneral?: boolean }[];
  joinNotificationChannelId?: number | null;
  members?:    ClubMemberItem[];
}