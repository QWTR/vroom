import { useEffect, useState } from 'react';
import * as Updates from 'expo-updates';
import { Alert } from 'react-native';

export function useAppUpdate() {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [downloading,     setDownloading]     = useState(false);
  const [error,           setError]           = useState<string | null>(null);

  useEffect(() => {
    // if (__DEV__) return;
    checkForUpdate();
  }, []);

  const checkForUpdate = async () => {
    try {
      const result = await Updates.checkForUpdateAsync();
      

      if (result.isAvailable) setUpdateAvailable(true);
    } catch (e: any) {
      Alert.alert('BŁĄD UPDATE', e.message ?? String(e));
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