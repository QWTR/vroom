import React, { ReactNode } from 'react';
import { View, Text, TouchableOpacity, Platform, StatusBar } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useRouter } from 'expo-router';
import { useTheme } from '../../contexts/ThemeContext';

interface Props {
  title: string;
  subtitle?: string;
  subtitleNode?: ReactNode;
  showBack?: boolean;
  onBack?: () => void;
  breadcrumb?: string;
  right?: ReactNode;
  center?: ReactNode;
  accentDot?: boolean;
}

export function CommunityScreenHeader({
  title,
  subtitle,
  subtitleNode,
  showBack = true,
  onBack,
  breadcrumb = 'SPOŁECZNOŚĆ',
  right,
  center,
  accentDot = true,
}: Props) {
  const router = useRouter();
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === 'ios'
    ? insets.top + 8
    : Math.max((StatusBar.currentHeight ?? 0) + 8, 12);

  const handleBack = () => {
    if (onBack) onBack();
    else router.back();
  };

  return (
    <View style={{
      paddingTop: topPad,
      paddingHorizontal: 16,
      paddingBottom: 12,
      borderBottomWidth: 1,
      borderBottomColor: theme.border,
      backgroundColor: theme.surface,
    }}>
      {showBack && breadcrumb ? (
        <TouchableOpacity
          onPress={handleBack}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 }}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <MaterialIcons name="arrow-back" size={18} color={theme.textDim} />
          <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: theme.textDim, letterSpacing: 2 }}>
            {breadcrumb}
          </Text>
        </TouchableOpacity>
      ) : null}

      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        {center ?? (
          <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            {accentDot && (
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: theme.primary }} />
            )}
            <View style={{ flex: 1 }}>
              <Text style={{
                fontFamily: 'Orbitron',
                color: theme.text,
                fontSize: 16,
                letterSpacing: 2,
                fontWeight: '800',
              }} numberOfLines={1}>
                {title}
              </Text>
              {subtitleNode ?? (subtitle ? (
                <Text style={{
                  fontFamily: 'Orbitron',
                  color: theme.textDim,
                  fontSize: 8,
                  letterSpacing: 1,
                  marginTop: 3,
                }} numberOfLines={1}>
                  {subtitle}
                </Text>
              ) : null)}
            </View>
          </View>
        )}
        {right}
      </View>
    </View>
  );
}
