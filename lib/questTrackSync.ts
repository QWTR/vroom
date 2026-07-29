import { refreshQuestTrack } from './questTrack';

/** Odświeża postęp po zapisaniu aktywności lub checkpointu dystansu. */
export async function syncQuestTrackAfterDistanceSave(): Promise<void> {
  await refreshQuestTrack({ force: true });
}
