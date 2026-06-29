import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useRouter } from 'expo-router';
import { markTutorialCompleted } from '../hooks/useAppTutorial';
import { useStartupGates } from './StartupGatesContext';
import { APP_TUTORIAL_STEPS } from '../constants/appTutorial';

type AppTutorialContextValue = {
  tutorialOpen: boolean;
  stepIndex: number;
  isReplay: boolean;
  startAutoTutorial: () => void;
  startTutorialReplay: () => void;
  goNext: () => void;
  goBack: () => void;
  skipTutorial: () => void;
  completeTutorial: () => void;
};

const AppTutorialContext = createContext<AppTutorialContextValue | null>(null);

export function AppTutorialProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { setGatesSettled } = useStartupGates();
  const [tutorialOpen, setTutorialOpen] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [isReplay, setIsReplay] = useState(false);
  const isReplayRef = useRef(false);

  const closeTutorial = useCallback(
    async (markComplete: boolean) => {
      if (markComplete) await markTutorialCompleted();
      const wasReplay = isReplayRef.current;
      setTutorialOpen(false);
      setStepIndex(0);
      setIsReplay(false);
      isReplayRef.current = false;
      if (!wasReplay) setGatesSettled(true);
    },
    [setGatesSettled],
  );

  const startAutoTutorial = useCallback(() => {
    isReplayRef.current = false;
    setIsReplay(false);
    setStepIndex(0);
    setTutorialOpen(true);
  }, []);

  const startTutorialReplay = useCallback(() => {
    isReplayRef.current = true;
    setIsReplay(true);
    setStepIndex(0);
    setTutorialOpen(true);
    router.replace('/(tabs)');
  }, [router]);

  const goNext = useCallback(() => {
    setStepIndex(i => Math.min(i + 1, APP_TUTORIAL_STEPS.length - 1));
  }, []);

  const goBack = useCallback(() => {
    setStepIndex(i => Math.max(0, i - 1));
  }, []);

  const skipTutorial = useCallback(() => {
    void closeTutorial(true);
  }, [closeTutorial]);

  const completeTutorial = useCallback(() => {
    void closeTutorial(true);
  }, [closeTutorial]);

  const value = useMemo(
    () => ({
      tutorialOpen,
      stepIndex,
      isReplay,
      startAutoTutorial,
      startTutorialReplay,
      goNext,
      goBack,
      skipTutorial,
      completeTutorial,
    }),
    [
      tutorialOpen,
      stepIndex,
      isReplay,
      startAutoTutorial,
      startTutorialReplay,
      goNext,
      goBack,
      skipTutorial,
      completeTutorial,
    ],
  );

  return (
    <AppTutorialContext.Provider value={value}>
      {children}
    </AppTutorialContext.Provider>
  );
}

export function useAppTutorial(): AppTutorialContextValue {
  const ctx = useContext(AppTutorialContext);
  if (!ctx) {
    throw new Error('useAppTutorial must be used within AppTutorialProvider');
  }
  return ctx;
}
