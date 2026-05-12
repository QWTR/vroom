import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';

export const BACKGROUND_LOCATION_DISCLOSURE_KEY = 'background_location_disclosure_accepted_v2';

export async function hasAcceptedBackgroundLocationDisclosure(): Promise<boolean> {
  return (await AsyncStorage.getItem(BACKGROUND_LOCATION_DISCLOSURE_KEY)) === 'true';
}

export async function acceptBackgroundLocationDisclosure(): Promise<void> {
  await AsyncStorage.setItem(BACKGROUND_LOCATION_DISCLOSURE_KEY, 'true');
}

export async function requestBackgroundLocationPermissionAfterDisclosure(): Promise<boolean> {
  await acceptBackgroundLocationDisclosure();

  const fg = await Location.requestForegroundPermissionsAsync();
  if (fg.status !== 'granted') return false;

  const bg = await Location.requestBackgroundPermissionsAsync();
  return bg.status === 'granted';
}
