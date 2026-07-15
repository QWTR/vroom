import * as ImagePicker from 'expo-image-picker';

export type PickedVroomkiMedia =
  | { kind: 'video'; video: string }
  | { kind: 'photos'; photos: string[] };

export async function pickVroomkiMediaFromGallery(): Promise<PickedVroomkiMedia | null> {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.All,
    quality: 0.86,
    allowsMultipleSelection: true,
    selectionLimit: 6,
    videoMaxDuration: 90,
  });

  if (result.canceled || !result.assets?.length) return null;

  const videos = result.assets.filter((asset) => asset.type === 'video');
  const photos = result.assets.filter((asset) => asset.type !== 'video');

  if (videos.length > 0 && photos.length > 0) {
    Toast.show({
      type: 'info',
      text1: 'Wybierz film albo zdjęcia',
      text2: 'Nie można mieszać filmu ze zdjęciami',
    });
    return null;
  }

  if (videos.length > 0) {
    return { kind: 'video', video: videos[0].uri };
  }

  if (photos.length > 0) {
    return { kind: 'photos', photos: photos.map((asset) => asset.uri).slice(0, 6) };
  }

  return null;
}
