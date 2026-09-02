import { Tabs } from 'expo-router';
import React, { useEffect, useRef } from 'react';
import { Platform, View, StyleSheet, Animated, useWindowDimensions } from 'react-native';
import { AppText as Text } from '../../components/ui/AppText';
import { Feather } from '@expo/vector-icons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { BlurView } from 'expo-blur';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../contexts/ThemeContext';
import { useAppPresence } from '../../hooks/useAppPresence';
import { usePushNotifications } from '../../hooks/usePushNotifications';
import { useAppAnimations } from '../../hooks/useAppAnimations';
import { pickAppAnimationForValue } from '../../constants/appAnimations';
import AppAnimationLayer from '../../components/animations/AppAnimationLayer';
import { useReadability } from '../../contexts/ReadabilityContext';

const TAB_BAR_HEIGHT = 82;

const TabIcon = ({
  focused, icon, iconLib = 'feather',
}: {
  focused: boolean; icon: any; iconLib?: 'feather' | 'material';
}) => {
  const { theme } = useTheme();
  const { animations } = useAppAnimations(['tab_active_icon']);
  const activeIconAnimation = focused ? pickAppAnimationForValue(animations, 'tab_active_icon') : null;
  const scaleAnim = useRef(new Animated.Value(focused ? 1.1 : 1)).current;

  useEffect(() => {
    Animated.spring(scaleAnim, { toValue: focused ? 1.1 : 1, friction: 6, tension: 120, useNativeDriver: true }).start();
  }, [focused]);

  const color = focused ? theme.primaryText : theme.textMuted;

  const Icon = iconLib === 'material'
    ? <MaterialCommunityIcons name={icon} size={27} color={color} />
    : <Feather name={icon} size={25} color={color} />;

  return (
    <View style={styles.wrapper}>
      <Animated.View style={[
        styles.iconBg,
        { transform: [{ scale: scaleAnim }] },
        focused && { backgroundColor: theme.primaryBg, borderColor: theme.primaryBorder },
        ]}>
         {activeIconAnimation ? (
          <AppAnimationLayer animation={activeIconAnimation} style={{ width: 26, height: 26 }} fallbackIcon={Icon} />
        ) : Icon}
      </Animated.View>
    </View>
  );
};

function TabLabel({ focused, label, compactLabel }: { focused: boolean; label: string; compactLabel?: string }) {
  const { theme } = useTheme();
  const { textScale } = useReadability();
  const { fontScale } = useWindowDimensions();
  const effectiveScale = Math.min(2, textScale * fontScale);
  return (
    <Text
      variant="micro"
      numberOfLines={1}
      style={[styles.label, { color: focused ? theme.primaryText : theme.textMuted }]}
    >
      {effectiveScale >= 1.35 ? compactLabel ?? label : label}
    </Text>
  );
}

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
      <Text variant="micro" style={[onlineStyles.lbl, { color: theme.textMuted }]}>ONLINE</Text>
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
    fontFamily: 'Manrope_600SemiBold',
    fontSize:   13,
    fontWeight: '800',
    minWidth:   18,
  },
  lbl: {
    fontFamily: 'Manrope_600SemiBold',
    fontSize:   12,
    letterSpacing: 1,
  },
});

export default function TabLayout() {
  const insets        = useSafeAreaInsets();
  const { theme, isDark } = useTheme();
  const { textScale } = useReadability();
  const { fontScale } = useWindowDimensions();
  usePushNotifications();

  // edgeToEdge=false → insets.bottom zazwyczaj = 0 na Androidzie
  // ale zostawiamy dla iOS i ewentualnej przyszłej zmiany
  const effectiveScale = Math.min(2, textScale * fontScale);
  const safeBottom = Math.max(insets.bottom, Platform.OS === 'android' ? 12 : 0);
  const tabBarHeight = TAB_BAR_HEIGHT + Math.round(Math.max(0, effectiveScale - 1) * 30) + safeBottom;

  return (
    <View style={{ flex: 1 }}>
    <Tabs
      screenOptions={{
        headerShown:      false,
        tabBarShowLabel:  true,
        tabBarLabelPosition: 'below-icon',
        tabBarStyle: {
          position:         'absolute',
          backgroundColor:  Platform.OS === 'android' ? theme.tabBg : 'transparent',
          borderTopWidth:   1,
          borderTopColor:   theme.tabBorder,
          height:           tabBarHeight,
          paddingBottom:    safeBottom + 5,
          paddingTop:       7,
          paddingHorizontal: 0,
          elevation:        0,
          overflow:         'visible',
        },
        tabBarItemStyle: { minHeight: tabBarHeight - safeBottom, paddingVertical: 0 },
        tabBarIconStyle: { flex: 1, width: '100%', minHeight: 46 },
        tabBarBackground: () =>
          Platform.OS === 'ios' ? (
            <View style={StyleSheet.absoluteFill}>
              <View style={[StyleSheet.absoluteFill, { backgroundColor: theme.tabBg, opacity: 0.92 }]} />
              <BlurView tint={isDark ? 'dark' : 'light'} intensity={90} style={StyleSheet.absoluteFill} />
            </View>
          ) : (
            <View style={[StyleSheet.absoluteFill, { backgroundColor: theme.tabBg }]} />
          ),
        animation:           Platform.OS === 'ios' ? 'fade' : 'shift',
        lazy:                  true,
        freezeOnBlur:          true,
        tabBarHideOnKeyboard: true,
        sceneStyle:          { paddingBottom: tabBarHeight, backgroundColor: theme.bg },
      }}
    >
      <Tabs.Screen name="index" options={{ tabBarAccessibilityLabel: 'Strona główna', tabBarLabel: (p) => <TabLabel {...p} label="Główna" compactLabel="Start" />, tabBarIcon: (p) => <TabIcon {...p} icon="home" /> }} />
      <Tabs.Screen
        name="map"
        options={{
          freezeOnBlur: false,
          tabBarAccessibilityLabel: 'Mapa',
          tabBarLabel: (p) => <TabLabel {...p} label="Mapa" />,
          tabBarIcon: (p) => <TabIcon {...p} icon="navigation" />,
        }}
      />
      <Tabs.Screen name="community" options={{ tabBarAccessibilityLabel: 'Społeczność', tabBarLabel: (p) => <TabLabel {...p} label="Społeczność" compactLabel="Społ." />, tabBarIcon: (p) => <TabIcon {...p} icon="account-group-outline" iconLib="material" /> }} />
      <Tabs.Screen name="spotmap" options={{ tabBarAccessibilityLabel: 'Spoty', tabBarLabel: (p) => <TabLabel {...p} label="Spoty" />, tabBarIcon: (p) => <TabIcon {...p} icon="map-marker-radius-outline" iconLib="material" /> }} />
      <Tabs.Screen
        name="account"
        options={{
          lazy: false,
          tabBarAccessibilityLabel: 'Profil',
          tabBarLabel: (p) => <TabLabel {...p} label="Profil" />,
          animation: Platform.OS === 'ios' ? 'shift' : undefined,
          tabBarIcon: (p) => <TabIcon {...p} icon="user" />,
        }}
      />
    </Tabs>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper:  { minHeight: 46, width: '100%', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 2 },
  iconBg:   { width: 46, height: 42, borderRadius: 13, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: 'transparent', backgroundColor: 'transparent' },
  label:    { fontSize: 12, lineHeight: 16, letterSpacing: 0, textAlign: 'center', width: '100%', paddingHorizontal: 2, flexShrink: 1 },
});
