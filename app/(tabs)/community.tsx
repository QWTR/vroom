import React from 'react';
import {
  View, Text, TouchableOpacity, StatusBar, ScrollView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useTheme } from '../../contexts/ThemeContext';

const communityMenu = [
  {
    label: 'WYDARZENIA',
    desc: 'Zobacz aktualne eventy, meety i zloty w Twojej okolicy.',
    route: '/Community/meets/events',
    icon: 'calendar',
    iconLib: 'feather',
    accent: '#e33835',
  },
  {
    label: 'RANKINGI',
    desc: 'Ogolny Ranking VROOM.',
    route: '/Community/Ranks/stats',
    icon: 'bar-chart-2',
    iconLib: 'feather',
    accent: '#e33835',
  },
  {
    label: 'CHAT',
    desc: 'Dodawaj znajomych, twórz grupy.',
    route: '/Community/chats/chats',
    icon: 'account-group-outline',
    iconLib: 'material',
    accent: '#e33835',
  },
  {
    label: 'DYSKUSJE',
    desc: 'Prowadź dyskusje zamieszczaj posty i wiele wiecej.',
    route: '/Community/community/community',
    icon: 'account-group-outline',
    iconLib: 'material',
    accent: '#e33835',
  },
];

export default function Community() {
  const router    = useRouter();
  const { theme, isDark } = useTheme();

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <StatusBar
        barStyle={isDark ? 'light-content' : 'dark-content'}
        backgroundColor={theme.bg}
      />

      {/* ── HEADER ── */}
      <View style={{ paddingTop: 60, paddingHorizontal: 24, paddingBottom: 24 }}>
        <Text style={{
          color: theme.primary, fontSize: 11, fontFamily: 'Orbitron',
          letterSpacing: 4, marginBottom: 4,
        }}>
          VROOM
        </Text>
        <Text style={{
          color: theme.text, fontSize: 28, fontFamily: 'Orbitron',
          fontWeight: '700', letterSpacing: 3, marginBottom: 16,
        }}>
          SPOŁECZNOŚĆ
        </Text>
        <View style={{ height: 1, backgroundColor: theme.border }} />
      </View>

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 16 }}
        showsVerticalScrollIndicator={false}
      >
        {communityMenu.map((item) => (
          <TouchableOpacity
            key={item.route}
            style={{
              flexDirection: 'row', alignItems: 'center',
              backgroundColor: theme.surface,
              borderRadius: 16, borderWidth: 1, borderColor: theme.border2,
              marginBottom: 14,
              paddingVertical: 20, paddingRight: 18, paddingLeft: 0,
              gap: 16, overflow: 'hidden',
            }}
            activeOpacity={0.75}
            onPress={() => router.push(item.route as any)}
          >
            {/* Left accent bar */}
            <View style={{
              width: 3, height: '60%',
              borderTopRightRadius: 2, borderBottomRightRadius: 2,
              alignSelf: 'center',
              backgroundColor: item.accent,
            }} />

            {/* Icon box */}
            <View style={{
              width: 52, height: 52, borderRadius: 14, borderWidth: 1,
              alignItems: 'center', justifyContent: 'center',
              borderColor: item.accent + '30',
              backgroundColor: item.accent + '12',
            }}>
              {item.iconLib === 'material' ? (
                <MaterialCommunityIcons name={item.icon as any} size={28} color={item.accent} />
              ) : (
                <Feather name={item.icon as any} size={26} color={item.accent} />
              )}
            </View>

            {/* Text */}
            <View style={{ flex: 1, gap: 5 }}>
              <Text style={{
                color: theme.text, fontFamily: 'Orbitron',
                fontSize: 13, fontWeight: '700', letterSpacing: 1.5,
              }}>
                {item.label}
              </Text>
              <Text style={{
                color: theme.textDim, fontFamily: 'Orbitron',
                fontSize: 10, lineHeight: 15, letterSpacing: 0.3,
              }}>
                {item.desc}
              </Text>
            </View>

            {/* Arrow */}
            <Feather name="chevron-right" size={18} color={theme.textDim} />
          </TouchableOpacity>
        ))}

        <View style={{ height: 100 }} />
      </ScrollView>
    </View>
  );
}