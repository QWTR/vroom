import { normalizeTextSizePreference, type TextSizePreference } from '../constants/typography';

export const TEXT_SIZE_PREFERENCE_KEY = 'vroom_readability_text_size';

export type PreferenceStorage = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<unknown>;
};

export async function loadTextSizePreference(storage: PreferenceStorage): Promise<TextSizePreference> {
  try {
    return normalizeTextSizePreference(await storage.getItem(TEXT_SIZE_PREFERENCE_KEY));
  } catch {
    return 'standard';
  }
}

export async function saveTextSizePreference(
  storage: PreferenceStorage,
  value: TextSizePreference,
): Promise<TextSizePreference> {
  const normalized = normalizeTextSizePreference(value);
  await storage.setItem(TEXT_SIZE_PREFERENCE_KEY, normalized);
  return normalized;
}
