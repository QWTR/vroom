import React, { createContext, useContext, useMemo, useState } from 'react';

type StartupGatesContextValue = {
  /** Splash + wymagany regulamin UGC zakończone. */
  gatesSettled: boolean;
  setGatesSettled: (v: boolean) => void;
  /** Globalny modal z _layout (regulamin / lokalizacja w tle). */
  layoutGateOpen: boolean;
  setLayoutGateOpen: (v: boolean) => void;
  /** Modal na Home (prezent / ankieta) — blokuje kolejne zgody. */
  homeOverlayOpen: boolean;
  setHomeOverlayOpen: (v: boolean) => void;
};

const StartupGatesContext = createContext<StartupGatesContextValue | null>(null);

export function StartupGatesProvider({ children }: { children: React.ReactNode }) {
  const [gatesSettled, setGatesSettled] = useState(false);
  const [layoutGateOpen, setLayoutGateOpen] = useState(false);
  const [homeOverlayOpen, setHomeOverlayOpen] = useState(false);

  const value = useMemo(
    () => ({
      gatesSettled,
      setGatesSettled,
      layoutGateOpen,
      setLayoutGateOpen,
      homeOverlayOpen,
      setHomeOverlayOpen,
    }),
    [gatesSettled, layoutGateOpen, homeOverlayOpen],
  );

  return (
    <StartupGatesContext.Provider value={value}>
      {children}
    </StartupGatesContext.Provider>
  );
}

export function useStartupGates(): StartupGatesContextValue {
  const ctx = useContext(StartupGatesContext);
  if (!ctx) {
    return {
      gatesSettled: true,
      setGatesSettled: () => {},
      layoutGateOpen: false,
      setLayoutGateOpen: () => {},
      homeOverlayOpen: false,
      setHomeOverlayOpen: () => {},
    };
  }
  return ctx;
}
