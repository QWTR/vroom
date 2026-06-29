import React, { useEffect, useState, type ReactNode } from 'react';
import type { EntranceFxPresetId } from './entranceFxTypes';
import { getEntrancePreset } from './entranceFxRegistry';
import { EntranceFxOverlay } from './EntranceFxOverlay';
import { useEntranceIntroPolicy } from '../../hooks/useEntranceIntroPolicy';
import { useEntranceFxTier } from '../../hooks/useEntranceFxTier';

type Props = {
  presetId: EntranceFxPresetId;
  onIntroDone: () => void;
  screenKey?: string;
  skipFromNotification?: boolean;
  titleOverride?: string;
  subtitleOverride?: string;
  eyebrowOverride?: string;
  centerContent?: ReactNode;
  hapticsOnClash?: boolean;
};

export function EntranceIntroGate({
  presetId,
  onIntroDone,
  screenKey,
  skipFromNotification,
  hapticsOnClash,
  ...overlayProps
}: Props) {
  const preset = getEntrancePreset(presetId);
  const tier = useEntranceFxTier();
  const key = screenKey ?? `screen_${presetId}`;
  const { shouldShow, ready, markSeen } = useEntranceIntroPolicy(
    key,
    preset.showOncePolicy,
    { skipFromNotification },
  );
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!ready) return;
    if (shouldShow) setVisible(true);
    else onIntroDone();
  }, [ready, shouldShow, onIntroDone]);

  if (!visible) return null;

  return (
    <EntranceFxOverlay
      presetId={presetId}
      tier={tier}
      onDone={() => {
        setVisible(false);
        void markSeen();
        onIntroDone();
      }}
      hapticsOnClash={hapticsOnClash}
      {...overlayProps}
    />
  );
}
