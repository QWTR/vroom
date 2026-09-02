import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  TEXT_SIZE_SCALES,
  type TextSizePreference,
} from '../constants/typography';
import {
  loadTextSizePreference,
  saveTextSizePreference,
  TEXT_SIZE_PREFERENCE_KEY,
} from '../lib/readabilityPreference';

export { TEXT_SIZE_PREFERENCE_KEY };

type ReadabilityContextValue = {
  textSize: TextSizePreference;
  textScale: number;
  setTextSize: (value: TextSizePreference) => Promise<void>;
};

const ReadabilityContext = createContext<ReadabilityContextValue>({
  textSize: 'standard',
  textScale: 1,
  setTextSize: async () => {},
});

export function ReadabilityProvider({ children }: { children: React.ReactNode }) {
  const [textSize, setTextSizeState] = useState<TextSizePreference>('standard');

  useEffect(() => {
    let active = true;
    loadTextSizePreference(AsyncStorage)
      .then((stored) => {
        if (active) setTextSizeState(stored);
      })
      .catch(() => {});
    return () => { active = false; };
  }, []);

  const setTextSize = useCallback(async (value: TextSizePreference) => {
    const normalized = await saveTextSizePreference(AsyncStorage, value);
    setTextSizeState(normalized);
  }, []);

  const value = useMemo(() => ({
    textSize,
    textScale: TEXT_SIZE_SCALES[textSize],
    setTextSize,
  }), [setTextSize, textSize]);

  return <ReadabilityContext.Provider value={value}>{children}</ReadabilityContext.Provider>;
}

export function useReadability() {
  return useContext(ReadabilityContext);
}
