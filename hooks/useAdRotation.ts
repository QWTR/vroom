import { useState, useEffect, useCallback, useMemo } from 'react';

export const AD_ROTATION_MS = 60_000;

export type AdDisplaySource = 'partner' | 'admob' | 'placeholder';

export function useAdRotation(hasPartner: boolean, enabled: boolean) {
  const [slot, setSlot] = useState<'partner' | 'admob'>('partner');
  const [admobFailed, setAdmobFailed] = useState(false);
  const [partnerFailed, setPartnerFailed] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    if (!hasPartner) {
      setSlot('admob');
      return;
    }

    const id = setInterval(() => {
      setAdmobFailed(false);
      setPartnerFailed(false);
      setSlot((prev) => (prev === 'partner' ? 'admob' : 'partner'));
    }, AD_ROTATION_MS);

    return () => clearInterval(id);
  }, [enabled, hasPartner]);

  useEffect(() => {
    if (!hasPartner) setSlot('admob');
  }, [hasPartner]);

  const markAdmobFailed = useCallback(() => setAdmobFailed(true), []);
  const markPartnerFailed = useCallback(() => setPartnerFailed(true), []);

  const displaySource = useMemo((): AdDisplaySource => {
    if (!enabled) return 'placeholder';

    const canPartner = hasPartner && !partnerFailed;
    const canAdmob = !admobFailed;

    if (slot === 'partner') {
      if (canPartner) return 'partner';
      if (canAdmob) return 'admob';
      return 'placeholder';
    }

    if (canAdmob) return 'admob';
    if (canPartner) return 'partner';
    return 'placeholder';
  }, [slot, hasPartner, admobFailed, partnerFailed, enabled]);

  return {
    displaySource,
    slot,
    markAdmobFailed,
    markPartnerFailed,
  };
}
