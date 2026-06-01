import React, { useEffect, useRef } from 'react';
import {
  View, Text, Modal, ActivityIndicator, Image,
} from 'react-native';
import { useTheme } from '../../contexts/ThemeContext';
import { fetchMaintenanceStatus, shouldBlockApp } from '../../lib/maintenance';

const POLL_MS = 20_000;

type Props = {
  visible: boolean;
  message: string;
  onCleared: () => void;
};

export function MaintenanceGate({ visible, message, onCleared }: Props) {
  const { theme, isDark } = useTheme();
  const checkingRef = useRef(false);

  useEffect(() => {
    if (!visible) return;

    const check = async () => {
      if (checkingRef.current) return;
      checkingRef.current = true;
      try {
        const status = await fetchMaintenanceStatus();
        if (!shouldBlockApp(status)) onCleared();
      } catch {
        /* keep gate */
      } finally {
        checkingRef.current = false;
      }
    };

    void check();
    const id = setInterval(() => { void check(); }, POLL_MS);
    return () => clearInterval(id);
  }, [visible, onCleared]);

  if (!visible) return null;

  const displayMessage =
    message?.trim() ||
    'Trwają prace techniczne. Aplikacja będzie wkrótce dostępna — dziękujemy za cierpliwość.';

  return (
    <Modal visible animationType="fade" presentationStyle="fullScreen">
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
          fontFamily: 'OrbitronBold',
          color: theme.text,
          fontSize: 20,
          textAlign: 'center',
          marginBottom: 12,
        }}>
          Przerwa techniczna
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
    </Modal>
  );
}
