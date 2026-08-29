import { Platform, Share } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';

async function tryMediaLibrarySave(uri: string): Promise<boolean> {
  try {
    const MediaLibrary = require('expo-media-library') as typeof import('expo-media-library');
    if (Platform.OS === 'ios') {
      const { status } = await MediaLibrary.requestPermissionsAsync(true);
      if (status !== 'granted') return false;
    }
    await MediaLibrary.saveToLibraryAsync(uri);
    return true;
  } catch {
    return false;
  }
}

/** Zapisuje gotowy obraz bez otwierania systemowego arkusza udostępniania. */
export async function saveImageToGallery(uri: string): Promise<boolean> {
  const fileUri = await ensureFileUri(uri);
  return tryMediaLibrarySave(fileUri);
}

async function trySharing(uri: string): Promise<boolean> {
  try {
    const Sharing = require('expo-sharing') as typeof import('expo-sharing');
    if (!(await Sharing.isAvailableAsync())) return false;
    await Sharing.shareAsync(uri, { mimeType: 'image/png', UTI: 'public.png' });
    return true;
  } catch {
    return false;
  }
}

async function ensureFileUri(uri: string): Promise<string> {
  if (!uri.startsWith('file://') && !uri.startsWith('content://')) {
    const dest = `${FileSystem.cacheDirectory}vroom-story-${Date.now()}.png`;
    await FileSystem.copyAsync({ from: uri, to: dest });
    return dest;
  }
  if (uri.startsWith('file://')) return uri;
  const dest = `${FileSystem.cacheDirectory}vroom-story-${Date.now()}.png`;
  await FileSystem.copyAsync({ from: uri, to: dest });
  return dest;
}

/** Zapis do galerii lub share sheet — działa też bez expo-media-library w binarce. */
export async function saveOrShareImage(uri: string): Promise<'saved' | 'shared' | 'cancelled'> {
  const fileUri = await ensureFileUri(uri);

  if (await tryMediaLibrarySave(fileUri)) return 'saved';
  if (await trySharing(fileUri)) return 'shared';

  const result = await Share.share(
    Platform.OS === 'ios'
      ? { url: fileUri, title: 'VROOM Story' }
      : { message: 'VROOM Story', title: 'VROOM Story', url: fileUri },
  );
  if (result.action === Share.dismissedAction) return 'cancelled';
  return 'shared';
}
