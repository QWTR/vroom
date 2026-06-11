import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImageManipulator from 'expo-image-manipulator';
import { Image as RNImage } from 'react-native';
import type { ImageContentPosition } from 'expo-image';
import { API_URL } from '../constants/config';
import type { ProfileBannerFocusPoint } from '../constants/profilePremiumExtras';

export const BANNER_ASPECT: [number, number] = [21, 9];
export const BANNER_ASPECT_RATIO = 21 / 9;

const getToken = async () =>
  (await AsyncStorage.getItem('userToken')) ?? (await AsyncStorage.getItem('token'));

function getImageSize(uri: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    RNImage.getSize(uri, (width, height) => resolve({ width, height }), reject);
  });
}

function computeBannerCropRect(
  srcW: number,
  srcH: number,
  focusPoint: ProfileBannerFocusPoint,
): { originX: number; originY: number; width: number; height: number } {
  const targetRatio = BANNER_ASPECT_RATIO;
  const srcRatio = srcW / srcH;

  let cropW: number;
  let cropH: number;
  if (srcRatio > targetRatio) {
    cropH = srcH;
    cropW = srcH * targetRatio;
  } else {
    cropW = srcW;
    cropH = srcW / targetRatio;
  }

  const originX = Math.max(0, Math.round((srcW - cropW) / 2));
  let originY: number;
  switch (focusPoint) {
    case 'top':
      originY = 0;
      break;
    case 'bottom':
      originY = Math.max(0, Math.round(srcH - cropH));
      break;
    case 'center':
    default:
      originY = Math.max(0, Math.round((srcH - cropH) / 2));
  }

  return {
    originX,
    originY,
    width: Math.min(Math.round(cropW), srcW - originX),
    height: Math.min(Math.round(cropH), srcH - originY),
  };
}

export function resolveBannerContentPosition(
  focus: ProfileBannerFocusPoint | null | undefined,
): ImageContentPosition {
  switch (focus) {
    case 'top':
      return 'top center';
    case 'bottom':
      return 'bottom center';
    case 'center':
    default:
      return 'center center';
  }
}

/** Przygotowanie pliku przed uploadem — crop 21:9 wg focus point + kompresja JPEG. */
export async function prepareBannerForUpload(
  uri: string,
  focusPoint: ProfileBannerFocusPoint = 'center',
): Promise<{ uri: string; width: number; height: number }> {
  try {
    const { width: srcW, height: srcH } = await getImageSize(uri);
    const crop = computeBannerCropRect(srcW, srcH, focusPoint);
    const actions: ImageManipulator.Action[] = [];

    const needsCrop =
      crop.width < srcW - 1 ||
      crop.height < srcH - 1 ||
      crop.originX > 0 ||
      crop.originY > 0;
    if (needsCrop) {
      actions.push({ crop });
    }

    const out = await ImageManipulator.manipulateAsync(uri, actions, {
      compress: 0.85,
      format: ImageManipulator.SaveFormat.JPEG,
    });
    return { uri: out.uri, width: out.width, height: out.height };
  } catch {
    try {
      const out = await ImageManipulator.manipulateAsync(
        uri,
        [],
        { compress: 0.85, format: ImageManipulator.SaveFormat.JPEG },
      );
      return { uri: out.uri, width: out.width, height: out.height };
    } catch {
      return { uri, width: 0, height: 0 };
    }
  }
}

export async function uploadProfileBanner(
  localUri: string,
): Promise<{ ok: true; bannerUrl: string } | { ok: false; error: string }> {
  try {
    const token = await getToken();
    if (!token) return { ok: false, error: 'Brak sesji — zaloguj się ponownie.' };

    const formData = new FormData();
    formData.append('banner', {
      uri: localUri,
      name: `banner_${Date.now()}.jpg`,
      type: 'image/jpeg',
    } as any);

    const res = await fetch(`${API_URL}/api/profile/banner`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    });

    if (!res.ok) {
      let msg = `Błąd serwera (${res.status})`;
      try {
        const j = await res.json();
        if (j?.error && typeof j.error === 'string') msg = j.error;
      } catch { /* ignore */ }
      return { ok: false, error: msg };
    }

    const data = await res.json();
    if (!data?.bannerUrl) return { ok: false, error: 'Serwer nie zwrócił adresu banera.' };
    return { ok: true, bannerUrl: data.bannerUrl };
  } catch {
    return { ok: false, error: 'Brak połączenia przy wysyłaniu banera.' };
  }
}

export async function deleteProfileBanner(): Promise<{ ok: boolean; error?: string }> {
  try {
    const token = await getToken();
    if (!token) return { ok: false, error: 'Brak sesji' };
    const res = await fetch(`${API_URL}/api/profile/banner`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return { ok: false, error: 'Nie udało się usunąć banera.' };
    return { ok: true };
  } catch {
    return { ok: false, error: 'Brak połączenia' };
  }
}
