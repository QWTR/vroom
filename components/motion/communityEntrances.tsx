import React from 'react';
import { EntranceFxOverlay } from './EntranceFxOverlay';

type Props = { onDone: () => void };

export function DailyDuelEntranceFx({ onDone }: Props) {
  return <EntranceFxOverlay presetId="arena-duel" onDone={onDone} />;
}

export function GridEntranceFx({ onDone }: Props) {
  return <EntranceFxOverlay presetId="arena-grid" onDone={onDone} />;
}

export function LiveChatEntranceFx({ onDone }: Props) {
  return <EntranceFxOverlay presetId="live-chat" onDone={onDone} tier="lite" />;
}

export function ClubEntranceFx({ onDone, clubName }: Props & { clubName?: string }) {
  return (
    <EntranceFxOverlay
      presetId="club"
      onDone={onDone}
      tier="lite"
      titleOverride={clubName?.toUpperCase() ?? undefined}
    />
  );
}

export function MarketEntranceFx({ onDone }: Props) {
  return <EntranceFxOverlay presetId="market" onDone={onDone} tier="lite" />;
}

export function SupportEntranceFx({ onDone, reportId }: Props & { reportId?: string }) {
  return (
    <EntranceFxOverlay
      presetId="support-calm"
      onDone={onDone}
      tier="lite"
      subtitleOverride={reportId ? `ZGŁOSZENIE #${reportId}` : undefined}
      hapticsOnClash={false}
    />
  );
}

export function GarageEntranceFx({ onDone }: Props) {
  return <EntranceFxOverlay presetId="garage" onDone={onDone} tier="lite" />;
}
