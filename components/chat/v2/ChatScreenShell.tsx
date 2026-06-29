import React, { type ReactNode } from 'react';
import { View, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '../../../contexts/ThemeContext';
import { ChatKeyboardLayout } from '../../layout/ChatKeyboardLayout';

type Props = {
  header?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  keyboardVerticalOffset?: number;
};

export function ChatScreenShell({ header, children, footer, keyboardVerticalOffset = 0 }: Props) {
  const { theme, isDark } = useTheme();

  return (
    <View style={[styles.root, { backgroundColor: theme.bg }]}>
      <LinearGradient
        colors={isDark ? ['#0a0a0a', '#120808', '#0a0a0a'] : [theme.bg, theme.bgAlt, theme.bg]}
        style={StyleSheet.absoluteFill}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
      />
      {/* HUD grid lines */}
      <View style={styles.gridOverlay} pointerEvents="none">
        {[...Array(6)].map((_, i) => (
          <View
            key={`h-${i}`}
            style={[styles.gridLineH, { top: `${(i + 1) * 16}%`, backgroundColor: isDark ? '#e3383508' : '#e3383510' }]}
          />
        ))}
        {[...Array(4)].map((_, i) => (
          <View
            key={`v-${i}`}
            style={[styles.gridLineV, { left: `${(i + 1) * 20}%`, backgroundColor: isDark ? '#e3383506' : '#e3383508' }]}
          />
        ))}
      </View>

      <ChatKeyboardLayout header={header} keyboardVerticalOffset={keyboardVerticalOffset}>
        <View style={styles.body}>{children}</View>
        {footer}
      </ChatKeyboardLayout>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  body: { flex: 1 },
  gridOverlay: { ...StyleSheet.absoluteFillObject, overflow: 'hidden' },
  gridLineH: { position: 'absolute', left: 0, right: 0, height: 1 },
  gridLineV: { position: 'absolute', top: 0, bottom: 0, width: 1 },
});
