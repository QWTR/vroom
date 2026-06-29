export type ShopItemCategory =
  | 'avatar_frame'
  | 'profile_banner'
  | 'entrance_effect'
  | 'profile_background_animation'
  | 'map_vehicle_3d'
  | 'limited_vehicle_slot';

export interface VehicleModelMeta {
  rendererVersion?: 3;
  scale: [number, number, number];
  yawOffset: number;
  /** Sentinel: rozwiązany yaw dla mobilnego renderera (z korektą +180). Czyni normalize idempotentnym. */
  mobileYawOffset?: number;
  pitch?: number;
  roll?: number;
  pivotX?: number;
  pivotY?: number;
  elevationZ?: number;
  /** Legacy aliases accepted from older API/admin data. */
  rotationOffset?: number;
  rotationPitch?: number;
  rotationRoll?: number;
  translation?: [number, number, number];
  /** Kierunek drogi w kalibratorze panelu admina — tylko edytor */
  calibrationHeading?: number;
  minZoom: number;
}

export interface ShopCosmeticItem {
  id: string;
  name: string;
  description?: string | null;
  category: ShopItemCategory;
  assetUrl: string;
  previewUrl?: string;
  assetKind?: string;
  nitroCost?: number;
  tagLine?: string | null;
  metadata?: (VehicleModelMeta & Record<string, unknown>) | Record<string, unknown> | null;
  maxSupply?: number | null;
  soldCount?: number;
  soldOut?: boolean;
  available?: boolean;
}

export interface UserShopCosmetics {
  avatarFrame: ShopCosmeticItem | null;
  profileBanner: ShopCosmeticItem | null;
  entranceEffect: ShopCosmeticItem | null;
  backgroundAnimation: ShopCosmeticItem | null;
  globalEntranceEffect?: ShopCosmeticItem | null;
  globalBackgroundAnimation?: ShopCosmeticItem | null;
  mapVehicle: ShopCosmeticItem | null;
}

export const SHOP_CATEGORY_LABELS: Record<ShopItemCategory, string> = {
  avatar_frame: 'Obramówki avatara',
  profile_banner: 'Banery profilu',
  entrance_effect: 'Efekty wejścia',
  profile_background_animation: 'Animacje tła',
  map_vehicle_3d: 'Pojazdy 3D',
  limited_vehicle_slot: 'Pojazd limitowany',
};

export const SHOP_CATEGORY_META: Record<
  ShopItemCategory,
  { label: string; subtitle: string; icon: 'account-circle' | 'panorama' | 'auto-awesome' | 'directions-car' | 'stars'; accent: string }
> = {
  avatar_frame: {
    label: 'Obramówki avatara',
    subtitle: 'Animowane ramki na avatar — widoczne na mapie i profilu',
    icon: 'account-circle',
    accent: '#a855f7',
  },
  profile_banner: {
    label: 'Banery profilu',
    subtitle: 'Nagłówek profilu jak na Discordzie',
    icon: 'panorama',
    accent: '#38bdf8',
  },
  entrance_effect: {
    label: 'Efekty wejścia',
    subtitle: 'Animacja przy wejściu na Twój profil',
    icon: 'auto-awesome',
    accent: '#f59e0b',
  },
  profile_background_animation: {
    label: 'Animacje tła',
    subtitle: 'Ruchome tło profilu widoczne przy wejściu',
    icon: 'auto-awesome',
    accent: '#22d3ee',
  },
  map_vehicle_3d: {
    label: 'Pojazdy 3D',
    subtitle: 'Modele 3D jako marker na mapie — widoczne dla innych z Premium',
    icon: 'directions-car',
    accent: '#e33835',
  },
  limited_vehicle_slot: {
    label: 'Pojazd limitowany',
    subtitle: 'Zamów własny model 3D na podstawie Twojego auta',
    icon: 'stars',
    accent: '#FFD700',
  },
};

export const SHOP_CATEGORIES: ShopItemCategory[] = [
  'avatar_frame',
  'profile_banner',
  'entrance_effect',
  'profile_background_animation',
  'map_vehicle_3d',
  'limited_vehicle_slot',
];

export const VEHICLE_SHOP_CATEGORIES: ShopItemCategory[] = [
  'map_vehicle_3d',
  'limited_vehicle_slot',
];
