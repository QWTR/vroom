export const PREVIEW_CLIP_MS = 30000;

export type MusicTrimSource = 'deezer' | 'spotify' | 'itunes' | 'audius' | 'original' | string;

export function isFullTrackSource(sourceType?: MusicTrimSource | null): boolean {
  return sourceType === 'audius';
}

/** Długość pliku audio dostępnego do przycinania (nie długość utworu w sklepie). */
export function trimAudioDurationMs(
  sourceType?: MusicTrimSource | null,
  declaredDurationMs?: number | null,
): number {
  if (isFullTrackSource(sourceType)) {
    return Math.max(1000, declaredDurationMs ?? 120000);
  }
  if (sourceType === 'original') {
    return Math.max(1000, declaredDurationMs ?? PREVIEW_CLIP_MS);
  }
  return PREVIEW_CLIP_MS;
}

/** Domyślna długość zaznaczenia w panelu trim. */
export function defaultTrimSelectionMs(sourceType?: MusicTrimSource | null): number {
  return isFullTrackSource(sourceType) ? 30000 : 15000;
}

export const TRIM_SCRUB_HEADROOM_MS = 4000;

export function effectiveTrimSelectionMs(
  sourceType: MusicTrimSource | null | undefined,
  selectionMs: number,
  audioDurationMs: number,
): number {
  const want = Math.min(Math.max(1000, selectionMs), audioDurationMs);
  if (isFullTrackSource(sourceType)) return want;

  const headroom = Math.min(
    TRIM_SCRUB_HEADROOM_MS,
    Math.max(2000, Math.floor(audioDurationMs * 0.12)),
  );
  if (audioDurationMs - want >= headroom) return want;
  return Math.max(5000, audioDurationMs - headroom);
}

export function clampTrimStartMs(
  startMs: number,
  audioDurationMs: number,
  selectionMs: number,
): number {
  const maxStart = Math.max(0, audioDurationMs - selectionMs);
  return Math.max(0, Math.min(startMs, maxStart));
}

export function previewSourceHint(sourceType?: MusicTrimSource | null): string {
  switch (sourceType) {
    case 'deezer':
      return 'Deezer daje 30 s podglądu — nie całą nutę. Przesuń falę w tym fragmencie. Pełny utwór: wybierz z Audius.';
    case 'spotify':
      return 'Spotify daje krótki podgląd (~30 s). Pełny utwór: wybierz z Audius.';
    case 'itunes':
      return 'Apple Music daje krótki podgląd (~30 s). Pełny utwór: wybierz z Audius.';
    case 'audius':
      return 'Przesuń falę — słyszysz wybrany fragment z całej nuty.';
    default:
      return 'Przesuń falę — od razu słyszysz wybrany fragment w podglądzie';
  }
}
