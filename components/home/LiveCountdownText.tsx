import React from 'react';
import { TextStyle, StyleProp } from 'react-native';
import { AppText as Text } from '../ui/AppText';
import { formatCountdown } from './formatCountdown';
import { useSharedNow } from '../../hooks/useSharedNow';

interface Props {
  targetIso: string | null;
  style?: StyleProp<TextStyle>;
  fallback?: string;
  prefix?: string;
  formatLabel?: (countdown: string | null) => string;
  numberOfLines?: number;
  allowWrapping?: boolean;
}

/** Odliczanie w izolowanym komponencie — nie przeładowuje rodzica co sekundę. */
export function LiveCountdownText({
  targetIso,
  style,
  fallback = 'Brak danych',
  prefix = '',
  formatLabel,
  numberOfLines = 1,
  allowWrapping = false,
}: Props) {
  const nowMs = useSharedNow(Boolean(targetIso));

  const countdown = formatCountdown(targetIso, nowMs);
  const label = formatLabel
    ? formatLabel(countdown)
    : countdown
      ? `${prefix}${countdown}`
      : fallback;

  return (
    <Text style={style} numberOfLines={allowWrapping ? undefined : numberOfLines}>
      {label}
    </Text>
  );
}
