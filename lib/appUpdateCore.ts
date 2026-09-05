export type UpdateFetchResultLike = {
  isNew: boolean;
  isRollBackToEmbedded: boolean;
};

export type UpdateApplyOutcome = 'restarted' | 'downloaded' | 'not-available';

type ApplyUpdateOptions = {
  updateAlreadyPending: boolean;
  fetchUpdate: () => Promise<UpdateFetchResultLike>;
  reload: () => Promise<void>;
  canReloadNow: () => boolean;
  onBeforeReload?: () => void;
};

/**
 * Downloads an OTA package and reloads only after Expo confirms that a
 * launchable update (or rollback directive) is present on the device.
 */
export async function downloadAndApplyUpdate({
  updateAlreadyPending,
  fetchUpdate,
  reload,
  canReloadNow,
  onBeforeReload,
}: ApplyUpdateOptions): Promise<UpdateApplyOutcome> {
  let readyToLaunch = updateAlreadyPending;

  if (!readyToLaunch) {
    const result = await fetchUpdate();
    readyToLaunch = result.isNew || result.isRollBackToEmbedded;
  }

  if (!readyToLaunch) return 'not-available';
  if (!canReloadNow()) return 'downloaded';

  onBeforeReload?.();
  await reload();
  return 'restarted';
}

export function toUpdateProgressPercent(progress?: number): number | null {
  if (typeof progress !== 'number' || !Number.isFinite(progress)) return null;
  return Math.round(Math.max(0, Math.min(1, progress)) * 100);
}
