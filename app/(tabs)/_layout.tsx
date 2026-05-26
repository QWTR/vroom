import { Tabs } from 'expo-router';
import React, { useEffect, useRef } from 'react';
import { Platform, View, StyleSheet, Dimensions, Animated, Text } from 'react-native';
import { Feather } from '@expo/vector-icons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { BlurView } from 'expo-blur';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../contexts/ThemeContext';
import { useAppPresence } from '../../hooks/useAppPresence';
import { usePushNotifications } from '../../hooks/usePushNotifications';

const { width } = Dimensions.get('window');
const TAB_WIDTH      = width / 5;
const TAB_BAR_HEIGHT = 65;

const TabIcon = ({
  focused, icon, iconLib = 'feather', label,
}: {
  focused: boolean; icon: any; iconLib?: 'feather' | 'material'; label: string;
}) => {
  const { theme } = useTheme();
  const scaleAnim = useRef(new Animated.Value(focused ? 1.1 : 1)).current;
  const glowAnim  = useRef(new Animated.Value(focused ? 1 : 0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.spring(scaleAnim, { toValue: focused ? 1.1 : 1, friction: 6, tension: 120, useNativeDriver: true }),
      Animated.timing(glowAnim,  { toValue: focused ? 1 : 0, duration: 180, useNativeDriver: true }),
    ]).start();
  }, [focused]);

  const color = focused ? '#e33835' : theme.textDim;

  const Icon = iconLib === 'material'
    ? <MaterialCommunityIcons name={icon} size={24} color={color} />
    : <Feather name={icon} size={22} color={color} />;

  return (
    <View style={styles.wrapper}>
      <Animated.View style={[styles.topBar, { opacity: glowAnim }]} />
      <Animated.View style={[
        styles.iconBg,
        { transform: [{ scale: scaleAnim }] },
        focused && { backgroundColor: '#e3383515', borderColor: '#e3383530' },
      ]}>
        {Icon}
      </Animated.View>
      <Animated.Text
        numberOfLines={1}
        adjustsFontSizeToFit
        style={[styles.label, {
          color,
          opacity: glowAnim.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1] }),
        }]}
      >
        {label}
      </Animated.Text>
    </View>
  );
};

function AppOnlineBadge() {
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const count = useAppPresence();
  if (count == null) return null;
  return (
    <View
      pointerEvents="none"
      style={[
        onlineStyles.wrap,
        {
          top:               insets.top + 6,
          backgroundColor:   theme.tabBg,
          borderColor:       theme.tabBorder,
        },
      ]}
    >
      <View style={onlineStyles.dot} />
      <Text style={[onlineStyles.num, { color: theme.text }]}>{count}</Text>
      <Text style={[onlineStyles.lbl, { color: theme.textDim }]}>ONLINE</Text>
    </View>
  );
}

const onlineStyles = StyleSheet.create({
  wrap: {
    position:        'absolute',
    right:           10,
    zIndex:          2000,
    flexDirection:   'row',
    alignItems:      'center',
    gap:             5,
    paddingHorizontal: 10,
    paddingVertical:   5,
    borderRadius:      20,
    borderWidth:       1,
  },
  dot: {
    width: 7, height: 7, borderRadius: 4,
    backgroundColor: '#4de926',
  },
  num: {
    fontFamily: 'Orbitron',
    fontSize:   13,
    fontWeight: '800',
    minWidth:   18,
  },
  lbl: {
    fontFamily: 'Orbitron',
    fontSize:   7,
    letterSpacing: 1.2,
  },
});

export default function TabLayout() {
  const insets        = useSafeAreaInsets();
  const { theme, isDark } = useTheme();
  usePushNotifications();

  // edgeToEdge=false → insets.bottom zazwyczaj = 0 na Androidzie
  // ale zostawiamy dla iOS i ewentualnej przyszłej zmiany
  const tabBarHeight  = TAB_BAR_HEIGHT + insets.bottom;

  return (
    <View style={{ flex: 1 }}>
    <Tabs
      screenOptions={{
        headerShown:      false,
        tabBarShowLabel:  false,
        tabBarStyle: {
          position:         'absolute',
          backgroundColor:  Platform.OS === 'android' ? theme.tabBg : 'transparent',
          borderTopWidth:   1,
          borderTopColor:   theme.tabBorder,
          height:           tabBarHeight,
          paddingBottom:    insets.bottom,
          paddingTop:       10,
          paddingHorizontal: 0,
          elevation:        0,
        },
        tabBarBackground: () =>
          Platform.OS === 'ios' ? (
            <BlurView tint={isDark ? 'dark' : 'light'} intensity={70} style={StyleSheet.absoluteFill} />
          ) : (
            <View style={[StyleSheet.absoluteFill, { backgroundColor: theme.tabBg }]} />
          ),
        animation:           Platform.OS === 'ios' ? 'fade' : 'shift',
        lazy:                  true,
        freezeOnBlur:          false,
        tabBarHideOnKeyboard: true,
        sceneStyle:          { paddingBottom: tabBarHeight, backgroundColor: theme.bg },
      }}
    >
      <Tabs.Screen name="index"     options={{ tabBarIcon: (p) => <TabIcon {...p} icon="home"                      label="HOME"     /> }} />
      <Tabs.Screen
        name="map"
        options={{
          lazy: false,
          tabBarIcon: (p) => <TabIcon {...p} icon="navigation" label="MAPA" />,
        }}
      />
      <Tabs.Screen name="community" options={{ tabBarIcon: (p) => <TabIcon {...p} icon="account-group-outline"     label="SPOŁECZ." iconLib="material" /> }} />
      <Tabs.Screen name="spotmap"   options={{ tabBarIcon: (p) => <TabIcon {...p} icon="map-marker-radius-outline" label="SPOTY"    iconLib="material" /> }} />
      <Tabs.Screen
        name="account"
        options={{
          lazy: false,
          animation: Platform.OS === 'ios' ? 'shift' : undefined,
          tabBarIcon: (p) => <TabIcon {...p} icon="user" label="PROFIL" />,
        }}
      />
    </Tabs>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper:  { width: TAB_WIDTH, height: '100%', alignItems: 'center', justifyContent: 'center', gap: 3, paddingTop: 6 },
  topBar:   { position: 'absolute', top: 0, width: 28, height: 2.5, borderBottomLeftRadius: 2, borderBottomRightRadius: 2 },
  iconBg:   { width: 42, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'transparent', backgroundColor: 'transparent' },
  label:    { fontSize: 8.5, fontFamily: 'Orbitron', letterSpacing: 0.2, textAlign: 'center', maxWidth: TAB_WIDTH - 8 },
});