export type ShopItemCategory = 'avatar_frame' | 'profile_banner' | 'entrance_effect';

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
}

export interface UserShopCosmetics {
  avatarFrame: ShopCosmeticItem | null;
  profileBanner: ShopCosmeticItem | null;
  entranceEffect: ShopCosmeticItem | null;
}

export const SHOP_CATEGORY_LABELS: Record<ShopItemCategory, string> = {
  avatar_frame: 'Obramówki avatara',
  profile_banner: 'Banery profilu',
  entrance_effect: 'Efekty wejścia',
};

export const SHOP_CATEGORY_META: Record<
  ShopItemCategory,
  { label: string; subtitle: string; icon: 'account-circle' | 'panorama' | 'auto-awesome'; accent: string }
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
};

export const SHOP_CATEGORIES: ShopItemCategory[] = [
  'avatar_frame',
  'profile_banner',
  'entrance_effect',
];
