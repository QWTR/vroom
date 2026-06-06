import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchMaintenanceStatus, shouldBlockMap } from '../lib/maintenance';

const POLL_MS = 20_000;

export function useMapMaintenanceGate(isAdmin: boolean) {
  const [blocked, setBlocked] = useState(false);
  const [message, setMessage] = useState('');
  const [checking, setChecking] = useState(!isAdmin);
  const initialCheckDoneRef = useRef(false);

  const refresh = useCallback(async (opts?: { background?: boolean }) => {
    if (isAdmin) {
      setBlocked(false);
      setMessage('');
      setChecking(false);
      initialCheckDoneRef.current = true;
      return;
    }

    const silent = opts?.background === true && initialCheckDoneRef.current;
    if (!silent) {
      setChecking(true);
    }

    try {
      const status = await fetchMaintenanceStatus();
      const shouldBlock = shouldBlockMap(status);
      setBlocked(shouldBlock);
      setMessage(status.mapMessage);
    } catch {
      setBlocked(false);
    } finally {
      initialCheckDoneRef.current = true;
      setChecking(false);
    }
  }, [isAdmin]);

  useEffect(() => {
    void refresh();
    if (isAdmin) return undefined;

    const id = setInterval(() => { void refresh({ background: true }); }, POLL_MS);
    return () => clearInterval(id);
  }, [isAdmin, refresh]);

  return { blocked, message, checking, refresh };
}
