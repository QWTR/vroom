import React from 'react';
import { Text, TextStyle, StyleProp } from 'react-native';
import { formatCountdown } from './formatCountdown';
import { useSharedNow } from '../../hooks/useSharedNow';

interface Props {
  targetIso: string | null;
  style?: StyleProp<TextStyle>;
  fallback?: string;
  prefix?: string;
  formatLabel?: (countdown: string | null) => string;
  numberOfLines?: number;
}

/** Odliczanie w izolowanym komponencie — nie przeładowuje rodzica co sekundę. */
export function LiveCountdownText({
  targetIso,
  style,
  fallback = 'Brak danych',
  prefix = '',
  formatLabel,
  numberOfLines = 1,
}: Props) {
  const nowMs = useSharedNow(Boolean(targetIso));

  const countdown = formatCountdown(targetIso, nowMs);
  const label = formatLabel
    ? formatLabel(countdown)
    : countdown
      ? `${prefix}${countdown}`
      : fallback;

  return (
    <Text style={style} numberOfLines={numberOfLines}>
      {label}
    </Text>
  );
}
