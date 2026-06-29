import { useEffect, useState } from 'react';
import { getCachedRemoteLottieJson, loadRemoteLottieJson } from '../lib/appAnimationPreload';

type RemoteLottieState = {
  data: unknown | null;
  loading: boolean;
  failed: boolean;
};

export function useRemoteLottieJson(uri: string | null | undefined, enabled = true) {
  const [state, setState] = useState<RemoteLottieState>({
    data: getCachedRemoteLottieJson(uri),
    loading: !!enabled && !!uri && !getCachedRemoteLottieJson(uri),
    failed: false,
  });

  useEffect(() => {
    if (!enabled || !uri) {
      setState({ data: null, loading: false, failed: false });
      return undefined;
    }

    let cancelled = false;
    const cached = getCachedRemoteLottieJson(uri);
    if (cached) {
      setState({ data: cached, loading: false, failed: false });
      return undefined;
    }

    setState({ data: null, loading: true, failed: false });

    loadRemoteLottieJson(uri)
      .then((json) => {
        if (cancelled) return;
        setState({ data: json, loading: false, failed: false });
      })
      .catch(() => {
        if (cancelled) return;
        setState({ data: null, loading: false, failed: true });
      });

    return () => {
      cancelled = true;
    };
  }, [enabled, uri]);

  return state;
}
