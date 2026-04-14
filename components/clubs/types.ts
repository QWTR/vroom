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
  username:  string;
  avatarUrl: string | null;
  role:      string;
  rank:      ClubRank | null;
  joinedAt:  string;
  isMuted:   boolean;
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
  ranks?:      ClubRank[];
  members?:    ClubMemberItem[];
}