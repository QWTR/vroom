import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LiveUserPinSpriteData } from '../components/map/LiveUserPinSpriteVisual';

/** Dokładny rozmiar PNG w atlasie Mapbox (px) — pigułka + awatar + grot. */
export const LIVE_USER_PIN_SPRITE_W = 140;
export const LIVE_USER_PIN_SPRITE_H = 100;
/** Docelowy rozmiar pinu na mapie [pt] — skalowany proporcjonalnie do szerszego sprite'a. */
export const LIVE_USER_PIN_DISPLAY_PT = 101;

export function liveUserPinIconSize(): number {
  return LIVE_USER_PIN_DISPLAY_PT / LIVE_USER_PIN_SPRITE_W;
}

export function liveUserPinImageKey(id: number): string {
  return `avatar_${id}`;
}

export type PinSpriteRequest = {
  id: number;
  signature: string;
  data: LiveUserPinSpriteData;
  compact?: boolean;
};

const MAX_CACHE = 300;
const MAX_PARALLEL_CAPTURES = 24;

export function buildPinSpriteSignature(input: {
  id: number;
  avatarUrl: string;
  avatarFrameUrl: string;
  isPremium: boolean;
  isFriend: boolean;
  initials: string;
  distanceLabel: string;
}): string {
  return [
    input.id,
    input.avatarUrl,
    input.avatarFrameUrl,
    input.isPremium ? '1' : '0',
    input.isFriend ? '1' : '0',
    input.initials,
    input.distanceLabel,
    'v3',
  ].join('|');
}

export function useLiveUserPinSprites(requests: PinSpriteRequest[]) {
  const [images, setImages] = useState<Record<string, { uri: string }>>({});
  const cacheRef = useRef(new Map<string, string>());
  const [activeSignatures, setActiveSignatures] = useState<string[]>([]);

  const requestKey = useMemo(
    () => requests.map((r) => r.signature).sort().join(';;'),
    [requests],
  );

  const publish = useCallback(() => {
    const next: Record<string, { uri: string }> = {};
    for (const req of requests) {
      const uri = cacheRef.current.get(req.signature);
      if (uri) next[liveUserPinImageKey(req.id)] = { uri };
    }
    setImages(next);
  }, [requests]);

  const handleCapture = useCallback((imageKey: string, uri: string) => {
    const req = requests.find((r) => liveUserPinImageKey(r.id) === imageKey);
    if (!req) return;
    if (cacheRef.current.size >= MAX_CACHE) {
      const first = cacheRef.current.keys().next().value;
      if (first) cacheRef.current.delete(first);
    }
    cacheRef.current.set(req.signature, uri);
    publish();
    setActiveSignatures((prev) => prev.filter((s) => s !== req.signature));
  }, [requests, publish]);

  useEffect(() => {
    const activeSigs = new Set(requests.map((r) => r.signature));
    for (const key of cacheRef.current.keys()) {
      if (!activeSigs.has(key)) cacheRef.current.delete(key);
    }

    const missing = requests
      .filter((r) => !cacheRef.current.has(r.signature))
      .map((r) => r.signature);

    setActiveSignatures((prev) => {
      const keep = prev.filter((s) => missing.includes(s));
      const room = MAX_PARALLEL_CAPTURES - keep.length;
      const add = missing.filter((s) => !keep.includes(s)).slice(0, Math.max(0, room));
      return [...keep, ...add];
    });

    publish();
  }, [requestKey, requests, publish]);

  const pendingCaptures = useMemo(
    () => requests.filter((r) => activeSignatures.includes(r.signature)),
    [requests, activeSignatures],
  );

  return { images, pendingCaptures, handleCapture };
}
