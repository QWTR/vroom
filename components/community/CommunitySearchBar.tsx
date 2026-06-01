import React from 'react';
import { View, Text, TextInput, TouchableOpacity } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useTheme } from '../../contexts/ThemeContext';

interface Props {
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  onClear?: () => void;
  autoFocus?: boolean;
}

export function CommunitySearchBar({
  value,
  onChangeText,
  placeholder = 'Szukaj...',
  onClear,
  autoFocus,
}: Props) {
  const { theme } = useTheme();

  return (
    <View style={{
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: theme.surface2,
      borderRadius: 14,
      paddingHorizontal: 12,
      paddingVertical: 10,
      gap: 8,
      borderWidth: 1,
      borderColor: theme.primaryBorder,
    }}>
      <MaterialIcons name="search" size={16} color={theme.primary} />
      <TextInput
        style={{ flex: 1, color: theme.text, fontSize: 14, fontFamily: 'Orbitron' }}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={theme.textDim}
        autoFocus={autoFocus}
      />
      {value.length > 0 && (
        <TouchableOpacity onPress={() => { onChangeText(''); onClear?.(); }}>
          <MaterialIcons name="close" size={16} color={theme.textDim} />
        </TouchableOpacity>
      )}
    </View>
  );
}

interface InlineProps extends Props {
  expanded: boolean;
  onExpand: () => void;
  onCollapse: () => void;
}

export function CommunitySearchBarInline({
  expanded,
  onExpand,
  onCollapse,
  value,
  onChangeText,
  placeholder,
  onClear,
}: InlineProps) {
  const { theme } = useTheme();

  if (expanded) {
    return (
      <View style={{ flex: 1 }}>
        <CommunitySearchBar
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          autoFocus
          onClear={() => { onClear?.(); onCollapse(); }}
        />
      </View>
    );
  }

  return (
    <TouchableOpacity onPress={onExpand} style={{ padding: 4 }}>
      <MaterialIcons name="search" size={22} color={theme.textDim} />
    </TouchableOpacity>
  );
}
