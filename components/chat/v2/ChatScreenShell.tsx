import React, { useEffect, useRef, type ReactNode } from 'react';
import { Animated, View, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '../../../contexts/ThemeContext';
import { ChatKeyboardLayout } from '../../layout/ChatKeyboardLayout';
import { StaticHudGrid } from '../../motion/vroomHudPrimitives';

type Props = {
  header?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  keyboardVerticalOffset?: number;
  animateMount?: boolean;
};

export function ChatScreenShell({
  header,
  children,
  footer,
  keyboardVerticalOffset = 0,
  animateMount = true,
}: Props) {
  const { theme, isDark } = useTheme();
  const gridOpacity = useRef(new Animated.Value(animateMount ? 0 : 1)).current;
  const scanY = useRef(new Animated.Value(-60)).current;

  useEffect(() => {
    if (!animateMount) return;
    Animated.parallel([
      Animated.timing(gridOpacity, { toValue: 1, duration: 400, useNativeDriver: true }),
      Animated.timing(scanY, { toValue: 120, duration: 600, useNativeDriver: true }),
    ]).start();
  }, [animateMount, gridOpacity, scanY]);

  return (
    <View style={[styles.root, { backgroundColor: theme.bg }]}>
      <LinearGradient
        colors={isDark ? ['#0a0a0a', '#120808', '#0a0a0a'] : [theme.bg, theme.bgAlt, theme.bg]}
        style={StyleSheet.absoluteFill}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
      />
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: gridOpacity }]} pointerEvents="none">
        <StaticHudGrid isDark={isDark} />
        <Animated.View
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: 0,
            height: 48,
            opacity: 0.35,
            transform: [{ translateY: scanY }],
          }}
        >
          <LinearGradient
            colors={['transparent', 'rgba(227,56,53,0.12)', 'transparent']}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>
      </Animated.View>

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
});
