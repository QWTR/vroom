import React, { useCallback, useRef } from 'react';
import { StatusBar, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTheme } from '../../contexts/ThemeContext';
import { CommunityScreenHeader } from '../../components/community';
import { SystemNewsPanel } from '../../components/modals/SystemNewsPanel';

export default function CommunityNewsScreen() {
  const router = useRouter();
  const { theme, isDark } = useTheme();
  const newsBackRef = useRef<(() => boolean) | null>(null);

  const handleBack = useCallback(() => {
    if (newsBackRef.current?.()) return;
    router.back();
  }, [router]);
  const registerNewsBack = useCallback((handler: (() => boolean) | null) => {
    newsBackRef.current = handler;
  }, []);

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor="transparent" translucent />
      <CommunityScreenHeader title="NEWSY" onBack={handleBack} />
      <SystemNewsPanel
        active
        onRegisterBack={registerNewsBack}
      />
    </View>
  );
}
