import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect } from 'react';
import { AppState } from 'react-native';
import { drainSocialQueue } from '../../lib/socialQueue';

async function currentUserId(): Promise<number | undefined> {
  const raw = await AsyncStorage.getItem('user');
  if (!raw) return undefined;
  try {
    const user = JSON.parse(raw);
    const id = Number(user.id ?? user.userId);
    return Number.isInteger(id) ? id : undefined;
  } catch {
    return undefined;
  }
}

export function SocialQueueBootstrap() {
  useEffect(() => {
    let active = AppState.currentState === 'active';
    const drain = () => { if (active) void currentUserId().then((id) => drainSocialQueue(id)); };
    drain();
    const timer = setInterval(drain, 15_000);
    const subscription = AppState.addEventListener('change', (state) => {
      active = state === 'active';
      if (active) drain();
    });
    return () => {
      clearInterval(timer);
      subscription.remove();
    };
  }, []);
  return null;
}
