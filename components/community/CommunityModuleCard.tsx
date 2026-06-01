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
  accent: string;
  tag?: string | null;
}

function ModuleIcon({ item, size, color }: { item: CommunityModuleItem; size: number; color: string }) {
  return item.iconLib === 'material'
    ? <MaterialCommunityIcons name={item.icon as any} size={size} color={color} />
    : <Feather name={item.icon as any} size={size} color={color} />;
}

function PressWrap({ onPress, style, children }: { onPress: () => void; style?: any; children: React.ReactNode }) {
  const scale = useRef(new Animated.Value(1)).current;
  return (
    <Animated.View style={[{ transform: [{ scale }] }, style]}>
      <TouchableOpacity
        activeOpacity={1}
        onPressIn={() => Animated.spring(scale, { toValue: 0.96, useNativeDriver: true, speed: 40 }).start()}
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

  return (
    <PressWrap onPress={() => router.push(item.route as any)} style={style}>
      <View style={{
        backgroundColor: theme.surface,
        borderRadius: 22,
        borderWidth: 1,
        borderColor: theme.border2,
        padding: 18,
        minHeight: 140,
        overflow: 'hidden',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: isDark ? 0.35 : 0.08,
        shadowRadius: 12,
        elevation: 4,
      }}>
        <View style={{
          position: 'absolute',
          top: -20,
          right: -20,
          width: 80,
          height: 80,
          borderRadius: 40,
          backgroundColor: item.accent + '14',
        }} />
        <View style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          height: 3,
          backgroundColor: item.accent,
          opacity: 0.55,
        }} />
        <View style={{
          width: 48,
          height: 48,
          borderRadius: 16,
          backgroundColor: item.accent + '18',
          borderWidth: 1,
          borderColor: item.accent + '35',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: 12,
        }}>
          <ModuleIcon item={item} size={22} color={item.accent} />
        </View>
        <Text style={{
          color: theme.text,
          fontFamily: 'Orbitron',
          fontSize: 11,
          fontWeight: '800',
          letterSpacing: 0.8,
          marginBottom: 4,
        }}>
          {item.label}
        </Text>
        <Text style={{
          color: theme.textDim,
          fontFamily: 'Orbitron',
          fontSize: 8,
          lineHeight: 12,
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

  return (
    <PressWrap onPress={() => router.push(item.route as any)}>
      <View style={{
        backgroundColor: theme.surface,
        borderRadius: 20,
        borderWidth: 1,
        borderColor: item.accent + '28',
        paddingVertical: 16,
        paddingHorizontal: 16,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
        overflow: 'hidden',
        shadowColor: item.accent,
        shadowOffset: { width: 0, height: 3 },
        shadowOpacity: isDark ? 0.12 : 0.06,
        shadowRadius: 10,
        elevation: 3,
      }}>
        <View style={{
          position: 'absolute',
          left: 0,
          top: 0,
          bottom: 0,
          width: 4,
          backgroundColor: item.accent,
          borderTopLeftRadius: 20,
          borderBottomLeftRadius: 20,
        }} />
        <View style={{
          width: 50,
          height: 50,
          borderRadius: 16,
          backgroundColor: item.accent + '15',
          borderWidth: 1,
          borderColor: item.accent + '30',
          alignItems: 'center',
          justifyContent: 'center',
        }}>
          <ModuleIcon item={item} size={24} color={item.accent} />
        </View>
        <View style={{ flex: 1, gap: 4 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <Text style={{
              color: theme.text,
              fontFamily: 'Orbitron',
              fontSize: 12,
              fontWeight: '800',
              letterSpacing: 0.6,
            }}>
              {item.label}
            </Text>
            {item.tag ? (
              <View style={{
                backgroundColor: item.accent,
                borderRadius: 6,
                paddingHorizontal: 7,
                paddingVertical: 2,
              }}>
                <Text style={{
                  fontFamily: 'Orbitron',
                  fontSize: 7,
                  color: '#fff',
                  letterSpacing: 1,
                  fontWeight: '800',
                }}>
                  {item.tag}
                </Text>
              </View>
            ) : null}
          </View>
          <Text style={{
            color: theme.textDim,
            fontFamily: 'Orbitron',
            fontSize: 8,
            lineHeight: 13,
          }} numberOfLines={2}>
            {item.desc}
          </Text>
        </View>
        <View style={{
          width: 32,
          height: 32,
          borderRadius: 10,
          backgroundColor: item.accent + '15',
          borderWidth: 1,
          borderColor: item.accent + '25',
          alignItems: 'center',
          justifyContent: 'center',
        }}>
          <Feather name="chevron-right" size={16} color={item.accent} />
        </View>
      </View>
    </PressWrap>
  );
}
