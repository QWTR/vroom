import { useCallback, useState } from 'react';
import * as Updates from 'expo-updates';

/**
 * OTA tylko na żądanie użytkownika (app.json: checkAutomatically NEVER).
 * Bez auto-pobierania przy starcie — najpierw modal „Aktualizuj”.
 */
export function useAppUpdate() {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const checkForUpdate = useCallback(async (): Promise<boolean> => {
    if (__DEV__ || !Updates.isEnabled) {
      setUpdateAvailable(false);
      return false;
    }

    try {
      const result = await Updates.checkForUpdateAsync();
      const available = !!result.isAvailable;
      setUpdateAvailable(available);
      return available;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn('[useAppUpdate] checkForUpdate error:', msg);
      setUpdateAvailable(false);
      return false;
    }
  }, []);

  const applyUpdate = useCallback(async () => {
    if (__DEV__ || !Updates.isEnabled) return;

    setDownloading(true);
    setError(null);
    try {
      const fetched = await Updates.fetchUpdateAsync();
      if (!fetched.isNew) {
        setError('Brak nowego pakietu do zainstalowania.');
        setDownloading(false);
        return;
      }
      await Updates.reloadAsync();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn('[useAppUpdate] applyUpdate error:', msg);
      setError('Nie udało się pobrać aktualizacji.');
      setDownloading(false);
    }
  }, []);

  const dismiss = useCallback(() => {
    setUpdateAvailable(false);
    setError(null);
  }, []);

  return {
    updateAvailable,
    downloading,
    error,
    checkForUpdate,
    applyUpdate,
    dismiss,
  };
}
