import { useEffect, useState } from 'react';

type RemoteLottieState = {
  data: unknown | null;
  loading: boolean;
  failed: boolean;
};

function isLikelyLottie(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const obj = value as Record<string, unknown>;
  return Array.isArray(obj.layers) && (typeof obj.v === 'string' || typeof obj.fr === 'number');
}

export function useRemoteLottieJson(uri: string | null | undefined, enabled = true) {
  const [state, setState] = useState<RemoteLottieState>({
    data: null,
    loading: false,
    failed: false,
  });

  useEffect(() => {
    if (!enabled || !uri) {
      setState({ data: null, loading: false, failed: false });
      return undefined;
    }

    let cancelled = false;
    const controller = new AbortController();
    setState({ data: null, loading: true, failed: false });

    fetch(uri, {
      signal: controller.signal,
      headers: {
        Accept: 'application/json,text/plain,*/*',
        'Cache-Control': 'no-cache',
        Pragma: 'no-cache',
      },
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = await res.text();
        return JSON.parse(text);
      })
      .then((json) => {
        if (cancelled) return;
        if (!isLikelyLottie(json)) throw new Error('Invalid Lottie JSON');
        setState({ data: json, loading: false, failed: false });
      })
      .catch(() => {
        if (cancelled) return;
        setState({ data: null, loading: false, failed: true });
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [enabled, uri]);

  return state;
}
