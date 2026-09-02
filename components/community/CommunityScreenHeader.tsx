import React, { ReactNode } from 'react';
import { View, TouchableOpacity, Platform, StatusBar, useWindowDimensions } from 'react-native';
import { AppText as Text } from '../ui/AppText';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useRouter } from 'expo-router';
import { useTheme } from '../../contexts/ThemeContext';
import { useReadability } from '../../contexts/ReadabilityContext';

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
  const { textScale } = useReadability();
  const { fontScale } = useWindowDimensions();
  const expandedLayout = Math.min(2, textScale * fontScale) >= 1.2;
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
          style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <MaterialIcons name="arrow-back" size={18} color={theme.textDim} />
          <Text style={{ fontFamily: 'Manrope_600SemiBold', fontSize: 12, color: theme.textDim, letterSpacing: 1 }}>
            {breadcrumb}
          </Text>
        </TouchableOpacity>
      ) : null}

      <View style={{ flexDirection: 'row', flexWrap: expandedLayout ? 'wrap' : 'nowrap', alignItems: 'center', justifyContent: 'space-between', gap: expandedLayout ? 12 : 0 }}>
        {center ?? (
          <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            {accentDot && (
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: theme.primary }} />
            )}
            <View style={{ flex: 1 }}>
              <Text style={{
                fontFamily: 'Manrope_600SemiBold',
                color: theme.text,
                fontSize: 16,
                letterSpacing: 1,
                fontWeight: '800',
              }} numberOfLines={expandedLayout ? undefined : 1}>
                {title}
              </Text>
              {subtitleNode ?? (subtitle ? (
                <Text style={{
                  fontFamily: 'Manrope_600SemiBold',
                  color: theme.textDim,
                  fontSize: 12,
                  letterSpacing: 1,
                  marginTop: 3,
                }} numberOfLines={expandedLayout ? undefined : 1}>
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
