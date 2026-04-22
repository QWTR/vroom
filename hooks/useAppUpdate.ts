import { useEffect, useState } from 'react';
import * as Updates from 'expo-updates';
import { Alert } from 'react-native';

export function useAppUpdate() {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [downloading,     setDownloading]     = useState(false);
  const [error,           setError]           = useState<string | null>(null);

  useEffect(() => {
    checkForUpdate();
  }, []);

  const checkForUpdate = async () => {
    // Nie sprawdzaj w trybie dev lub gdy Updates nie jest skonfigurowane
    if (__DEV__ || !Updates.isEnabled) return;

    try {
      const result = await Updates.checkForUpdateAsync();
      if (result.isAvailable) setUpdateAvailable(true);
    } catch (e: any) {
      // Cicho loguj — nie pokazuj użytkownikowi błędu update
      console.warn('[useAppUpdate] checkForUpdate error:', e.message ?? e);
    }
  };

  const applyUpdate = async () => {
    setDownloading(true);
    try {
      await Updates.fetchUpdateAsync();
      await Updates.reloadAsync();
    } catch (e: any) {
      setError('Nie udało się pobrać aktualizacji.');
      setDownloading(false);
    }
  };

  return { updateAvailable, downloading, error, applyUpdate, dismiss: () => setUpdateAvailable(false) };
}