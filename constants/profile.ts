export interface UserProfile {
  id: number;
  username: string;
  location?: string;
  bio?: string;
  avatarUrl?: string;
  bannerUrl?: string | null;
  createdAt: string;
  totalDistance: number;
  dailyDistance?: number;
  topSpeed?: number;
  avgSpeed?: number;
  avgMaxSpeed?: number;
  monthlyDistance?: number;
  weeklyDistance?: number;
  totalRides?: number;
  monthlyRides?: number;
  streak?: number;
  points: number;
  meetCount: number;
  cityCount: number;
  position: number | null;
  isPremium?: boolean;
  premiumExpiresAt?: string | null;
  nickColor?: string | null;
  profileThemePreset?: string;
  avatarFramePreset?: string;
  accountTheme?: any;
  isOwner?: boolean; 
  followersCount?: number;  
  followingCount?: number;
  club?: {
    id:          number;
    name:        string;
    avatarUrl:   string | null;
    memberCount: number;
    myRole:      string;
    myRank:      { name: string; color: string } | null;
  } | null;
}

export interface Car {
  id: number;
  brand: string;
  specs: string;
  isMain: boolean;
  photos: string[];  // tablica URL-i zdjęć
  ownerId: number;
}

export interface SpotPreview {
  id: number;
  name: string;
  category: string;
  photos: string[];
  latitude: number;
  longitude: number;
  createdAt: string;
  likesCount: number;
  commentsCount: number;
  isLiked: boolean;
}

export interface AchievementRecord {
  id: number;
  type: string;
  label: string;
  active: boolean;
  unlockedAt: string;
}

export const ALL_ACHIEVEMENTS = [
  { type: 'first_meet',  icon: 'flag',                  label: 'Pierwszy Zlot' },
  { type: 'ten_meets',   icon: 'local-fire-department', label: '10 Zlotów'     },
  { type: 'km_1000',     icon: 'military-tech',         label: '1000 km'       },
  { type: 'night_rider', icon: 'nights-stay',           label: 'Night Rider'   },
  { type: 'drift_king',  icon: 'directions-car',        label: 'Drift King'    },
  { type: 'organizer',   icon: 'star',                  label: 'Organizator'   },
] as const;