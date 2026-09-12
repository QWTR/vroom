import React from 'react';
import { Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { type ToastConfig, type ToastConfigParams } from 'react-native-toast-message';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText } from './AppText';

const variants = {
  success: { icon: 'check-circle-outline', light: '#17804f', dark: '#66d6a0' },
  info: { icon: 'info-outline', light: '#2469ca', dark: '#80b5ff' },
  error: { icon: 'error-outline', light: '#cf3439', dark: '#ff8589' },
} as const;

type VroomToastProps = ToastConfigParams<unknown> & {
  isDark: boolean;
  variant: keyof typeof variants;
};

function VroomToast({ isDark, variant, text1, text2, hide, onPress }: VroomToastProps) {
  const { height, width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const palette = variants[variant];
  const accent = isDark ? palette.dark : palette.light;
  const background = isDark ? '#1c1c20' : '#ffffff';

  return (
    <View
      testID={`vroom-toast-${variant}`}
      style={[
        styles.card,
        {
          width: Math.min(width - insets.left - insets.right - 24, 520),
          backgroundColor: background,
          borderColor: isDark ? '#36363c' : '#e7e7ec',
        },
      ]}
    >
      <View style={[styles.accent, { backgroundColor: accent }]} />
      <View style={styles.row}>
        <View style={[styles.icon, { backgroundColor: `${accent}18` }]}>
          <MaterialIcons name={palette.icon} size={24} color={accent} />
        </View>
        <ScrollView
          key={`${variant}:${text1}:${text2}`}
          style={[styles.scroll, { maxHeight: Math.max(80, (height - insets.top - insets.bottom) * 0.55) }]}
          contentContainerStyle={styles.content}
          nestedScrollEnabled
          showsVerticalScrollIndicator
          indicatorStyle={isDark ? 'white' : 'black'}
        >
          <Pressable onPress={onPress} accessibilityLiveRegion="polite">
            {!!text1 && (
              <AppText contrastBackground={background} style={[styles.title, { color: isDark ? '#fafafa' : '#19191e' }]}>
                {text1}
              </AppText>
            )}
            {!!text2 && (
              <AppText
                contrastBackground={background}
                style={[styles.message, !!text1 && styles.messageSpacing, { color: isDark ? '#c7c7d0' : '#555560' }]}
              >
                {text2}
              </AppText>
            )}
          </Pressable>
        </ScrollView>
        <Pressable
          testID="vroom-toast-close"
          accessibilityRole="button"
          accessibilityLabel="Zamknij powiadomienie"
          onPress={() => hide()}
          style={({ pressed }) => [styles.close, { backgroundColor: pressed ? `${accent}20` : 'transparent' }]}
        >
          <MaterialIcons name="close" size={20} color={isDark ? '#a8a8b3' : '#71717c'} />
        </Pressable>
      </View>
    </View>
  );
}

export function createVroomToastConfig(isDark: boolean): ToastConfig {
  return {
    success: (props) => <VroomToast {...props} isDark={isDark} variant="success" />,
    info: (props) => <VroomToast {...props} isDark={isDark} variant="info" />,
    error: (props) => <VroomToast {...props} isDark={isDark} variant="error" />,
  };
}

const styles = StyleSheet.create({
  card: {
    alignSelf: 'center',
    borderRadius: 20,
    borderWidth: 1,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.16,
    shadowRadius: 20,
    elevation: 8,
  },
  accent: {
    position: 'absolute',
    left: 0,
    top: 22,
    bottom: 22,
    width: 3,
    borderRadius: 3,
  },
  row: { flexDirection: 'row', alignItems: 'flex-start', padding: 12, gap: 10 },
  icon: { width: 40, height: 40, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  scroll: { flexShrink: 1, flexGrow: 1, minWidth: 0 },
  content: { paddingVertical: 7 },
  title: { fontSize: 15, lineHeight: 21, fontWeight: '700' },
  message: { fontSize: 14, lineHeight: 21, fontWeight: '500' },
  messageSpacing: { marginTop: 5 },
  close: { width: 44, height: 44, margin: -2, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
});
