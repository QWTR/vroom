import React from 'react';
import { ScrollView, TouchableOpacity, View } from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { LinearGradient } from 'expo-linear-gradient';
import { AppText as Text } from '../ui/AppText';

export type ProfileTab = 'garage' | 'activity' | 'spots' | 'about';
type Palette = { text: string; textDim: string; surface: string; border: string };
const tabs = [
  { id: 'garage', label: 'Garaż', icon: 'car-sports' },
  { id: 'activity', label: 'Aktywność', icon: 'chart-timeline-variant' },
  { id: 'spots', label: 'Spoty', icon: 'map-marker-outline' },
  { id: 'about', label: 'O mnie', icon: 'account-outline' },
] as const;

export function ProfileNavigation({ value, onChange, theme, colors }: {
  value: ProfileTab;
  onChange: (tab: ProfileTab) => void;
  theme: Palette;
  colors: readonly string[];
}) {
  return (
    <View style={{ marginTop: 20, marginBottom: 24, borderBottomWidth: 1, borderBottomColor: theme.border }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ flexGrow: 1, gap: 6 }}>
        {tabs.map(tab => {
          const selected = tab.id === value;
          return (
            <TouchableOpacity key={tab.id} accessibilityRole="tab" accessibilityState={{ selected }}
              accessibilityLabel={tab.label} testID={`profile-tab-${tab.id}`} onPress={() => onChange(tab.id)}
              activeOpacity={0.75} style={{ flex: 1, minHeight: 60, minWidth: 74, paddingHorizontal: 8, paddingTop: 10, paddingBottom: 16, alignItems: 'center', gap: 6 }}>
              <MaterialCommunityIcons name={tab.icon} size={20} color={selected ? theme.text : theme.textDim} />
              <Text style={{ fontSize: 13, fontWeight: selected ? '800' : '500', color: selected ? theme.text : theme.textDim }}>{tab.label}</Text>
              {selected && <LinearGradient colors={(colors.length >= 2 ? colors : ['#e33835', '#ff7959']) as [string, string, ...string[]]}
                start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ position: 'absolute', bottom: 0, left: 8, right: 8, height: 3, borderRadius: 3 }} />}
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}

export function ProfileMetrics({ theme, items }: {
  theme: Palette;
  items: { label: string; value: string; onPress: () => void }[];
}) {
  return (
    <View style={{ flexDirection: 'row', backgroundColor: theme.surface, borderRadius: 22, borderWidth: 1, borderColor: theme.border, paddingVertical: 8 }}>
      {items.map((item, index) => (
        <TouchableOpacity key={item.label} accessibilityRole="button" accessibilityLabel={`${item.label}: ${item.value}`}
          onPress={item.onPress} activeOpacity={0.7} style={{ flex: 1, minHeight: 76, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 4, paddingVertical: 10, gap: 5,
            borderLeftWidth: index ? 1 : 0, borderLeftColor: theme.border }}>
          <Text adjustsFontSizeToFit minimumFontScale={0.7} numberOfLines={1} style={{ color: theme.text, fontSize: 23, fontWeight: '800', letterSpacing: -0.7 }}>{item.value}</Text>
          <Text style={{ color: theme.textDim, fontSize: 12 }}>{item.label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

export function ProfileChapter({ title, description, theme }: { title: string; description: string; theme: Palette }) {
  return <View style={{ marginBottom: 22, gap: 6 }}>
    <Text accessibilityRole="header" style={{ color: theme.text, fontSize: 28, fontWeight: '800', letterSpacing: -0.8 }}>{title}</Text>
    <Text style={{ color: theme.textDim, fontSize: 14, lineHeight: 21 }}>{description}</Text>
  </View>;
}
