import { Tabs } from 'expo-router';
import React, { useEffect, useRef } from 'react';
import { Platform, View, StyleSheet, Dimensions, Animated } from 'react-native';
import { Feather } from '@expo/vector-icons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { BlurView } from 'expo-blur';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const { width } = Dimensions.get('window');
const TAB_WIDTH = width / 5;
const TAB_BAR_HEIGHT = 65;

const TabIcon = ({
  focused,
  icon,
  iconLib = 'feather',
  label,
}: {
  focused: boolean;
  icon: any;
  iconLib?: 'feather' | 'material';
  label: string;
}) => {
  const scaleAnim = useRef(new Animated.Value(focused ? 1.1 : 1)).current;
  const glowAnim  = useRef(new Animated.Value(focused ? 1 : 0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.spring(scaleAnim, {
        toValue: focused ? 1.1 : 1,
        friction: 6,
        tension: 120,
        useNativeDriver: true,
      }),
      Animated.timing(glowAnim, {
        toValue: focused ? 1 : 0,
        duration: 180,
        useNativeDriver: true,
      }),
    ]).start();
  }, [focused]);

  const color = focused ? '#e33835' : '#555';

  const Icon = iconLib === 'material'
    ? <MaterialCommunityIcons name={icon} size={24} color={color} />
    : <Feather name={icon} size={22} color={color} />;

  return (
    <View style={styles.wrapper}>

      {/* ── TOP INDICATOR ── */}
      <Animated.View style={[styles.topBar, {
        opacity: glowAnim,
        backgroundColor: '#e3383500',
        shadowColor: '#e3383500',
      }]} />

      {/* ── ICON ── */}
      <Animated.View style={[
        styles.iconBg,
        { transform: [{ scale: scaleAnim }] },
        focused && styles.iconBgActive,
      ]}>
        {Icon}
      </Animated.View>

      {/* ── LABEL ── */}
      <Animated.Text
        numberOfLines={1}
        adjustsFontSizeToFit
        style={[
          styles.label,
          {
            color,
            opacity: glowAnim.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1] }),
          },
        ]}
      >
        {label}
      </Animated.Text>

    </View>
  );
};

export default function TabLayout() {
  const insets = useSafeAreaInsets();
  const tabBarHeight = TAB_BAR_HEIGHT + insets.bottom;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarShowLabel: false,
        tabBarStyle: {
          position: 'absolute',
          backgroundColor: Platform.OS === 'android' ? '#0a0a0af5' : 'transparent',
          borderTopWidth: 1,
          borderTopColor: '#ffffff10',
          height: tabBarHeight,
          paddingBottom: insets.bottom,
          paddingTop: 10,
          paddingHorizontal: 0,
          elevation: 0,
        },
        tabBarBackground: () =>
          Platform.OS === 'ios' ? (
            <BlurView tint="dark" intensity={70} style={StyleSheet.absoluteFill} />
          ) : (
            <View style={[StyleSheet.absoluteFill, { backgroundColor: '#0a0a0af5' }]} />
          ),
        animation: 'shift',

        // ✅ TO JEST KLUCZOWE — content nie wchodzi pod tab bar
        tabBarHideOnKeyboard: true,
        sceneStyle: {
          paddingBottom: tabBarHeight,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          tabBarIcon: (props) => <TabIcon {...props} icon="home" label="HOME" />,
        }}
      />
      <Tabs.Screen
        name="map"
        options={{
          tabBarIcon: (props) => <TabIcon {...props} icon="navigation" label="MAPA" />,
        }}
      />
      <Tabs.Screen
        name="community"
        options={{
          tabBarIcon: (props) => (
            <TabIcon {...props} icon="account-group-outline" iconLib="material" label="SPOŁECZ." />
          ),
        }}
      />
      <Tabs.Screen
        name="spotmap"
        options={{
          tabBarIcon: (props) => (
            <TabIcon {...props} icon="map-marker-radius-outline" iconLib="material" label="SPOTY" />
          ),
        }}
      />
      <Tabs.Screen
        name="account"
        options={{
          tabBarIcon: (props) => <TabIcon {...props} icon="user" label="PROFIL" />,
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    width: TAB_WIDTH,
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    paddingTop: 6,
  },

  topBar: {
    position: 'absolute',
    top: 0,
    width: 28,
    height: 2.5,
    borderBottomLeftRadius: 2,
    borderBottomRightRadius: 2,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 1,
    shadowRadius: 8,
    elevation: 8,
  },

  iconBg: {
    width: 42,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'transparent',
    backgroundColor: 'transparent',
  },

  iconBgActive: {
    backgroundColor: '#e3383515',
    borderColor: '#e3383530',
  },

  label: {
    fontSize: 8.5,
    fontFamily: 'Orbitron',
    letterSpacing: 0.2,
    textAlign: 'center',
    maxWidth: TAB_WIDTH - 8,
  },
});