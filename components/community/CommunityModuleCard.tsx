import React, { useRef } from 'react';
import {
  View, Text, TouchableOpacity, Animated,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useRouter } from 'expo-router';
import { useTheme } from '../../contexts/ThemeContext';

export interface CommunityModuleItem {
  label: string;
  desc: string;
  route: string;
  icon: string;
  iconLib?: 'feather' | 'material';
  tag?: string | null;
}

function glassBorder(isDark: boolean, theme: ReturnType<typeof useTheme>['theme']) {
  return isDark ? '#ffffff10' : theme.border2;
}

function ModuleIcon({ item, size, color }: { item: CommunityModuleItem; size: number; color: string }) {
  return item.iconLib === 'material'
    ? <MaterialCommunityIcons name={item.icon as any} size={size} color={color} />
    : <Feather name={item.icon as any} size={size} color={color} />;
}

function IconCircle({ item, size = 22 }: { item: CommunityModuleItem; size?: number }) {
  const { theme } = useTheme();
  return (
    <View style={{
      width: 48,
      height: 48,
      borderRadius: 24,
      backgroundColor: theme.primaryBg,
      alignItems: 'center',
      justifyContent: 'center',
    }}>
      <ModuleIcon item={item} size={size} color={theme.primary} />
    </View>
  );
}

function ModuleTag({ label }: { label: string }) {
  const { theme } = useTheme();
  return (
    <View style={{
      backgroundColor: theme.primary,
      borderRadius: 10,
      paddingHorizontal: 8,
      paddingVertical: 3,
      minHeight: 18,
      justifyContent: 'center',
    }}>
      <Text style={{
        fontSize: 9,
        color: theme.onPrimary,
        fontWeight: 'bold',
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
        activeOpacity={0.85}
        onPressIn={() => Animated.spring(scale, { toValue: 0.97, useNativeDriver: true, speed: 40 }).start()}
        onPressOut={() => Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 40 }).start()}
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
  const borderColor = glassBorder(isDark, theme);

  return (
    <PressWrap onPress={() => router.push(item.route as any)} style={style}>
      <View style={{
        backgroundColor: theme.surface2,
        borderRadius: 24,
        borderWidth: 1,
        borderColor,
        padding: 18,
        minHeight: 148,
      }}>
        <View style={{ marginBottom: 14 }}>
          <IconCircle item={item} />
        </View>
        <Text style={{
          color: theme.text,
          fontSize: 13,
          fontWeight: '600',
          marginBottom: 4,
        }}>
          {item.label}
        </Text>
        <Text style={{
          color: theme.textDim,
          fontSize: 11,
          lineHeight: 15,
        }} numberOfLines={2}>
          {item.desc}
        </Text>
      </View>
    </PressWrap>
  );
}

export function CommunityModuleCardList({ item }: { item: CommunityModuleItem }) {
  const router = useRouter();
  const { theme, isDark } = useTheme();
  const borderColor = glassBorder(isDark, theme);

  return (
    <PressWrap onPress={() => router.push(item.route as any)}>
      <View style={{
        backgroundColor: theme.surface2,
        borderRadius: 20,
        borderWidth: 1,
        borderColor,
        paddingVertical: 16,
        paddingHorizontal: 16,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
      }}>
        <IconCircle item={item} size={22} />
        <View style={{ flex: 1, gap: 3 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <Text style={{
              color: theme.text,
              fontSize: 14,
              fontWeight: '600',
            }}>
              {item.label}
            </Text>
            {item.tag ? <ModuleTag label={item.tag} /> : null}
          </View>
          <Text style={{
            color: theme.textDim,
            fontSize: 11,
            lineHeight: 15,
          }} numberOfLines={2}>
            {item.desc}
          </Text>
        </View>
        <Feather name="chevron-right" size={18} color={theme.textDim} />
      </View>
    </PressWrap>
  );
}
