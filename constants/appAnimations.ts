export type AppAnimationSlot =
  | 'home_streak'
  | 'home_premium_badge'
  | 'home_announcement'
  | 'community_daily_duel_vs'
  | 'community_quick_access'
  | 'tab_active_icon'
  | 'app_loading_logo';

export interface AppAnimationMeta {
  durationMs?: number;
  loop?: boolean;
  widthPct?: number;
  heightPct?: number;
  topPct?: number;
  leftPct?: number;
  dimOpacity?: number;
  opacity?: number;
  appAnimationSlot?: string;
}

export interface AppAnimation {
  id: string;
  name: string;
  description?: string | null;
  slot: AppAnimationSlot;
  assetUrl: string;
  previewUrl?: string | null;
  assetKind?: 'lottie' | 'gif' | 'image' | string;
  sortOrder?: number;
  isActive?: boolean;
  minValue?: number | null;
  maxValue?: number | null;
  metadata?: AppAnimationMeta | null;
}

export function valueMatchesAnimation(animation: AppAnimation, value?: number | null) {
  if (value == null) return animation.minValue == null && animation.maxValue == null;
  if (animation.minValue != null && value < animation.minValue) return false;
  if (animation.maxValue != null && value > animation.maxValue) return false;
  return true;
}

export function pickAppAnimationForValue(
  animations: AppAnimation[],
  slot: AppAnimationSlot,
  value?: number | null,
) {
  return animations
    .filter((animation) => animation.slot === slot && valueMatchesAnimation(animation, value))
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))[0] ?? null;
}
