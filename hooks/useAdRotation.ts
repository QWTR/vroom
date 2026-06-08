import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { sponsoredAdStore } from './sponsoredAdStore';

export const AD_ROTATION_MS = 60_000;

export type AdDisplaySource = 'partner' | 'admob' | 'placeholder';

type RotationSnapshot = {
  slot: 'partner' | 'admob';
  admobFailed: boolean;
  partnerFailed: boolean;
};

class AdRotationStore {
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
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private subscriberCount = 0;

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

  private stopInterval() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  private startInterval() {
    this.stopInterval();
    if (!this.enabled || !this.hasPartner) return;

    this.intervalId = setInterval(() => {
      this.admobFailed = false;
      this.partnerFailed = false;
      const nextSlot = this.slot === 'partner' ? 'admob' : 'partner';
      this.slot = nextSlot;
      if (nextSlot === 'partner') {
        sponsoredAdStore.refreshActivePlacements();
      }
      this.notify();
    }, AD_ROTATION_MS);
  }

  setContext(hasPartner: boolean, enabled: boolean) {
    const changed = this.hasPartner !== hasPartner || this.enabled !== enabled;
    this.hasPartner = hasPartner;
    this.enabled = enabled;

    if (!enabled || !hasPartner) {
      this.slot = 'admob';
      this.stopInterval();
      if (changed) this.notify();
      return;
    }

    if (!this.intervalId) {
      this.slot = 'partner';
    }
    this.startInterval();
    if (changed) this.notify();
  }

  acquire() {
    this.subscriberCount += 1;
    return () => {
      this.subscriberCount = Math.max(0, this.subscriberCount - 1);
      if (this.subscriberCount === 0) {
        this.stopInterval();
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

const adRotationStore = new AdRotationStore();

export function useAdRotation(hasPartner: boolean, enabled: boolean) {
  const snapshot = useSyncExternalStore(
    adRotationStore.subscribe,
    adRotationStore.getSnapshot,
    adRotationStore.getSnapshot,
  );

  useEffect(() => {
    const release = adRotationStore.acquire();
    return release;
  }, []);

  useEffect(() => {
    adRotationStore.setContext(hasPartner, enabled);
  }, [hasPartner, enabled]);

  const displaySource = useMemo((): AdDisplaySource => {
    if (!enabled) return 'placeholder';

    const canPartner = hasPartner && !snapshot.partnerFailed;
    const canAdmob = !snapshot.admobFailed;

    if (snapshot.slot === 'partner') {
      if (canPartner) return 'partner';
      if (canAdmob) return 'admob';
      return 'placeholder';
    }

    if (canAdmob) return 'admob';
    if (canPartner) return 'partner';
    return 'placeholder';
  }, [snapshot, hasPartner, enabled]);

  return {
    displaySource,
    slot: snapshot.slot,
    markAdmobFailed: adRotationStore.markAdmobFailed,
    markPartnerFailed: adRotationStore.markPartnerFailed,
  };
}
