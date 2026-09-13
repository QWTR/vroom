import { useSyncExternalStore } from 'react';
let active = false;
const listeners = new Set<() => void>();
export function setAccountRewardTripActive(value: boolean) {
  if (active === value) return;
  active = value;
  listeners.forEach(listener => listener());
}
export function useAccountRewardTripActive() {
  return useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => active, () => false);
}
