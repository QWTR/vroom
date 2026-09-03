import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LiveUserPinSpriteData } from '../components/map/LiveUserPinSpriteVisual';

/** One self-contained LIVE marker. Position updates never change this bitmap. */
export const LIVE_USER_PIN_SPRITE_W = 136;
export const LIVE_USER_PIN_SPRITE_H = 56;
export const LIVE_USER_PIN_DISPLAY_PT = 116;

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
const MAX_PARALLEL_CAPTURES = 4;

export function fillPinCaptureQueue(
  requestSignatures: string[],
  cachedSignatures: string[],
  activeSignatures: string[],
  limit = MAX_PARALLEL_CAPTURES,
): string[] {
  const cached = new Set(cachedSignatures);
  const missing = requestSignatures.filter((signature) => !cached.has(signature));
  const keep = activeSignatures.filter((signature) => missing.includes(signature));
  const room = Math.max(0, limit - keep.length);
  const add = missing.filter((signature) => !keep.includes(signature)).slice(0, room);
  return [...keep, ...add];
}

export function buildPinSpriteSignature(input: {
  id: number;
  username: string;
  avatarUrl: string;
  avatarFrameUrl: string;
  isPremium: boolean;
  isFriend: boolean;
  initials: string;
  distanceLabel: string;
  stale?: boolean;
  visualVersion?: string | null;
}): string {
  return [
    input.id,
    input.username.trim(),
    input.avatarUrl,
    input.avatarFrameUrl,
    input.isPremium ? '1' : '0',
    input.isFriend ? '1' : '0',
    input.initials,
    input.stale ? 'stale' : 'online',
    input.visualVersion ?? 'free',
    'v7-profile-label',
  ].join('|');
}

export function useLiveUserPinSprites(requests: PinSpriteRequest[]) {
  const [images, setImages] = useState<Record<string, { uri: string }>>({});
  const cacheRef = useRef(new Map<string, string>());
  const lastUriByUserIdRef = useRef(new Map<number, string>());
  const [activeSignatures, setActiveSignatures] = useState<string[]>([]);

  const requestKey = useMemo(
    () => requests.map((r) => r.signature).sort().join(';;'),
    [requests],
  );

  const publish = useCallback(() => {
    const next: Record<string, { uri: string }> = {};
    for (const req of requests) {
      const uri = cacheRef.current.get(req.signature) ?? lastUriByUserIdRef.current.get(req.id);
      if (uri) next[liveUserPinImageKey(req.id)] = { uri };
    }
    setImages(next);
  }, [requests]);

  const handleCapture = useCallback((
    imageKey: string,
    capturedSignature: string,
    uri: string,
    final = true,
  ) => {
    const req = requests.find((r) => (
      liveUserPinImageKey(r.id) === imageKey && r.signature === capturedSignature
    ));
    if (!req) {
      if (final) {
        setActiveSignatures((prev) => prev.filter((s) => s !== capturedSignature));
      }
      return;
    }
    if (cacheRef.current.size >= MAX_CACHE) {
      const first = cacheRef.current.keys().next().value;
      if (first) cacheRef.current.delete(first);
    }
    cacheRef.current.set(capturedSignature, uri);
    lastUriByUserIdRef.current.set(req.id, uri);
    publish();
    if (final) {
      setActiveSignatures((prev) => {
        const remaining = prev.filter((s) => s !== capturedSignature);
        return fillPinCaptureQueue(
          requests.map((candidate) => candidate.signature),
          [...cacheRef.current.keys()],
          remaining,
        );
      });
    }
  }, [requests, publish]);

  useEffect(() => {
    setActiveSignatures((prev) => {
      const next = fillPinCaptureQueue(
        requests.map((request) => request.signature),
        [...cacheRef.current.keys()],
        prev,
      );
      return next.length === prev.length && next.every((signature, index) => signature === prev[index])
        ? prev
        : next;
    });

    publish();
  }, [requestKey, requests, publish]);

  const pendingCaptures = useMemo(
    () => requests.filter((r) => activeSignatures.includes(r.signature)),
    [requests, activeSignatures],
  );

  return { images, pendingCaptures, handleCapture };
}
