import React from 'react';
import { View, TouchableOpacity } from 'react-native';
import { AppText as Text } from '../ui/AppText';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';

const RED = '#e33835';

export function SettingsSectionLabel({ title, isDark }: { title: string; isDark: boolean }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 30, marginBottom: 14, marginHorizontal: 4 }}>
      <View style={{ flex: 1, height: 1, backgroundColor: isDark ? '#ffffff08' : '#00000010' }} />
      <Text variant="label" style={{ fontSize: 14, color: isDark ? '#ff7774' : '#9f1412', fontWeight: '700', letterSpacing: 0.4 }}>{title}</Text>
      <View style={{ flex: 1, height: 1, backgroundColor: isDark ? '#ffffff08' : '#00000010' }} />
    </View>
  );
}

export function SettingsCard({
  children,
  danger = false,
  cardBg,
  dangerCardBg,
  cardBorder,
}: {
  children: React.ReactNode;
  danger?: boolean;
  cardBg: string;
  dangerCardBg: string;
  cardBorder: string;
}) {
  return (
    <View style={{ backgroundColor: danger ? dangerCardBg : cardBg, borderRadius: 18, overflow: 'hidden', borderWidth: 1, borderColor: danger ? RED + '25' : cardBorder }}>
      {children}
    </View>
  );
}

export function SettingsRow({
  icon,
  iconBg,
  label,
  sublabel,
  onPress,
  right,
  destructive = false,
  disabled = false,
  last = false,
  textMain,
  textDim,
  divider,
}: {
  icon: string;
  iconBg?: string;
  label: string;
  sublabel?: string;
  onPress?: () => void;
  right?: React.ReactNode;
  destructive?: boolean;
  disabled?: boolean;
  last?: boolean;
  textMain: string;
  textDim: string;
  divider: string;
}) {
  const ic = destructive ? RED : (iconBg ?? RED);
  return (
    <>
      <TouchableOpacity
        style={{ minHeight: 76, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, gap: 12, opacity: disabled ? 0.72 : 1 }}
        onPress={onPress}
        activeOpacity={onPress ? 0.7 : 1}
        disabled={disabled || !onPress}
      >
        <View style={{ width: 44, height: 44, borderRadius: 13, backgroundColor: ic + '20', borderWidth: 1.5, borderColor: ic + '60', justifyContent: 'center', alignItems: 'center' }}>
          <MaterialIcons name={icon as any} size={22} color={ic} />
        </View>
        <View style={{ flex: 1 }}>
          <Text variant="body" style={{ fontSize: 16, color: destructive ? RED : textMain, fontWeight: '600' }}>{label}</Text>
          {sublabel ? <Text variant="bodySmall" style={{ fontSize: 14, color: textDim, marginTop: 4, lineHeight: 21 }}>{sublabel}</Text> : null}
        </View>
        {right !== undefined ? right : (onPress ? <MaterialIcons name="chevron-right" size={24} color={textDim} /> : null)}
      </TouchableOpacity>
      {!last ? <View style={{ height: 1, backgroundColor: divider, marginLeft: 76 }} /> : null}
    </>
  );
}
