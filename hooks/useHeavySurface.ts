import { useEffect } from 'react';
import { registerHeavySurface } from '../lib/performance/telemetry';

export function useHeavySurface(id: string, active = true): void {
  useEffect(() => {
    if (!active) return undefined;
    return registerHeavySurface(id);
  }, [active, id]);
}
