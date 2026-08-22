import { useEffect } from 'react';
import { AppState } from 'react-native';
import { destroySharedSocket, ensureSharedSocket, pauseSharedSocket } from '../../lib/sharedSocket';

export function SharedSocketBootstrap() {
  useEffect(() => {
    if (AppState.currentState === 'active') void ensureSharedSocket();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void ensureSharedSocket();
      else pauseSharedSocket();
    });
    return () => {
      subscription.remove();
      destroySharedSocket();
    };
  }, []);
  return null;
}
