import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  StatusBar,
  ScrollView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';

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
  const router = useRouter();

  return (
    <View style={s.container}>
      <StatusBar barStyle="light-content" backgroundColor="#0a0a0a" />

      {/* ── HEADER ── */}
      <View style={s.header}>
        <Text style={s.headerSub}>VROOM</Text>
        <Text style={s.headerTitle}>SPOŁECZNOŚĆ</Text>
        <View style={s.headerLine} />
      </View>

      <ScrollView
        contentContainerStyle={s.scroll}
        showsVerticalScrollIndicator={false}
      >
        {communityMenu.map((item, index) => (
          <TouchableOpacity
            key={item.route}
            style={s.card}
            activeOpacity={0.75}
            onPress={() => router.push(item.route as any)}
          >
            {/* Left accent bar */}
            <View style={[s.accentBar, { backgroundColor: item.accent }]} />

            {/* Icon box */}
            <View style={[s.iconBox, { borderColor: item.accent + '30', backgroundColor: item.accent + '12' }]}>
              {item.iconLib === 'material' ? (
                <MaterialCommunityIcons name={item.icon as any} size={28} color={item.accent} />
              ) : (
                <Feather name={item.icon as any} size={26} color={item.accent} />
              )}
            </View>

            {/* Text */}
            <View style={s.textWrap}>
              <Text style={s.cardTitle}>{item.label}</Text>
              <Text style={s.cardDesc}>{item.desc}</Text>
            </View>

            {/* Arrow */}
            <Feather name="chevron-right" size={18} color="#ffffff25" />
          </TouchableOpacity>
        ))}

        {/* Bottom padding for tab bar */}
        <View style={{ height: 100 }} />
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a0a',
  },

  // ── HEADER ──
  header: {
    paddingTop: 60,
    paddingHorizontal: 24,
    paddingBottom: 24,
  },
  headerSub: {
    color: '#e33835',
    fontSize: 11,
    fontFamily: 'Orbitron',
    letterSpacing: 4,
    marginBottom: 4,
  },
  headerTitle: {
    color: '#ffffff',
    fontSize: 28,
    fontFamily: 'Orbitron',
    fontWeight: '700',
    letterSpacing: 3,
    marginBottom: 16,
  },
  headerLine: {
    height: 1,
    backgroundColor: '#ffffff10',
  },

  // ── SCROLL ──
  scroll: {
    paddingHorizontal: 16,
    paddingTop: 16,
  },

  // ── CARD ──
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#141414',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#ffffff08',
    marginBottom: 14,
    paddingVertical: 20,
    paddingRight: 18,
    paddingLeft: 0,
    gap: 16,
    overflow: 'hidden',
  },
  accentBar: {
    width: 3,
    height: '60%',
    borderTopRightRadius: 2,
    borderBottomRightRadius: 2,
    marginLeft: 0,
    alignSelf: 'center',
  },
  iconBox: {
    width: 52,
    height: 52,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textWrap: {
    flex: 1,
    gap: 5,
  },
  cardTitle: {
    color: '#ffffff',
    fontFamily: 'Orbitron',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 1.5,
  },
  cardDesc: {
    color: '#ffffff50',
    fontFamily: 'Orbitron',
    fontSize: 10,
    lineHeight: 15,
    letterSpacing: 0.3,
  },
});