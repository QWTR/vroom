import AsyncStorage from '@react-native-async-storage/async-storage';
import { APP_TUTORIAL_STORAGE } from '../constants/appTutorial';

export async function isTutorialPending(): Promise<boolean> {
  return (await AsyncStorage.getItem(APP_TUTORIAL_STORAGE.pending)) === '1';
}

export async function isTutorialCompleted(): Promise<boolean> {
  return (await AsyncStorage.getItem(APP_TUTORIAL_STORAGE.completed)) === '1';
}

export async function setTutorialPending(): Promise<void> {
  await AsyncStorage.setItem(APP_TUTORIAL_STORAGE.pending, '1');
}

export async function shouldAutoShowTutorial(): Promise<boolean> {
  const pending = await isTutorialPending();
  if (!pending) return false;
  const completed = await isTutorialCompleted();
  return !completed;
}

export async function markTutorialCompleted(): Promise<void> {
  await AsyncStorage.setItem(APP_TUTORIAL_STORAGE.completed, '1');
  await AsyncStorage.removeItem(APP_TUTORIAL_STORAGE.pending);
}

export async function clearTutorialPending(): Promise<void> {
  await AsyncStorage.removeItem(APP_TUTORIAL_STORAGE.pending);
}
