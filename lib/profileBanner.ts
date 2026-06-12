import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImageManipulator from 'expo-image-manipulator';
import { Dimensions, Image as RNImage } from 'react-native';
import type { ImageContentPosition } from 'expo-image';
import { API_URL } from '../constants/config';
import type { ProfileBannerFocusPoint } from '../constants/profilePremiumExtras';

/** Ułamek wysokości ekranu zajmowany przez hero baner w ProfileView. */
export const HERO_BANNER_HEIGHT_RATIO = 0.7;

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

/** Wysokość hero banera (px) — ta sama formuła co w ProfileView. */
export function getHeroBannerHeight(
  screenHeight = Dimensions.get('window').height,
): number {
  return screenHeight * HERO_BANNER_HEIGHT_RATIO;
}

/** width / height — proporcja kontenera hero (cover). */
export function getHeroBannerAspectRatio(): number {
  const { width, height } = Dimensions.get('window');
  return width / getHeroBannerHeight(height);
}

/**
 * Proporcje dla expo-image-picker `aspect` — dopasowane do hero (nie 21:9).
 * Np. telefon ~9:19 → ok. [10, 15].
 */
export function getHeroBannerCropAspect(): [number, number] {
  const { width, height } = Dimensions.get('window');
  const w = Math.round(width);
  const h = Math.round(getHeroBannerHeight(height));
  const g = gcd(w, h);
  return [Math.max(1, Math.round(w / g)), Math.max(1, Math.round(h / g))];
}

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
  const targetRatio = getHeroBannerAspectRatio();
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

export type BannerCropTransform = {
  /** Mnożnik na bazowy scale „cover” (≥ 1). */
  scale: number;
  translateX: number;
  translateY: number;
};

export function getCoverBaseScale(
  imgW: number,
  imgH: number,
  frameW: number,
  frameH: number,
): number {
  return Math.max(frameW / imgW, frameH / imgH);
}

export function clampBannerCropTransform(
  imgW: number,
  imgH: number,
  frameW: number,
  frameH: number,
  transform: BannerCropTransform,
): BannerCropTransform {
  const userScale = Math.max(1, Math.min(4, transform.scale));
  const baseScale = getCoverBaseScale(imgW, imgH, frameW, frameH);
  const totalScale = baseScale * userScale;
  const dispW = imgW * totalScale;
  const dispH = imgH * totalScale;

  let tx = transform.translateX;
  let ty = transform.translateY;

  if (dispW >= frameW) {
    const max = (dispW - frameW) / 2;
    tx = Math.max(-max, Math.min(max, tx));
  } else {
    tx = 0;
  }

  if (dispH >= frameH) {
    const max = (dispH - frameH) / 2;
    ty = Math.max(-max, Math.min(max, ty));
  } else {
    ty = 0;
  }

  return { scale: userScale, translateX: tx, translateY: ty };
}

/** Mapuje widoczny obszar kadru (px ekranu modala) na prostokąt crop w pikselach źródła. */
export function computeBannerCropFromViewport(
  imgW: number,
  imgH: number,
  frameW: number,
  frameH: number,
  transform: BannerCropTransform,
): { originX: number; originY: number; width: number; height: number } {
  const t = clampBannerCropTransform(imgW, imgH, frameW, frameH, transform);
  const totalScale = getCoverBaseScale(imgW, imgH, frameW, frameH) * t.scale;
  const cropW = frameW / totalScale;
  const cropH = frameH / totalScale;

  const imageLeft = (frameW - imgW * totalScale) / 2 + t.translateX;
  const imageTop = (frameH - imgH * totalScale) / 2 + t.translateY;

  let originX = (-imageLeft) / totalScale;
  let originY = (-imageTop) / totalScale;

  originX = Math.max(0, Math.min(originX, imgW - cropW));
  originY = Math.max(0, Math.min(originY, imgH - cropH));

  return {
    originX: Math.round(originX),
    originY: Math.round(originY),
    width: Math.round(Math.min(cropW, imgW - originX)),
    height: Math.round(Math.min(cropH, imgH - originY)),
  };
}

export function focusPointFromCrop(
  imgH: number,
  crop: { originY: number; height: number },
): ProfileBannerFocusPoint {
  const mid = crop.originY + crop.height / 2;
  if (mid < imgH * 0.33) return 'top';
  if (mid > imgH * 0.67) return 'bottom';
  return 'center';
}

export async function prepareBannerFromViewport(
  uri: string,
  imgW: number,
  imgH: number,
  frameW: number,
  frameH: number,
  transform: BannerCropTransform,
): Promise<{ uri: string; width: number; height: number; focusPoint: ProfileBannerFocusPoint }> {
  const crop = computeBannerCropFromViewport(imgW, imgH, frameW, frameH, transform);
  try {
    const out = await ImageManipulator.manipulateAsync(
      uri,
      [{ crop }],
      { compress: 0.88, format: ImageManipulator.SaveFormat.JPEG },
    );
    return { uri: out.uri, width: out.width, height: out.height, focusPoint: 'center' };
  } catch {
    return { uri, width: imgW, height: imgH, focusPoint: 'center' };
  }
}

/** @deprecated Użyj prepareBannerFromViewport — zostaje dla kompatybilności. */
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
