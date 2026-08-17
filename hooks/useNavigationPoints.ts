import { useRef, useCallback } from 'react';

export function useNavigationPoints() {
  const navStartTimeRef     = useRef<Date | null>(null);
  const estimatedMinutesRef = useRef<number | null>(null);

    // Wywołaj gdy startuje nawigacja
    const onNavigationStart = useCallback((estimatedMinutes: number) => {
        navStartTimeRef.current     = new Date();
        estimatedMinutesRef.current = estimatedMinutes; // już minuty — bez konwersji
    }, []);

  // Wywołaj gdy nawigacja się kończy (dotarcie do celu)
  const onNavigationComplete = useCallback(async (distanceKm: number) => {
    if (!navStartTimeRef.current) return;

    // Reset
    navStartTimeRef.current     = null;
    estimatedMinutesRef.current = null;


    // Punkty za dystans zapisuje wyłącznie zweryfikowane zakończenie przejazdu.
    // Nawigacja nie ma osobnej nagrody ani bonusu za wcześniejszy dojazd.
    void distanceKm;
  }, []);

  // Wywołaj gdy nawigacja przerwana — bez punktów
  const onNavigationCancel = useCallback(() => {
    navStartTimeRef.current     = null;
    estimatedMinutesRef.current = null;
  }, []);

  return { onNavigationStart, onNavigationComplete, onNavigationCancel };
}
