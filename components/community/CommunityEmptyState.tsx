import React, { ReactNode } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useTheme } from '../../contexts/ThemeContext';

interface Props {
  icon?: string;
  title: string;
  subtitle?: string;
  actionLabel?: string;
  onAction?: () => void;
  children?: ReactNode;
}

export function CommunityEmptyState({
  icon = 'inbox-outline',
  title,
  subtitle,
  actionLabel,
  onAction,
  children,
}: Props) {
  const { theme } = useTheme();

  return (
    <View style={{ alignItems: 'center', paddingVertical: 48, paddingHorizontal: 24 }}>
      <View style={{
        width: 72,
        height: 72,
        borderRadius: 24,
        backgroundColor: theme.surface2,
        borderWidth: 1,
        borderColor: theme.border2,
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 16,
      }}>
        <MaterialCommunityIcons name={icon as any} size={36} color={theme.border3} />
      </View>
      <Text style={{
        fontFamily: 'Orbitron',
        fontSize: 12,
        color: theme.text,
        fontWeight: '700',
        letterSpacing: 1,
        textAlign: 'center',
      }}>
        {title}
      </Text>
      {subtitle ? (
        <Text style={{
          fontFamily: 'Orbitron',
          fontSize: 9,
          color: theme.textDim,
          marginTop: 8,
          textAlign: 'center',
          lineHeight: 14,
        }}>
          {subtitle}
        </Text>
      ) : null}
      {actionLabel && onAction ? (
        <TouchableOpacity
          onPress={onAction}
          style={{
            marginTop: 20,
            backgroundColor: theme.primary,
            borderRadius: 12,
            paddingHorizontal: 20,
            paddingVertical: 12,
          }}
        >
          <Text style={{
            fontFamily: 'Orbitron',
            fontSize: 10,
            color: theme.onPrimary,
            fontWeight: '800',
            letterSpacing: 1,
          }}>
            {actionLabel}
          </Text>
        </TouchableOpacity>
      ) : null}
      {children}
    </View>
  );
}
