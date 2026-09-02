import React, { useEffect, useRef } from 'react';
import { View, Animated, Easing } from 'react-native';
import { AppText as Text } from './ui/AppText';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useTheme } from '../contexts/ThemeContext';

export default function CustomLoading() {
  const { theme } = useTheme();
  const rotateAnim = useRef(new Animated.Value(0)).current;
  const fadeAnim   = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    Animated.loop(
      Animated.timing(rotateAnim, {
        toValue: 1, duration: 1500,
        easing: Easing.bezier(0.4, 0, 0.2, 1),
        useNativeDriver: true,
      })
    ).start();

    Animated.loop(
      Animated.sequence([
        Animated.timing(fadeAnim, { toValue: 1,   duration: 800, useNativeDriver: true }),
        Animated.timing(fadeAnim, { toValue: 0.4, duration: 800, useNativeDriver: true }),
      ])
    ).start();
  }, []);

  const spin = rotateAnim.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg, justifyContent: 'center', alignItems: 'center' }}>
      <Animated.View style={{ transform: [{ rotate: spin }] }}>
        <MaterialIcons name="speed" size={80} color={theme.primary} />
      </Animated.View>

      <Animated.Text style={{ fontFamily: 'Manrope_600SemiBold', color: theme.text, marginTop: 30, fontSize: 12, letterSpacing: 1, opacity: fadeAnim }}>
        INICJACJA SYSTEMÓW...
      </Animated.Text>

      <View style={{ width: 200, height: 2, backgroundColor: theme.surface3, marginTop: 20, overflow: 'hidden' }}>
        <View style={{ width: '40%', height: '100%', backgroundColor: theme.primary }} />
      </View>
    </View>
  );
}