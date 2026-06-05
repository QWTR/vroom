import { useCallback, useEffect, useState } from 'react';
import { fetchMaintenanceStatus, shouldBlockMap } from '../lib/maintenance';

const POLL_MS = 20_000;

export function useMapMaintenanceGate(isAdmin: boolean) {
  const [blocked, setBlocked] = useState(false);
  const [message, setMessage] = useState('');
  const [checking, setChecking] = useState(!isAdmin);

  const refresh = useCallback(async () => {
    if (isAdmin) {
      setBlocked(false);
      setMessage('');
      setChecking(false);
      return;
    }

    setChecking(true);
    try {
      const status = await fetchMaintenanceStatus();
      const shouldBlock = shouldBlockMap(status);
      setBlocked(shouldBlock);
      setMessage(status.mapMessage);
    } catch {
      setBlocked(false);
    } finally {
      setChecking(false);
    }
  }, [isAdmin]);

  useEffect(() => {
    void refresh();
    if (isAdmin) return undefined;

    const id = setInterval(() => { void refresh(); }, POLL_MS);
    return () => clearInterval(id);
  }, [isAdmin, refresh]);

  return { blocked, message, checking, refresh };
}
