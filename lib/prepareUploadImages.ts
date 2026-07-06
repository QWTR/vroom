import * as ImageManipulator from 'expo-image-manipulator';

const MAX_EDGE = 1440;
const JPEG_QUALITY = 0.82;

/** Resize/compress local image URIs before multipart upload (smaller payload, faster POST). */
export async function prepareUploadImages(uris: string[]): Promise<string[]> {
  if (!uris.length) return [];
  const out: string[] = [];
  for (const uri of uris) {
    try {
      const manipulated = await ImageManipulator.manipulateAsync(
        uri,
        [{ resize: { width: MAX_EDGE } }],
        { compress: JPEG_QUALITY, format: ImageManipulator.SaveFormat.JPEG },
      );
      out.push(manipulated.uri);
    } catch {
      out.push(uri);
    }
  }
  return out;
}
