import { useIsFocused } from '@react-navigation/native';
import { usePerformance } from '../contexts/PerformanceContext';

export function usePerformanceMotion(visible = true, covered = false) {
  const focused = useIsFocused();
  const { appActive, profile } = usePerformance();
  const enabled = visible && focused && appActive && !covered && profile !== 'battery';
  return {
    enabled,
    tier: enabled ? (profile === 'smooth' ? 'full' : 'standard') : 'off',
  } as const;
}
