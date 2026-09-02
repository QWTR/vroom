import React, { useRef } from 'react';
import { View, TouchableOpacity, Animated, Platform, StyleSheet } from 'react-native';
import { AppText as Text } from '../ui/AppText';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useRouter } from 'expo-router';
import { useTheme } from '../../contexts/ThemeContext';
import { withAlpha } from '../../constants/theme';
import {
  pickAppAnimationForModuleKey,
} from '../../constants/appAnimations';
import type { CommunityModuleKey } from '../../constants/communityModuleKeys';
import { useAppAnimations } from '../../hooks/useAppAnimations';
import AppAnimationLayer from '../animations/AppAnimationLayer';

export interface CommunityModuleItem {
  label: string;
  desc: string;
  route: string;
  icon: string;
  iconLib?: 'feather' | 'material';
  tag?: string | null;
  /** Klucz do animacji z panelu admina (slot community_module_icon). */
  moduleKey: CommunityModuleKey;
}

function glassBorder(theme: ReturnType<typeof useTheme>['theme']) {
  return theme.border2;
}

function glassGradient(theme: ReturnType<typeof useTheme>['theme'], isDark: boolean): [string, string] {
  return [withAlpha(theme.primary, isDark ? '18' : '10'), withAlpha(theme.surface, isDark ? 'dd' : 'ee')];
}

function listGradient(theme: ReturnType<typeof useTheme>['theme'], isDark: boolean): [string, string, string] {
  return [withAlpha(theme.primary, isDark ? '14' : '0f'), withAlpha(theme.surface, isDark ? 'f2' : 'ee'), theme.bgAlt];
}

function ModuleIcon({ item, size, color }: { item: CommunityModuleItem; size: number; color: string }) {
  return item.iconLib === 'material'
    ? <MaterialCommunityIcons name={item.icon as any} size={size} color={color} />
    : <Feather name={item.icon as any} size={size} color={color} />;
}

function IconCircle({ item, size = 22 }: { item: CommunityModuleItem; size?: number }) {
  const { theme } = useTheme();
  const { animations } = useAppAnimations(['community_module_icon']);
  const iconAnimation = pickAppAnimationForModuleKey(animations, item.moduleKey);
  const animatedIconBg = iconAnimation ? '#050505' : theme.primaryBg;
  return (
    <View style={{
      width: 48,
      height: 48,
      borderRadius: 24,
      backgroundColor: animatedIconBg,
      borderWidth: 1,
      borderColor: theme.primaryBorder,
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
      }}>
      {iconAnimation ? (
        <AppAnimationLayer
          animation={iconAnimation}
          style={{ width: size + 16, height: size + 16 }}
          fallbackIcon={<ModuleIcon item={item} size={size} color={theme.primary} />}
        />
      ) : (
        <ModuleIcon item={item} size={size} color={theme.primary} />
      )}
    </View>
  );
}

function ModuleTag({ label }: { label: string }) {
  const { theme, isDark } = useTheme();
  return (
    <View style={{
      backgroundColor: theme.primary,
      borderRadius: 6,
      paddingHorizontal: 8,
      paddingVertical: 3,
    }}>
      <Text style={{
        fontSize: 12,
        color: isDark ? '#000000' : '#ffffff',
        fontWeight: '900',
        letterSpacing: 1,
        textTransform: 'uppercase',
      }}>
        {label}
      </Text>
    </View>
  );
}

function PressWrap({ onPress, style, children }: { onPress: () => void; style?: any; children: React.ReactNode }) {
  const scale = useRef(new Animated.Value(1)).current;
  return (
    <Animated.View style={[{ transform: [{ scale }] }, style]}>
      <TouchableOpacity
        activeOpacity={0.88}
        onPressIn={() => Animated.spring(scale, { toValue: 0.97, useNativeDriver: true, speed: 50 }).start()}
        onPressOut={() => Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 50 }).start()}
        onPress={onPress}
      >
        {children}
      </TouchableOpacity>
    </Animated.View>
  );
}

export function CommunityModuleCardGrid({ item, style }: { item: CommunityModuleItem; style?: any }) {
  const router = useRouter();
  const { theme, isDark } = useTheme();
  const blurIntensity = Platform.OS === 'ios' ? 22 : 16;

  return (
    <PressWrap onPress={() => router.push(item.route as any)} style={style}>
      <View style={{
        borderRadius: 24,
        overflow: 'hidden',
        minHeight: 156,
        borderWidth: 1,
        borderColor: glassBorder(theme),
      }}>
        <BlurView
          tint={isDark ? 'dark' : 'light'}
          intensity={blurIntensity}
          style={StyleSheet.absoluteFillObject}
        />
        <LinearGradient
          colors={glassGradient(theme, isDark)}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFillObject}
        />
        <View style={{ padding: 18 }}>
          <View style={{ marginBottom: 14 }}>
            <IconCircle item={item} />
          </View>
          <Text style={{
            color: theme.text,
            fontSize: 12,
            fontWeight: '900',
            letterSpacing: 1,
            textTransform: 'uppercase',
            marginBottom: 5,
          }}>
            {item.label}
          </Text>
          <Text style={{
            color: theme.textDim,
            fontSize: 12,
            lineHeight: 16,
            fontWeight: '500',
          }} numberOfLines={2}>
            {item.desc}
          </Text>
        </View>
      </View>
    </PressWrap>
  );
}

export function CommunityModuleCardList({ item }: { item: CommunityModuleItem }) {
  const router = useRouter();
  const { theme, isDark } = useTheme();

  return (
    <PressWrap onPress={() => router.push(item.route as any)}>
      <LinearGradient
        colors={listGradient(theme, isDark)}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{
          borderRadius: 18,
          borderWidth: 1,
          borderColor: glassBorder(theme),
        }}
      >
        <View style={{
          paddingVertical: 16,
          paddingHorizontal: 16,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 14,
        }}>
          <IconCircle item={item} size={20} />
          <View style={{ flex: 1, gap: 4 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <Text style={{
                color: theme.text,
                fontSize: 13,
                fontWeight: '900',
                letterSpacing: 1,
                textTransform: 'uppercase',
              }}>
                {item.label}
              </Text>
              {item.tag ? <ModuleTag label={item.tag} /> : null}
            </View>
            <Text style={{
              color: theme.textDim,
              fontSize: 12,
              lineHeight: 16,
              fontWeight: '500',
            }} numberOfLines={2}>
              {item.desc}
            </Text>
          </View>
          <MaterialCommunityIcons name="chevron-right" size={24} color={theme.primary} />
        </View>
      </LinearGradient>
    </PressWrap>
  );
}
