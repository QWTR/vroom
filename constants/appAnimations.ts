import type { CommunityModuleKey } from './communityModuleKeys';

export type AppAnimationSlot =
  | 'home_streak'
  | 'home_premium_badge'
  | 'home_announcement'
  | 'community_daily_duel_vs'
  | 'community_quick_access'
  | 'community_module_icon'
  | 'tab_active_icon'
  | 'app_loading_logo';

export type AppAnimationLayoutMode = 'inline' | 'behind';

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
  /** inline = ikona w miejscu; behind = tło pod tekstem (np. streak). */
  layoutMode?: AppAnimationLayoutMode;
  /** community_module_icon — który moduł społeczności. */
  moduleKey?: CommunityModuleKey | string;
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

export function readAnimationModuleKey(animation: AppAnimation | null | undefined): string | null {
  const key = animation?.metadata?.moduleKey;
  return key != null && String(key).trim() ? String(key).trim() : null;
}

export function pickAppAnimationForModuleKey(
  animations: AppAnimation[],
  moduleKey: string,
) {
  const key = String(moduleKey || '').trim();
  if (!key) return null;
  return animations
    .filter((animation) => {
      if (animation.slot !== 'community_module_icon') return false;
      return readAnimationModuleKey(animation) === key;
    })
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))[0] ?? null;
}

export function resolveAnimationLayoutMode(
  animation: AppAnimation | null | undefined,
  fallback: AppAnimationLayoutMode = 'inline',
): AppAnimationLayoutMode {
  const mode = animation?.metadata?.layoutMode;
  return mode === 'behind' ? 'behind' : mode === 'inline' ? 'inline' : fallback;
}
