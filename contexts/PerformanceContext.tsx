import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import {
  DEFAULT_PERFORMANCE_PROFILE,
  isPerformanceProfile,
  type PerformanceProfile,
} from '../lib/performance/policy';
import VroomCarPlay from '../modules/vroom-carplay';

const STORAGE_KEY = '@vroom/performance_profile:v1';
const DIAGNOSTICS_STORAGE_KEY = '@vroom/performance_diagnostics_enabled:v1';

type PerformanceContextValue = {
  profile: PerformanceProfile;
  hydrated: boolean;
  appState: AppStateStatus;
  appActive: boolean;
  diagnosticsEnabled: boolean;
  setProfile: (profile: PerformanceProfile) => Promise<void>;
  setDiagnosticsEnabled: (enabled: boolean) => Promise<void>;
};

const PerformanceContext = createContext<PerformanceContextValue | null>(null);

export function PerformanceProvider({ children }: { children: React.ReactNode }) {
  const [profile, setProfileState] = useState<PerformanceProfile>(DEFAULT_PERFORMANCE_PROFILE);
  const [diagnosticsEnabled, setDiagnosticsEnabledState] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [appState, setAppState] = useState<AppStateStatus>(AppState.currentState);

  useEffect(() => {
    let active = true;
    void AsyncStorage.multiGet([STORAGE_KEY, DIAGNOSTICS_STORAGE_KEY])
      .then((rows) => {
        if (!active) return;
        const storedProfile = rows[0]?.[1];
        setProfileState(isPerformanceProfile(storedProfile) ? storedProfile : DEFAULT_PERFORMANCE_PROFILE);
        setDiagnosticsEnabledState(rows[1]?.[1] === '1');
      })
      .finally(() => { if (active) setHydrated(true); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', setAppState);
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    VroomCarPlay?.setPerformanceProfile(profile);
  }, [hydrated, profile]);

  const setProfile = useCallback(async (next: PerformanceProfile) => {
    setProfileState(next);
    await AsyncStorage.setItem(STORAGE_KEY, next);
  }, []);

  const setDiagnosticsEnabled = useCallback(async (enabled: boolean) => {
    setDiagnosticsEnabledState(enabled);
    await AsyncStorage.setItem(DIAGNOSTICS_STORAGE_KEY, enabled ? '1' : '0');
  }, []);

  const value = useMemo<PerformanceContextValue>(() => ({
    profile,
    hydrated,
    appState,
    appActive: appState === 'active',
    diagnosticsEnabled,
    setProfile,
    setDiagnosticsEnabled,
  }), [appState, diagnosticsEnabled, hydrated, profile, setDiagnosticsEnabled, setProfile]);

  return <PerformanceContext.Provider value={value}>{children}</PerformanceContext.Provider>;
}

export function usePerformance(): PerformanceContextValue {
  const value = useContext(PerformanceContext);
  if (!value) throw new Error('usePerformance must be used inside PerformanceProvider');
  return value;
}
