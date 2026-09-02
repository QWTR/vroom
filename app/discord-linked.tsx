import React, { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { AppText as Text } from '../components/ui/AppText';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTheme } from '../contexts/ThemeContext';

export default function DiscordLinkedScreen() {
  const router = useRouter();
  const { theme } = useTheme();
  const { status, reason } = useLocalSearchParams<{ status?: string; reason?: string }>();

  useEffect(() => {
    const timer = setTimeout(() => {
      router.replace({
        pathname: '/profile/settings',
        params: {
          discordStatus: status ?? 'error',
          ...(reason ? { discordReason: reason } : {}),
        },
      });
    }, 250);
    return () => clearTimeout(timer);
  }, [reason, router, status]);

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg, alignItems: 'center', justifyContent: 'center', gap: 14 }}>
      <MaterialIcons name="discord" size={42} color="#5865F2" />
      <ActivityIndicator color="#5865F2" />
      <Text style={{ fontFamily: 'Manrope_600SemiBold', fontSize: 12, color: theme.textDim }}>
        WRACAMY DO VROOM…
      </Text>
    </View>
  );
}
