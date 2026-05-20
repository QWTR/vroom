import { useCallback, useState } from 'react';
import * as Updates from 'expo-updates';

export type UpdateDiagnostics = {
  enabled: boolean;
  runtimeVersion: string | null;
  channel: string | null;
  updateId: string | null;
  isEmbeddedLaunch: boolean;
  isDev: boolean;
};

export function getUpdateDiagnostics(): UpdateDiagnostics {
  if (__DEV__) {
    return {
      enabled: false,
      runtimeVersion: null,
      channel: null,
      updateId: null,
      isEmbeddedLaunch: true,
      isDev: true,
    };
  }
  return {
    enabled: Updates.isEnabled,
    runtimeVersion: Updates.runtimeVersion ?? null,
    channel: Updates.channel ?? null,
    updateId: Updates.updateId ?? null,
    isEmbeddedLaunch: Updates.isEmbeddedLaunch,
    isDev: false,
  };
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const FETCH_TIMEOUT_MS = 90_000;

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} — przekroczono limit czasu`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * OTA tylko na żądanie użytkownika (app.json: checkAutomatically NEVER).
 * Modal „Aktualizuj” — użytkownik musi kliknąć, żeby pobrać i zrestartować.
 */
export function useAppUpdate() {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const checkForUpdate = useCallback(async (opts?: { retries?: number }): Promise<boolean> => {
    if (__DEV__ || !Updates.isEnabled) {
      setUpdateAvailable(false);
      return false;
    }

    const retries = Math.max(1, opts?.retries ?? 3);
    let lastError: string | null = null;

    for (let attempt = 1; attempt <= retries; attempt += 1) {
      try {
        const result = await Updates.checkForUpdateAsync();
        const available = !!result.isAvailable;
        setUpdateAvailable(available);
        setError(null);
        return available;
      } catch (e: unknown) {
        lastError = e instanceof Error ? e.message : String(e);
        console.warn(`[useAppUpdate] checkForUpdate attempt ${attempt}/${retries}:`, lastError);
        if (attempt < retries) await sleep(2000);
      }
    }

    setUpdateAvailable(false);
    setError(lastError);
    return false;
  }, []);

  const applyUpdate = useCallback(async () => {
    if (__DEV__ || !Updates.isEnabled) return;

    setDownloading(true);
    setError(null);
    try {
      // Natywny CHECK_ON_LAUNCH (AndroidManifest ALWAYS) często pobiera pakiet przed modalem.
      // fetchUpdateAsync() wtedy zwraca isNew=false — update jest już na dysku, trzeba reload.
      await withTimeout(Updates.fetchUpdateAsync(), FETCH_TIMEOUT_MS, 'Pobieranie aktualizacji');
      await Updates.reloadAsync();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn('[useAppUpdate] applyUpdate error:', msg);

      // Ostatnia szansa: pakiet mógł być już pobrany, a fetch/reload padł na sieci.
      try {
        await Updates.reloadAsync();
        return;
      } catch (reloadErr: unknown) {
        const reloadMsg = reloadErr instanceof Error ? reloadErr.message : String(reloadErr);
        console.warn('[useAppUpdate] reloadAsync fallback error:', reloadMsg);
      }

      const friendly =
        msg.includes('limit czasu')
          ? 'Pobieranie trwa zbyt długo. Sprawdź internet i spróbuj ponownie.'
          : 'Nie udało się zaktualizować. Sprawdź internet i spróbuj ponownie.';
      setError(friendly);
      setDownloading(false);
    }
  }, []);

  const dismiss = useCallback(() => {
    setUpdateAvailable(false);
    setError(null);
    setDownloading(false);
  }, []);

  return {
    updateAvailable,
    downloading,
    error,
    checkForUpdate,
    applyUpdate,
    dismiss,
    getUpdateDiagnostics,
  };
}
