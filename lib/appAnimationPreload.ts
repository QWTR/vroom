import { Image as ExpoImage } from 'expo-image';
import { normalizeMediaUri } from './mediaUri';

type AnimationPreloadItem = {
  assetUrl?: string | null;
  assetKind?: string | null;
};

const lottieCache = new Map<string, unknown>();
const lottiePending = new Map<string, Promise<unknown>>();

function isLikelyLottie(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const obj = value as Record<string, unknown>;
  return Array.isArray(obj.layers) && (typeof obj.v === 'string' || typeof obj.fr === 'number');
}

export function getCachedRemoteLottieJson(uri: string | null | undefined) {
  return uri ? lottieCache.get(uri) ?? null : null;
}

export async function loadRemoteLottieJson(uri: string, timeoutMs = 10000) {
  const cached = lottieCache.get(uri);
  if (cached) return cached;

  const pending = lottiePending.get(uri);
  if (pending) return pending;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const task = fetch(uri, {
    signal: controller.signal,
    headers: {
      Accept: 'application/json,text/plain,*/*',
      'Cache-Control': 'no-cache',
      Pragma: 'no-cache',
    },
  })
    .then(async (res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = JSON.parse(await res.text());
      if (!isLikelyLottie(json)) throw new Error('Invalid Lottie JSON');
      lottieCache.set(uri, json);
      return json;
    })
    .finally(() => {
      clearTimeout(timeout);
      lottiePending.delete(uri);
    });

  lottiePending.set(uri, task);
  return task;
}

export async function preloadAppAnimations(animations: AnimationPreloadItem[]) {
  const tasks = animations
    .map((animation) => {
      const uri = normalizeMediaUri(animation.assetUrl);
      if (!uri) return null;
      const kind = String(animation.assetKind || '').toLowerCase();
      if (kind === 'lottie') return loadRemoteLottieJson(uri).catch(() => null);
      if (kind === 'gif' || kind === 'image') return ExpoImage.prefetch(uri).catch(() => false);
      return null;
    })
    .filter(Boolean) as Promise<unknown>[];

  await Promise.allSettled(tasks);
}
