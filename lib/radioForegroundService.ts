import { NativeModules, Platform } from 'react-native';

const service = NativeModules.VroomCbForeground as { start?: () => Promise<boolean>; stop?: () => Promise<boolean> } | undefined;

export async function startRadioForegroundService() {
  if (Platform.OS !== 'android') return true;
  if (!service?.start) throw new Error('Ta wersja aplikacji nie zawiera obsługi CB w tle. Zainstaluj nową wersję.');
  return service.start();
}

export async function stopRadioForegroundService() {
  if (Platform.OS !== 'android' || !service?.stop) return true;
  return service.stop();
}
