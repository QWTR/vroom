import React from 'react';
import {
  View, Text, StatusBar, ScrollView, Dimensions, StyleSheet,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../contexts/ThemeContext';
import { getThemeChrome, withAlpha } from '../../constants/theme';
import { pickAppAnimationForValue } from '../../constants/appAnimations';
import { useAppAnimations } from '../../hooks/useAppAnimations';
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
    moduleKey: 'discussions',
  },
  {
    label: 'CHAT',
    desc: 'DM, grupy i znajomi.',
    route: '/Community/chats/chats',
    icon: 'account-group-outline',
    iconLib: 'material',
    moduleKey: 'chats',
  },
  {
    label: 'WYDARZENIA',
    desc: 'Meety i zloty w okolicy.',
    route: '/Community/meets/events',
    icon: 'calendar',
    iconLib: 'feather',
    moduleKey: 'events',
  },
  {
    label: 'RANKINGI',
    desc: 'Punkty, dystans, podium.',
    route: '/Community/Ranks/stats',
    icon: 'bar-chart-2',
    iconLib: 'feather',
    moduleKey: 'rankings',
  },
];

const RIVALRY: CommunityModuleItem[] = [
  {
    label: 'VROOMKI',
    desc: 'Rolki aut — lajki, komentarze i udostępnianie.',
    route: '/Community/vroomki',
    icon: 'smart-display',
    iconLib: 'material',
    tag: 'REELS',
    moduleKey: 'vroomki',
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
    moduleKey: 'clubs',
  },
  {
    label: 'CZAT OGÓLNY',
    desc: 'Live chat całej społeczności VROOM.',
    route: '/Community/public/public',
    icon: 'earth',
    iconLib: 'material',
    tag: 'LIVE',
    moduleKey: 'public_chat',
  },
];

const TRADE: CommunityModuleItem[] = [
  {
    label: 'GIEŁDA',
    desc: 'Kup lub sprzedaj auto, moto i części.',
    route: '/Community/market/market',
    icon: 'tag-multiple-outline',
    iconLib: 'material',
    moduleKey: 'market',
  },
];

export default function Community() {
  const router = useRouter();
  const { theme, isDark } = useTheme();
  const chrome = getThemeChrome(theme, isDark);
  const { animations } = useAppAnimations(['community_daily_duel_vs']);
  const duelVsAnimation = pickAppAnimationForValue(animations, 'community_daily_duel_vs');
  const insets = useSafeAreaInsets();
  const { duel, loading: duelLoading } = useDailyDuel(30000);

  const bgGradient = chrome.pageGradient;

  const headerLineGradient = isDark
    ? ['transparent', withAlpha(theme.primary, '99'), theme.border2]
    : ['transparent', withAlpha(theme.primary, '66'), theme.border2];

  return (
    <View style={{ flex: 1 }}>
      <LinearGradient
        colors={bgGradient}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={StyleSheet.absoluteFillObject}
      />

      <StatusBar
        barStyle={isDark ? 'light-content' : 'dark-content'}
        backgroundColor="transparent"
        translucent
      />

      <ScrollView
        contentContainerStyle={{ paddingBottom: 120, paddingTop: insets.top + 12 }}
        showsVerticalScrollIndicator={false}
      >
        <View style={{ paddingHorizontal: 20, paddingBottom: 24 }}>
          <Text style={{
            color: theme.textDim,
            fontSize: 10,
            fontWeight: '700',
            letterSpacing: 5,
            textTransform: 'uppercase',
            marginBottom: 6,
          }}>
            VROOM
          </Text>
          <Text style={{
            color: theme.text,
            fontFamily: 'Orbitron',
            fontSize: 30,
            fontWeight: '900',
            letterSpacing: 3,
          }}>
            SPOŁECZNOŚĆ
          </Text>
          <Text style={{
            color: theme.textDim,
            fontSize: 13,
            marginTop: 8,
            lineHeight: 18,
            fontWeight: '500',
          }}>
            Rywalizuj, rozmawiaj, odkrywaj
          </Text>
          <LinearGradient
            colors={headerLineGradient as [string, string, string]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={{ height: 1, marginTop: 20, borderRadius: 1 }}
          />
        </View>

        <DailyDuelHero
          duel={duel}
          loading={duelLoading}
          vsAnimation={duelVsAnimation}
          onPressVote={() => router.push('/Community/duel/vote' as any)}
        />

        <CommunitySectionLabel label="SZYBKI DOSTĘP" icon="zap" />
        <View style={{
          paddingHorizontal: 16,
          flexDirection: 'row',
          flexWrap: 'wrap',
          gap: 12,
          marginBottom: 24,
        }}>
          {QUICK_ACCESS.map(item => (
            <View key={item.route} style={{ width: QUICK_CARD_W }}>
              <CommunityModuleCardGrid item={item} />
            </View>
          ))}
        </View>

        <CommunitySectionLabel label="RYWALIZACJA" icon="trophy" iconLib="material" />
        <View style={{ paddingHorizontal: 16, gap: 12, marginBottom: 24 }}>
          {RIVALRY.map(item => (
            <CommunityModuleCardList key={item.route} item={item} />
          ))}
        </View>

        <CommunitySectionLabel label="SPOŁECZNOŚĆ" icon="users" />
        <View style={{ paddingHorizontal: 16, gap: 12, marginBottom: 24 }}>
          {SOCIAL.map(item => (
            <CommunityModuleCardList key={item.route} item={item} />
          ))}
        </View>

        <CommunitySectionLabel label="HANDEL" icon="shopping-bag" />
        <View style={{ paddingHorizontal: 16, gap: 12, marginBottom: 12 }}>
          {TRADE.map(item => (
            <CommunityModuleCardList key={item.route} item={item} />
          ))}
        </View>
      </ScrollView>
    </View>
  );
}
