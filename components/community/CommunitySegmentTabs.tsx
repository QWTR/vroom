import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
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
      marginHorizontal: 12,
      marginTop: 10,
      marginBottom: 6,
      backgroundColor: theme.surface2,
      borderRadius: 16,
      padding: 4,
      borderWidth: 1,
      borderColor: theme.border,
    }}>
      {tabs.map(tab => {
        const active = activeKey === tab.key;
        return (
          <TouchableOpacity
            key={tab.key}
            style={[{
              flex: 1,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 5,
              paddingVertical: compact ? 8 : 10,
              borderRadius: 12,
            }, active && { backgroundColor: theme.primary }]}
            onPress={() => onChange(tab.key)}
            activeOpacity={0.85}
          >
            {tab.icon ? (
              <MaterialIcons
                name={tab.icon as any}
                size={14}
                color={active ? theme.onPrimary : theme.textDim}
              />
            ) : null}
            <Text style={{
              fontFamily: 'Orbitron',
              fontSize: compact ? 8 : 9,
              fontWeight: '700',
              color: active ? theme.onPrimary : theme.textDim,
            }}>
              {tab.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}
