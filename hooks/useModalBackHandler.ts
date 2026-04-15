import { useEffect, useRef } from 'react';
import { BackHandler } from 'react-native';

/**
 * Zamyka modal przyciskiem Back (Android).
 * @param visible  - czy modal jest widoczny
 * @param onBack   - co zrobić przy Back (domyślnie onClose)
 */
export function useModalBackHandler(
  visible: boolean,
  onBack: () => void,
) {
  // Ref żeby zawsze mieć świeżą funkcję bez re-rejestrowania listenera
  const onBackRef = useRef(onBack);
  useEffect(() => { onBackRef.current = onBack; }, [onBack]);

  useEffect(() => {
    if (!visible) return;

    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onBackRef.current();
      return true; // blokuje domyślne zamknięcie aplikacji
    });

    return () => sub.remove();
  }, [visible]); // tylko visible w deps — reszta przez ref
}