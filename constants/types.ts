import type { PremiumVisual } from '../components/user/PremiumIdentity';

export interface User {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  avatar?: string;
  avatarFrameUrl?: string;
  status?: string;
  distance?: number;
  isFriend?: boolean;
  isPremium?: boolean;
  premiumVisual?: PremiumVisual | null;
}

export interface LocationState {
  latitude: number;
  longitude: number;
  name?: string;
  placeId?: string;
}

export interface RouteInfo {
  distance: string;
  duration: number;
}
