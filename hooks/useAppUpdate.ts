import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import * as Updates from 'expo-updates';
import { downloadAndApplyUpdate, toUpdateProgressPercent } from '../lib/appUpdateCore';

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

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const CHECK_UI_TIMEOUT_MS = 10_000;

type NativeCheckResult = Awaited<ReturnType<typeof Updates.checkForUpdateAsync>>;
type NativeFetchResult = Awaited<ReturnType<typeof Updates.fetchUpdateAsync>>;

let checkInFlight: Promise<NativeCheckResult> | null = null;
let fetchInFlight: Promise<NativeFetchResult> | null = null;

function checkForUpdateOnce(): Promise<NativeCheckResult> {
  if (!checkInFlight) {
    checkInFlight = Updates.checkForUpdateAsync().finally(() => {
      checkInFlight = null;
    });
  }
  return checkInFlight;
}

function fetchUpdateOnce(): Promise<NativeFetchResult> {
  if (!fetchInFlight) {
    fetchInFlight = Updates.fetchUpdateAsync().finally(() => {
      fetchInFlight = null;
    });
  }
  return fetchInFlight;
}

async function waitWithSoftTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
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
  const nativeState = Updates.useUpdates();
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [phase, setPhase] = useState<'idle' | 'downloading' | 'restarting'>('idle');
  const [error, setError] = useState<string | null>(null);
  const applyInFlightRef = useRef<Promise<void> | null>(null);
  const dismissedDuringDownloadRef = useRef(false);
  const updatePendingRef = useRef(nativeState.isUpdatePending);

  useEffect(() => {
    if (nativeState.isUpdatePending) updatePendingRef.current = true;
  }, [nativeState.isUpdatePending]);

  const checkForUpdate = useCallback(async (opts?: { retries?: number }): Promise<boolean> => {
    if (__DEV__ || !Updates.isEnabled) {
      setUpdateAvailable(false);
      return false;
    }
    if (updatePendingRef.current) {
      setUpdateAvailable(true);
      setError(null);
      return true;
    }

    const retries = Math.max(1, opts?.retries ?? 3);
    let lastError: string | null = null;

    for (let attempt = 1; attempt <= retries; attempt += 1) {
      try {
        const result = await waitWithSoftTimeout(
          checkForUpdateOnce(),
          CHECK_UI_TIMEOUT_MS,
          'Sprawdzanie aktualizacji',
        );
        const available = result.isAvailable || result.isRollBackToEmbedded;
        setUpdateAvailable(available);
        setError(null);
        return available;
      } catch (e: unknown) {
        lastError = e instanceof Error ? e.message : String(e);
        console.warn(`[useAppUpdate] checkForUpdate attempt ${attempt}/${retries}:`, lastError);
        if (attempt < retries) await sleep(800);
      }
    }

    setUpdateAvailable(false);
    setError('Nie udało się sprawdzić aktualizacji. Spróbuj ponownie później.');
    throw new Error(lastError ?? 'Nie udało się sprawdzić aktualizacji.');
  }, []);

  const applyUpdate = useCallback(async () => {
    if (__DEV__ || !Updates.isEnabled) return;
    if (applyInFlightRef.current) return applyInFlightRef.current;

    dismissedDuringDownloadRef.current = false;
    const operation = (async () => {
      setPhase('downloading');
      setError(null);
      try {
        const outcome = await downloadAndApplyUpdate({
          updateAlreadyPending: updatePendingRef.current,
          fetchUpdate: fetchUpdateOnce,
          reload: () => Updates.reloadAsync(),
          canReloadNow: () => (
            AppState.currentState === 'active' && !dismissedDuringDownloadRef.current
          ),
          onBeforeReload: () => {
            updatePendingRef.current = true;
            setPhase('restarting');
          },
        });

        if (outcome === 'downloaded') {
          updatePendingRef.current = true;
          setUpdateAvailable(true);
          setError(null);
          return;
        }

        if (outcome === 'not-available') {
          setUpdateAvailable(true);
          setError('Ta paczka nie jest już dostępna. Sprawdź aktualizacje ponownie.');
        }
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        console.warn('[useAppUpdate] applyUpdate error:', message);
        setUpdateAvailable(true);
        setError('Nie udało się pobrać aktualizacji. Sprawdź internet i spróbuj ponownie.');

        void Updates.readLogEntriesAsync(60 * 60 * 1000)
          .then((entries) => {
            const recentErrors = entries
              .filter((entry) => entry.level === 'error' || entry.level === 'fatal')
              .slice(-6)
              .map(({ code, message: logMessage, assetId, updateId }) => ({
                code,
                message: logMessage,
                assetId,
                updateId,
              }));
            if (recentErrors.length) {
              console.warn('[useAppUpdate] native diagnostics:', recentErrors);
            }
          })
          .catch(() => {});
      } finally {
        setPhase('idle');
        applyInFlightRef.current = null;
      }
    })();

    applyInFlightRef.current = operation;
    return operation;
  }, []);

  const dismiss = useCallback(() => {
    dismissedDuringDownloadRef.current = true;
    setUpdateAvailable(false);
    setError(null);
  }, []);

  const restarting = phase === 'restarting' || nativeState.isRestarting;
  const downloading = phase !== 'idle' || nativeState.isDownloading || nativeState.isRestarting;
  const downloadProgress = restarting
    ? 100
    : toUpdateProgressPercent(nativeState.downloadProgress);

  return {
    updateAvailable,
    downloading,
    restarting,
    downloadProgress,
    error,
    checkForUpdate,
    applyUpdate,
    dismiss,
    getUpdateDiagnostics,
  };
}
