import React from 'react';
import { Text } from 'react-native';
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
      fontFamily: 'Orbitron',
      color: theme.textDim,
      fontSize: 8,
      letterSpacing: 1,
      marginTop: 3,
    }} numberOfLines={1}>
      Reset za {timer}
    </Text>
  );
}
