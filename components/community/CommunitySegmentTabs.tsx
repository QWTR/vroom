import React from 'react';
import { View, TouchableOpacity } from 'react-native';
import { AppText as Text } from '../ui/AppText';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useTheme } from '../../contexts/ThemeContext';

export interface CommunityTabItem {
  key: string;
  label: string;
  icon?: string;
}

interface Props {
  tabs: CommunityTabItem[];
  activeKey: string;
  onChange: (key: string) => void;
  compact?: boolean;
}

export function CommunitySegmentTabs({ tabs, activeKey, onChange, compact }: Props) {
  const { theme } = useTheme();

  return (
    <View style={{
      flexDirection: 'row',
      marginHorizontal: 16,
      marginTop: 8,
      marginBottom: 4,
      borderBottomWidth: 1,
      borderBottomColor: theme.border,
    }}>
      {tabs.map(tab => {
        const active = activeKey === tab.key;
        return (
          <TouchableOpacity
            key={tab.key}
            style={{
              flex: 1,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 4,
              paddingVertical: compact ? 10 : 12,
              borderBottomWidth: 2,
              borderBottomColor: active ? theme.primary : 'transparent',
              marginBottom: -1,
            }}
            onPress={() => onChange(tab.key)}
            activeOpacity={0.7}
          >
            {tab.icon ? (
              <MaterialIcons
                name={tab.icon as any}
                size={13}
                color={active ? theme.primary : theme.textDim}
              />
            ) : null}
            <Text style={{
              fontFamily: 'Manrope_600SemiBold',
              fontSize: compact ? 8 : 9,
              fontWeight: active ? '700' : '500',
              color: active ? theme.primary : theme.textDim,
              letterSpacing: 0.5,
            }}>
              {tab.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}
