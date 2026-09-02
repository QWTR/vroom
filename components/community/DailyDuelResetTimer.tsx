import React from 'react';

import { AppText as Text } from '../ui/AppText';
import { useTheme } from '../../contexts/ThemeContext';
import { formatDuelTimer } from './dailyDuelTypes';
import { useSharedNow } from '../../hooks/useSharedNow';

interface Props {
  endsAt: string;
}

/** Odliczanie w izolowanym komponencie — nie przeładowuje reszty ekranu co sekundę. */
export function DailyDuelResetTimer({ endsAt }: Props) {
  const { theme } = useTheme();
  const nowMs = useSharedNow();

  const timer = formatDuelTimer(new Date(endsAt).getTime() - nowMs);

  return (
    <Text style={{
      fontFamily: 'Manrope_600SemiBold',
      color: theme.textDim,
      fontSize: 12,
      letterSpacing: 1,
      marginTop: 3,
    }} numberOfLines={1}>
      Reset za {timer}
    </Text>
  );
}
