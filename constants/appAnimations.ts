import type { CommunityModuleKey } from './communityModuleKeys';

export type AppAnimationSlot =
  | 'home_streak'
  | 'home_premium_badge'
  | 'home_announcement'
  | 'home_system_news'
  | 'home_buy_coffee'
  | 'community_daily_duel_vs'
  | 'community_quick_access'
  | 'community_module_icon'
  | 'tab_active_icon'
  | 'app_loading_logo'
  | 'screen_entrance_duel'
  | 'screen_entrance_grid'
  | 'screen_entrance_public'
  | 'screen_entrance_club'
  | 'screen_entrance_market'
  | 'screen_entrance_support'
  | 'achievement_unlock';

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
  /** screen_entrance_* — preset HUD gdy brak zdalnego asseta. */
  presetId?: string;
  accentPrimary?: string;
  showOncePer?: 'always' | 'session' | 'day' | 'never';
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

const SCREEN_ENTRANCE_SLOTS: AppAnimationSlot[] = [
  'screen_entrance_duel',
  'screen_entrance_grid',
  'screen_entrance_public',
  'screen_entrance_club',
  'screen_entrance_market',
  'screen_entrance_support',
];

export function isScreenEntranceSlot(slot: AppAnimationSlot): boolean {
  return SCREEN_ENTRANCE_SLOTS.includes(slot);
}

export function pickScreenEntranceAnimation(
  animations: AppAnimation[],
  slot: AppAnimationSlot,
) {
  return animations
    .filter(a => a.slot === slot && a.isActive !== false)
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))[0] ?? null;
}

export function readEntrancePresetId(animation: AppAnimation | null | undefined): string | null {
  const id = animation?.metadata?.presetId;
  return id != null && String(id).trim() ? String(id).trim() : null;
}
