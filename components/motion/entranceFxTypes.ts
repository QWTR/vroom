export type EntranceFxPresetId =
  | 'arena-duel'
  | 'arena-grid'
  | 'live-chat'
  | 'club'
  | 'market'
  | 'support-calm'
  | 'garage'
  | 'nav-start';

export type EntranceFxTier = 'full' | 'lite';

export type EntranceShowOncePolicy = 'always' | 'session' | 'day' | 'never';

export type EntranceMotionMode = 'full' | 'reduced' | 'off';

export interface EntranceFxAccentColors {
  primary: string;
  secondary: string;
  tertiary?: string;
  cyan?: string;
}

export interface EntranceFxPreset {
  id: EntranceFxPresetId;
  durationMs: number;
  eyebrow: string;
  title: string;
  subtitle: string;
  bgGradient: [string, string, string];
  gateLeftGradient: [string, string, string];
  gateRightGradient: [string, string, string];
  accents: EntranceFxAccentColors;
  showVsRow?: boolean;
  showGates?: boolean;
  showClash?: boolean;
  showOncePolicy: EntranceShowOncePolicy;
  iconLeft?: string;
  iconRight?: string;
}

export interface EntranceFxMeta extends Partial<EntranceFxPreset> {
  presetId?: EntranceFxPresetId;
  durationMs?: number;
  accentPrimary?: string;
  showOncePer?: EntranceShowOncePolicy;
}
