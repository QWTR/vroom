import React from 'react';
import { View, TouchableOpacity, Text } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';

const RED = '#e33835';

export function SettingsSectionLabel({ title, isDark }: { title: string; isDark: boolean }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 28, marginBottom: 12, marginHorizontal: 4 }}>
      <View style={{ flex: 1, height: 1, backgroundColor: isDark ? '#ffffff08' : '#00000010' }} />
      <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: RED + '90', letterSpacing: 3 }}>{title}</Text>
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
        style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, gap: 12, opacity: disabled ? 0.4 : 1 }}
        onPress={onPress}
        activeOpacity={onPress ? 0.7 : 1}
        disabled={disabled || !onPress}
      >
        <View style={{ width: 36, height: 36, borderRadius: 11, backgroundColor: ic + '20', borderWidth: 1, borderColor: ic + '30', justifyContent: 'center', alignItems: 'center' }}>
          <MaterialIcons name={icon as any} size={17} color={ic} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontFamily: 'Orbitron', fontSize: 12, color: destructive ? RED : textMain, fontWeight: '600' }}>{label}</Text>
          {sublabel ? <Text style={{ fontFamily: 'Orbitron', fontSize: 9, color: textDim, marginTop: 3, lineHeight: 14 }}>{sublabel}</Text> : null}
        </View>
        {right !== undefined ? right : (onPress ? <MaterialIcons name="chevron-right" size={18} color={textDim} /> : null)}
      </TouchableOpacity>
      {!last ? <View style={{ height: 1, backgroundColor: divider, marginLeft: 64 }} /> : null}
    </>
  );
}
