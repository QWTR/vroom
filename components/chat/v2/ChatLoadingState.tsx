import React, { type ReactNode } from 'react';
import { View, ActivityIndicator, TouchableOpacity, StyleSheet } from 'react-native';
import { AppText as Text } from '../../ui/AppText';
import { MaterialIcons } from '@expo/vector-icons';
import { useTheme } from '../../../contexts/ThemeContext';
import { VROOM_RED } from './constants';

type Props = {
  icon?: string;
  title?: string;
  subtitle?: string;
};

export function ChatLoadingState({ icon = 'car-sports', title, subtitle }: Props) {
  const { theme } = useTheme();
  return (
    <View style={styles.wrap}>
      <View style={[styles.iconCircle, { borderColor: `${VROOM_RED}25`, backgroundColor: `${VROOM_RED}10` }]}>
        <MaterialIcons name={icon as any} size={32} color={`${VROOM_RED}60`} />
      </View>
      {title && (
        <Text style={[styles.title, { color: theme.text }]}>{title}</Text>
      )}
      <ActivityIndicator color={VROOM_RED} />
      {subtitle && (
        <Text style={[styles.sub, { color: theme.textDim }]}>{subtitle}</Text>
      )}
    </View>
  );
}

type EmptyProps = {
  icon?: string;
  title: string;
  subtitle?: string;
  actionLabel?: string;
  onAction?: () => void;
  footer?: ReactNode;
};

export function ChatEmptyState({ icon = 'chat-outline', title, subtitle, actionLabel, onAction, footer }: EmptyProps) {
  const { theme } = useTheme();
  return (
    <View style={styles.wrap}>
      <View style={[styles.iconCircle, { borderColor: `${VROOM_RED}25`, backgroundColor: `${VROOM_RED}10` }]}>
        <MaterialIcons name={icon as any} size={32} color={`${VROOM_RED}60`} />
      </View>
      <Text style={[styles.title, { color: theme.text }]}>{title}</Text>
      {subtitle && (
        <Text style={[styles.sub, { color: theme.textDim }]}>{subtitle}</Text>
      )}
      {actionLabel && onAction && (
        <TouchableOpacity
          style={[styles.cta, { backgroundColor: theme.primaryBg, borderColor: theme.primaryBorder }]}
          onPress={onAction}
          activeOpacity={0.8}
        >
          <Text style={[styles.ctaText, { color: theme.primary }]}>{actionLabel}</Text>
        </TouchableOpacity>
      )}
      {footer}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingTop: 60,
    paddingHorizontal: 24,
  },
  iconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { fontFamily: 'Manrope_600SemiBold', fontSize: 13, fontWeight: '700', textAlign: 'center' },
  sub: { fontFamily: 'Manrope_600SemiBold', fontSize: 12, letterSpacing: 1, textAlign: 'center' },
  cta: {
    marginTop: 8,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  ctaText: { fontFamily: 'Manrope_600SemiBold', fontSize: 12, letterSpacing: 1, fontWeight: '700' },
});
