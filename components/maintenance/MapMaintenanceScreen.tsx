import React, { useEffect, useRef } from 'react';
import { View, ActivityIndicator, Image } from 'react-native';
import { AppText as Text } from '../ui/AppText';
import { useTheme } from '../../contexts/ThemeContext';
import { fetchMaintenanceStatus, shouldBlockMap } from '../../lib/maintenance';

const POLL_MS = 20_000;

type Props = {
  message: string;
  onCleared: () => void;
};

export function MapMaintenanceScreen({ message, onCleared }: Props) {
  const { theme, isDark } = useTheme();
  const checkingRef = useRef(false);

  useEffect(() => {
    const check = async () => {
      if (checkingRef.current) return;
      checkingRef.current = true;
      try {
        const status = await fetchMaintenanceStatus();
        if (!shouldBlockMap(status)) onCleared();
      } catch {
        /* keep screen */
      } finally {
        checkingRef.current = false;
      }
    };

    void check();
    const id = setInterval(() => { void check(); }, POLL_MS);
    return () => clearInterval(id);
  }, [onCleared]);

  const displayMessage =
    message?.trim() ||
    'Mapa jest w trakcie prac i wkrótce wróci. Dziękujemy za cierpliwość.';

  return (
    <View style={{
      flex: 1,
      backgroundColor: theme.bg,
      alignItems: 'center',
      justifyContent: 'center',
      padding: 32,
    }}>
      <Image
        source={require('../../assets/images/logotypRed.png')}
        style={{ width: 88, height: 88, marginBottom: 28, opacity: 0.95 }}
        resizeMode="contain"
      />
      <Text style={{
        fontFamily: 'Manrope_700Bold',
        color: theme.text,
        fontSize: 20,
        textAlign: 'center',
        marginBottom: 12,
      }}>
        Mapa w trakcie prac
      </Text>
      <Text style={{
        color: theme.textMuted,
        fontSize: 15,
        lineHeight: 24,
        textAlign: 'center',
        marginBottom: 32,
      }}>
        {displayMessage}
      </Text>
      <ActivityIndicator size="large" color={isDark ? '#e33835' : '#c42f2c'} />
      <Text style={{
        color: theme.textDim,
        fontSize: 12,
        marginTop: 20,
        textAlign: 'center',
      }}>
        Sprawdzamy status co chwilę…
      </Text>
    </View>
  );
}
