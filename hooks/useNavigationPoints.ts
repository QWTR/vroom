import { useRef, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Toast from 'react-native-toast-message';
import { API_URL } from '../constants/mapConfig';

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

    const actualMinutes    = Math.round((Date.now() - navStartTimeRef.current.getTime()) / 60000);
    const estimatedMinutes = estimatedMinutesRef.current;

    // Reset
    navStartTimeRef.current     = null;
    estimatedMinutesRef.current = null;


    try {
      const token = await AsyncStorage.getItem('token');
      if (!token) return;

      const res  = await fetch(`${API_URL}/api/live/navigation/complete`, {
        method:  'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization:  `Bearer ${token}`,
        },
        body: JSON.stringify({ distanceKm, estimatedMinutes, actualMinutes }),
      });

      const data = await res.json();
      if (!res.ok || data.points === 0) return;

      Toast.show({
        type:           'success',
        text1:          `🏆 +${data.points} PUNKTÓW!`,
        text2:          data.breakdown.join(' · '),
        visibilityTime: 5000,
      });
    } catch (e) {
      console.log('onNavigationComplete error:', e);
    }
  }, []);

  // Wywołaj gdy nawigacja przerwana — bez punktów
  const onNavigationCancel = useCallback(() => {
    navStartTimeRef.current     = null;
    estimatedMinutesRef.current = null;
  }, []);

  return { onNavigationStart, onNavigationComplete, onNavigationCancel };
}