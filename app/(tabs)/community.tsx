import React from 'react';
import {
  View, Text, StatusBar, ScrollView, Dimensions,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../contexts/ThemeContext';
import { useDailyDuel } from '../../hooks/useDailyDuel';
import {
  DailyDuelHero,
  CommunitySectionLabel,
  CommunityModuleCardGrid,
  CommunityModuleCardList,
  type CommunityModuleItem,
} from '../../components/community';

const { width: SCREEN_W } = Dimensions.get('window');
const QUICK_CARD_W = (SCREEN_W - 16 * 2 - 12) / 2;

const QUICK_ACCESS: CommunityModuleItem[] = [
  {
    label: 'DYSKUSJE',
    desc: 'Posty, trasy, auta i społeczność.',
    route: '/Community/community/community',
    icon: 'forum',
    iconLib: 'material',
  },
  {
    label: 'CHAT',
    desc: 'DM, grupy i znajomi.',
    route: '/Community/chats/chats',
    icon: 'account-group-outline',
    iconLib: 'material',
  },
  {
    label: 'WYDARZENIA',
    desc: 'Meety i zloty w okolicy.',
    route: '/Community/meets/events',
    icon: 'calendar',
    iconLib: 'feather',
  },
  {
    label: 'RANKINGI',
    desc: 'Punkty, dystans, podium.',
    route: '/Community/Ranks/stats',
    icon: 'bar-chart-2',
    iconLib: 'feather',
  },
];

const RIVALRY: CommunityModuleItem[] = [
  {
    label: 'THE GRID',
    desc: 'Turniej 1v1 — zgłoś auto i walcz o LEGENDARY.',
    route: '/Community/grid/grid',
    icon: 'flag-checkered',
    iconLib: 'material',
    tag: 'ARENA',
  },
];

const SOCIAL: CommunityModuleItem[] = [
  {
    label: 'KLUBY',
    desc: 'Własny klub, rangi, czat i moderacja.',
    route: '/Community/clubs/clubs',
    icon: 'shield-crown-outline',
    iconLib: 'material',
    tag: 'NOWE',
  },
  {
    label: 'CZAT OGÓLNY',
    desc: 'Live chat całej społeczności VROOM.',
    route: '/Community/public/public',
    icon: 'earth',
    iconLib: 'material',
    tag: 'LIVE',
  },
];

const TRADE: CommunityModuleItem[] = [
  {
    label: 'GIEŁDA',
    desc: 'Kup lub sprzedaj auto, moto i części.',
    route: '/Community/market/market',
    icon: 'tag-multiple-outline',
    iconLib: 'material',
  },
];

export default function Community() {
  const router = useRouter();
  const { theme, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const { duel, loading: duelLoading } = useDailyDuel(30000);

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor="transparent" translucent />

      <ScrollView
        contentContainerStyle={{ paddingBottom: 120, paddingTop: insets.top + 16 }}
        showsVerticalScrollIndicator={false}
      >
        <View style={{ paddingHorizontal: 20, paddingBottom: 28 }}>
          <Text style={{
            color: theme.textDim,
            fontSize: 11,
            fontWeight: '500',
            letterSpacing: 3,
            textTransform: 'uppercase',
            marginBottom: 8,
          }}>
            VROOM
          </Text>
          <Text style={{
            color: theme.text,
            fontFamily: 'Orbitron',
            fontSize: 28,
            fontWeight: '900',
            letterSpacing: 2,
          }}>
            SPOŁECZNOŚĆ
          </Text>
          <Text style={{
            color: theme.textDim,
            fontSize: 13,
            marginTop: 8,
            lineHeight: 18,
          }}>
            Rywalizuj, rozmawiaj, odkrywaj
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 20, gap: 10 }}>
            <View style={{ width: 28, height: 2, backgroundColor: theme.primary, borderRadius: 1 }} />
            <View style={{ flex: 1, height: 1, backgroundColor: isDark ? '#ffffff08' : theme.border2 }} />
          </View>
        </View>

        <DailyDuelHero
          duel={duel}
          loading={duelLoading}
          onPressVote={() => router.push('/Community/duel/vote' as any)}
        />

        <CommunitySectionLabel label="SZYBKI DOSTĘP" icon="zap" />
        <View style={{
          paddingHorizontal: 16,
          flexDirection: 'row',
          flexWrap: 'wrap',
          gap: 12,
          marginBottom: 20,
        }}>
          {QUICK_ACCESS.map(item => (
            <View key={item.route} style={{ width: QUICK_CARD_W }}>
              <CommunityModuleCardGrid item={item} />
            </View>
          ))}
        </View>

        <CommunitySectionLabel label="RYWALIZACJA" icon="trophy" iconLib="material" />
        <View style={{ paddingHorizontal: 16, gap: 12, marginBottom: 20 }}>
          {RIVALRY.map(item => (
            <CommunityModuleCardList key={item.route} item={item} />
          ))}
        </View>

        <CommunitySectionLabel label="SPOŁECZNOŚĆ" icon="users" />
        <View style={{ paddingHorizontal: 16, gap: 12, marginBottom: 20 }}>
          {SOCIAL.map(item => (
            <CommunityModuleCardList key={item.route} item={item} />
          ))}
        </View>

        <CommunitySectionLabel label="HANDEL" icon="shopping-bag" />
        <View style={{ paddingHorizontal: 16, gap: 12, marginBottom: 8 }}>
          {TRADE.map(item => (
            <CommunityModuleCardList key={item.route} item={item} />
          ))}
        </View>
      </ScrollView>
    </View>
  );
}
