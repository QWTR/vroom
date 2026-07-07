import type { ProfilePremiumExtras } from './profilePremiumExtras';
import type { UserShopCosmetics } from './shopCosmetics';

export type ProfileMusicSource = 'spotify' | 'deezer' | 'itunes' | 'audius';

export interface SpotifyProfileTrack {
  sourceType?: ProfileMusicSource | null;
  trackId: string;
  url: string;
  trackName: string;
  artistName?: string | null;
  thumbnailUrl?: string | null;
  /** ~30s MP3 preview URL from Spotify Web API (may be null for some tracks). */
  previewUrl?: string | null;
  /** When true, visitors hear preview automatically on public profile (stored in profile JSON). */
  previewAutoplay?: boolean;
  embedHtml?: string | null;
  providerName?: string | null;
}

export interface GamificationProfileSummary {
  explorationMap?: {
    averagePercent: number;
    country?: {
      slug: string;
      name: string;
      percentComplete: number;
      cellsRevealed: number;
      totalCells: number;
    } | null;
    startedRegions: number;
    completedRegions: number;
    totalRevealedCells: number;
    topRegions: {
      slug: string;
      name: string;
      type: string;
      cellsRevealed: number;
      totalCells: number;
      percentComplete: number;
      lastDrivenAt?: string | null;
    }[];
  };
  fogOfWar: {
    averagePercent: number;
    country?: {
      slug: string;
      name: string;
      percentComplete: number;
      cellsRevealed: number;
      totalCells: number;
    } | null;
    startedRegions?: number;
    completedRegions?: number;
    totalRevealedCells?: number;
    totalCells?: number;
    topRegions: {
      slug: string;
      name: string;
      type: string;
      cellsRevealed: number;
      totalCells: number;
      percentComplete: number;
      lastDrivenAt?: string | null;
    }[];
  };
  turf: {
    crownCount?: number;
    crowns: {
      slug?: string;
      name?: string;
      type?: string;
      regionSlug?: string;
      regionName?: string;
      regionType?: string;
      distanceKm: number;
      year?: number;
      month?: number;
      crownedAt?: string | null;
    }[];
  };
  passport: {
    totalStamps: number;
    cityCount: number;
    voivodeshipCount: number;
    latest?: {
      slug: string;
      name: string;
      type: string;
      firstSeenAt: string;
    }[];
    latestStamps?: {
      slug: string;
      name: string;
      type: string;
      firstSeenAt: string;
    }[];
  };
}

export interface UserProfile {
  id: number;
  username: string;
  location?: string;
  province?: string | null;
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
  isAdmin?: boolean;
  premiumExpiresAt?: string | null;
  nickColor?: string | null;
  profileThemePreset?: string;
  avatarFramePreset?: string;
  accountTheme?: any;
  profilePremiumExtras?: ProfilePremiumExtras | null;
  spotifyProfileTrack?: SpotifyProfileTrack | null;
  isOwner?: boolean; 
  followersCount?: number;  
  followingCount?: number;
  nitroBalance?: number;
  shopCosmetics?: UserShopCosmetics | null;
  gamificationSummary?: GamificationProfileSummary | null;
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
