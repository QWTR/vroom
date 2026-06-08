import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { sponsoredAdStore } from './sponsoredAdStore';
import type { AdPlacement } from './sponsoredAdStore';

/** Partner 2 min, AdMob 1 min — na przemian */
export const PARTNER_SLOT_MS = 120_000;
export const ADMOB_SLOT_MS = 60_000;

export type AdDisplaySource = 'partner' | 'admob';

type RotationSnapshot = {
  slot: 'partner' | 'admob';
  admobFailed: boolean;
  partnerFailed: boolean;
};

class PlacementRotationStore {
  private slot: 'partner' | 'admob' = 'partner';
  private admobFailed = false;
  private partnerFailed = false;
  private hasPartner = false;
  private enabled = false;
  private listeners = new Set<() => void>();
  private snapshot: RotationSnapshot = {
    slot: 'partner',
    admobFailed: false,
    partnerFailed: false,
  };
  private timeoutId: ReturnType<typeof setTimeout> | null = null;
  private subscriberCount = 0;
  private activePlacement: AdPlacement | null = null;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): RotationSnapshot => {
    if (
      this.snapshot.slot === this.slot
      && this.snapshot.admobFailed === this.admobFailed
      && this.snapshot.partnerFailed === this.partnerFailed
    ) {
      return this.snapshot;
    }
    this.snapshot = {
      slot: this.slot,
      admobFailed: this.admobFailed,
      partnerFailed: this.partnerFailed,
    };
    return this.snapshot;
  };

  private notify() {
    this.listeners.forEach((listener) => listener());
  }

  private stopTimer() {
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
  }

  private scheduleNext(placement: AdPlacement) {
    this.stopTimer();
    if (!this.enabled || !this.hasPartner) return;

    const duration = this.slot === 'partner' ? PARTNER_SLOT_MS : ADMOB_SLOT_MS;
    this.timeoutId = setTimeout(() => {
      this.admobFailed = false;
      this.partnerFailed = false;
      const nextSlot = this.slot === 'partner' ? 'admob' : 'partner';
      this.slot = nextSlot;
      if (nextSlot === 'partner') {
        sponsoredAdStore.refreshPlacement(placement);
      }
      this.notify();
      this.scheduleNext(placement);
    }, duration);
  }

  private startTimer(placement: AdPlacement) {
    this.activePlacement = placement;
    if (this.timeoutId) return;
    this.slot = 'partner';
    this.scheduleNext(placement);
  }

  setContext(placement: AdPlacement, hasPartner: boolean, enabled: boolean) {
    const changed = this.hasPartner !== hasPartner || this.enabled !== enabled;
    this.hasPartner = hasPartner;
    this.enabled = enabled;

    if (!enabled) {
      this.stopTimer();
      if (changed) this.notify();
      return;
    }

    if (!hasPartner) {
      this.slot = 'admob';
      this.stopTimer();
      if (changed) this.notify();
      return;
    }

    this.startTimer(placement);
    if (changed) this.notify();
  }

  acquire(placement: AdPlacement) {
    this.subscriberCount += 1;
    return () => {
      this.subscriberCount = Math.max(0, this.subscriberCount - 1);
      if (this.subscriberCount === 0) {
        this.stopTimer();
        this.activePlacement = null;
      } else if (this.activePlacement === placement && this.enabled && this.hasPartner) {
        this.startTimer(placement);
      }
    };
  }

  markAdmobFailed = () => {
    if (this.admobFailed) return;
    this.admobFailed = true;
    this.notify();
  };

  markPartnerFailed = () => {
    if (this.partnerFailed) return;
    this.partnerFailed = true;
    this.notify();
  };
}

const rotationStores = new Map<AdPlacement, PlacementRotationStore>();

function getRotationStore(placement: AdPlacement) {
  let store = rotationStores.get(placement);
  if (!store) {
    store = new PlacementRotationStore();
    rotationStores.set(placement, store);
  }
  return store;
}

function resolveDisplaySource(
  snapshot: RotationSnapshot,
  hasPartner: boolean,
  enabled: boolean,
): AdDisplaySource {
  if (!enabled) return 'admob';

  const canPartner = hasPartner && !snapshot.partnerFailed;
  const canAdmob = !snapshot.admobFailed;

  if (snapshot.slot === 'partner') {
    if (canPartner) return 'partner';
    if (canAdmob) return 'admob';
  } else {
    if (canAdmob) return 'admob';
    if (canPartner) return 'partner';
  }

  if (hasPartner) return 'partner';
  return 'admob';
}

export function useAdRotation(placement: AdPlacement, hasPartner: boolean, enabled: boolean) {
  const store = getRotationStore(placement);

  const snapshot = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );

  useEffect(() => {
    const release = store.acquire(placement);
    return release;
  }, [placement, store]);

  useEffect(() => {
    store.setContext(placement, hasPartner, enabled);
  }, [placement, hasPartner, enabled, store]);

  const displaySource = useMemo(
    () => resolveDisplaySource(snapshot, hasPartner, enabled),
    [snapshot, hasPartner, enabled],
  );

  return {
    displaySource,
    slot: snapshot.slot,
    markAdmobFailed: store.markAdmobFailed,
    markPartnerFailed: store.markPartnerFailed,
  };
}
