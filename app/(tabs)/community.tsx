import React, { type ComponentProps } from 'react';
import { ScrollView, StatusBar, StyleSheet, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { AppText as Text } from '../../components/ui/AppText';
import Feather from '@expo/vector-icons/Feather';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../contexts/ThemeContext';
import { withAlpha, type AppTheme } from '../../constants/theme';
import { pickAppAnimationForValue } from '../../constants/appAnimations';
import { useAppAnimations } from '../../hooks/useAppAnimations';
import { useDailyDuel } from '../../hooks/useDailyDuel';
import { DailyDuelHero } from '../../components/community';
import { useTabScrollBottomPadding } from '../../lib/screenHeaderInsets';
import { useReadability } from '../../contexts/ReadabilityContext';

type IconName = ComponentProps<typeof MaterialCommunityIcons>['name'];
type Destination = { title: string; description: string; icon: IconName; route: string };
const chats: Destination[] = [
  { title: 'Wiadomości', description: 'Prywatne rozmowy i grupy', icon: 'message-text-outline', route: '/Community/chats/chats' },
  { title: 'Czat ogólny', description: 'Dołącz do rozmowy kierowców', icon: 'forum-outline', route: '/Community/public/public' },
  { title: 'Kluby', description: 'Znajdź ekipę, z którą nadajesz', icon: 'shield-crown-outline', route: '/Community/clubs/clubs' },
];
const discover: Destination[] = [
  { title: 'VROOMKI', description: 'Auta, zajawki i krótkie filmy.', icon: 'play-box-multiple-outline', route: '/Community/vroomki' },
  { title: 'Newsy', description: 'Co słychać w motoryzacji.', icon: 'newspaper-variant-outline', route: '/Community/news' },
];

function Section({ number, title, theme }: { number: string; title: string; theme: AppTheme }) {
  return <View style={s.sectionHeading}>
    <Text style={[s.sectionNumber, { color: theme.primaryText }]}>{number}</Text>
    <Text style={[s.sectionTitle, { color: theme.text }]}>{title}</Text>
    <View style={[s.rule, { backgroundColor: theme.border3 }]} />
  </View>;
}

function DestinationRow({ item, theme, last = false, onPress }: {
  item: Destination; theme: AppTheme; last?: boolean; onPress: () => void;
}) {
  return <TouchableOpacity accessibilityRole="button" accessibilityLabel={item.title} onPress={onPress} activeOpacity={0.75}
    style={[s.destination, { borderBottomColor: theme.border2, borderBottomWidth: last ? 0 : 1 }]}>
    <View style={[s.rowIcon, { backgroundColor: theme.surface2 }]}>
      <MaterialCommunityIcons name={item.icon} size={23} color={theme.textSecondary} />
    </View>
    <View style={s.rowCopy}>
      <Text style={[s.rowTitle, { color: theme.text }]}>{item.title}</Text>
      <Text style={[s.rowDescription, { color: theme.textMuted }]}>{item.description}</Text>
    </View>
    <Feather name="chevron-right" size={18} color={theme.textDim} />
  </TouchableOpacity>;
}

export default function Community() {
  const router = useRouter();
  const { theme: t, isDark } = useTheme();
  const { animations } = useAppAnimations(['community_daily_duel_vs']);
  const duelVsAnimation = pickAppAnimationForValue(animations, 'community_daily_duel_vs');
  const insets = useSafeAreaInsets();
  const bottomPad = useTabScrollBottomPadding(20);
  const { textScale } = useReadability();
  const { width, fontScale } = useWindowDimensions();
  const stack = width < 360 || textScale * fontScale > 1.2;
  const { duel, loading: duelLoading } = useDailyDuel(30000, { includeHistory: false, includeSubmission: false });
  const go = (route: string) => router.push(route as never);
  const panel = { backgroundColor: t.surface, borderColor: t.border3 };

  return <View style={[s.root, { backgroundColor: t.bg }]}>
    <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor="transparent" translucent />
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{
      paddingTop: insets.top + 16, paddingBottom: bottomPad,
      paddingLeft: Math.max(20, insets.left), paddingRight: Math.max(20, insets.right),
    }}>
      <View style={s.duelHeading}>
        <MaterialCommunityIcons name="sword-cross" size={16} color={t.primaryText} />
        <Text style={[s.eyebrow, { color: t.textMuted }]}>BITWA DNIA</Text>
      </View>
      <View style={{ marginHorizontal: -16 }}>
        <DailyDuelHero duel={duel} loading={duelLoading} compact contained vsAnimation={duelVsAnimation} onPressVote={() => go('/Community/duel/vote')} />
      </View>

      <View style={s.masthead}>
        <View style={s.brand}>
          <MaterialCommunityIcons name="car-sports" size={20} color={t.primary} />
          <Text style={[s.wordmark, { color: t.text }]}>VROOM <Text style={{ color: t.textDim }}> / SPOŁECZNOŚĆ</Text></Text>
        </View>
        <View accessible={false} importantForAccessibility="no-hide-descendants" style={s.stripes}>
          {[0, 1, 2].map(i => <View key={i} style={[s.stripe, { backgroundColor: withAlpha(t.primary, i === 2 ? 'ff' : '40') }]} />)}
        </View>
      </View>

      <View style={s.intro}>
        <Text style={[s.headline, { color: t.text, fontSize: width < 360 ? 32 : 38 }]}>DOBRZE BYĆ</Text>
        <Text style={[s.headline, { color: t.primaryText, fontSize: width < 360 ? 32 : 38 }]}>W SWOJEJ EKIPIE.</Text>
        <Text style={[s.introText, { color: t.textMuted }]}>Te same pasje. Nowe znajomości. Twoje miejsce między trasami.</Text>
      </View>

      <TouchableOpacity testID="community-open-forum" accessibilityRole="button" accessibilityLabel="Otwórz dyskusje społeczności"
        onPress={() => go('/Community/community/community')} activeOpacity={0.88}
        style={[s.feature, { borderColor: t.primaryBorder }]}>
        <LinearGradient colors={isDark ? ['#251315', '#151214'] : [withAlpha(t.primary, '12'), t.surface]}
          start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFillObject} />
        <View pointerEvents="none" style={[s.featureStripe, { backgroundColor: withAlpha(t.primary, '0c') }]} />
        <View style={s.featureTop}>
          <Text style={[s.eyebrow, { color: t.primaryText }]}>DYSKUSJE SPOŁECZNOŚCI</Text>
          <MaterialCommunityIcons name="forum-outline" size={24} color={t.primaryText} />
        </View>
        <Text style={[s.featureTitle, { color: t.text }]}>Co dziś na tapecie?</Text>
        <Text style={[s.featureDescription, { color: t.textMuted }]}>Pokaż auto, zapytaj o radę albo podziel się trasą wartą przejechania.</Text>
        <View style={[s.featureFooter, { borderTopColor: t.primaryBorder }]}>
          <Text style={[s.featureLink, { color: t.text }]}>WEJDŹ DO DYSKUSJI</Text>
          <View style={[s.featureArrow, { backgroundColor: t.primary }]}><Feather name="arrow-up-right" size={21} color={t.onPrimary} /></View>
        </View>
      </TouchableOpacity>

      <Section number="01" title="Bądź w kontakcie" theme={t} />
      <View style={[s.group, panel]}>
        {chats.map((item, i) => <DestinationRow key={item.route} item={item} theme={t} last={i === chats.length - 1} onPress={() => go(item.route)} />)}
      </View>

      <Section number="02" title="Z życia motoryzacji" theme={t} />
      <View style={[s.grid, stack && s.stack]}>
        {discover.map((item, i) => <TouchableOpacity key={item.route} accessibilityRole="button" accessibilityLabel={item.title}
          onPress={() => go(item.route)} activeOpacity={0.8} style={[s.discoverCard, panel]}>
          <View style={s.cardTop}>
            <MaterialCommunityIcons name={item.icon} size={28} color={i === 0 ? t.primaryText : t.textSecondary} />
            <Feather name="arrow-up-right" size={17} color={t.textDim} />
          </View>
          <Text style={[s.cardTitle, { color: t.text }]}>{item.title}</Text>
          <Text style={[s.cardDescription, { color: t.textMuted }]}>{item.description}</Text>
          <View accessible={false} importantForAccessibility="no-hide-descendants" style={[s.cardAccent, { backgroundColor: i === 0 ? t.primary : t.border3 }]} />
        </TouchableOpacity>)}
      </View>

      <Section number="03" title="Spotkaj się. Rywalizuj." theme={t} />
      <View style={[s.group, panel]}>
        <DestinationRow item={{ title: 'Wydarzenia', description: 'Meety i zloty. Zobacz, gdzie się spotykamy.', icon: 'calendar-star', route: '/Community/meets/events' }} theme={t} onPress={() => go('/Community/meets/events')} />
        <DestinationRow item={{ title: 'Rankingi', description: 'Punkty, kilometry i miejsce na podium.', icon: 'podium-gold', route: '/Community/Ranks/stats' }} theme={t} last onPress={() => go('/Community/Ranks/stats')} />
      </View>

      <Section number="04" title="Z garażu do garażu" theme={t} />
      <View style={[s.group, panel]}>
        <DestinationRow item={{ title: 'Giełda VROOM', description: 'Auta, motocykle i części od społeczności.', icon: 'tag-multiple-outline', route: '/Community/market/market' }} theme={t} last onPress={() => go('/Community/market/market')} />
      </View>
      <View style={[s.footer, { borderTopColor: t.border2 }]}>
        <MaterialCommunityIcons name="steering" size={16} color={t.textDim} />
        <Text style={[s.footerText, { color: t.textDim }]}>ŁĄCZY NAS DROGA.</Text>
      </View>
    </ScrollView>
  </View>;
}

const s = StyleSheet.create({
  root: { flex: 1 },
  masthead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  brand: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  wordmark: { flexShrink: 1, fontSize: 12, fontWeight: '900', letterSpacing: 0.8 },
  stripes: { flexDirection: 'row', gap: 4 },
  stripe: { width: 5, height: 18, transform: [{ skewX: '-18deg' }] },
  intro: { paddingTop: 30, paddingBottom: 24 },
  headline: { fontWeight: '900', letterSpacing: -1.3, lineHeight: 44 },
  introText: { maxWidth: 380, fontSize: 14, lineHeight: 21, marginTop: 12 },
  feature: { padding: 20, borderRadius: 18, borderWidth: 1, overflow: 'hidden' },
  featureStripe: { position: 'absolute', width: 75, height: 320, top: -40, right: 24, transform: [{ rotate: '30deg' }] },
  featureTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  eyebrow: { flexShrink: 1, fontSize: 10, fontWeight: '800', letterSpacing: 1.1 },
  featureTitle: { fontSize: 24, fontWeight: '800', letterSpacing: -0.6, marginTop: 22 },
  featureDescription: { fontSize: 14, lineHeight: 21, marginTop: 8, maxWidth: 420 },
  featureFooter: { marginTop: 20, paddingTop: 14, borderTopWidth: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  featureLink: { flex: 1, fontSize: 12, fontWeight: '800', letterSpacing: 0.6 },
  featureArrow: { width: 36, height: 36, borderRadius: 10, justifyContent: 'center', alignItems: 'center' },
  sectionHeading: { marginTop: 28, marginBottom: 12, flexDirection: 'row', alignItems: 'center', gap: 10 },
  sectionNumber: { fontSize: 11, fontWeight: '800' },
  sectionTitle: { fontSize: 17, fontWeight: '800', flexShrink: 1, letterSpacing: -0.3 },
  rule: { flex: 1, minWidth: 12, height: 1 },
  group: { borderRadius: 16, borderWidth: 1, paddingHorizontal: 14 },
  destination: { minHeight: 86, paddingVertical: 17, flexDirection: 'row', alignItems: 'center', gap: 12 },
  rowIcon: { width: 42, height: 42, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  rowCopy: { flex: 1, minWidth: 0 },
  rowTitle: { fontSize: 16, fontWeight: '800' },
  rowDescription: { fontSize: 12, lineHeight: 18, marginTop: 4 },
  grid: { flexDirection: 'row', gap: 12 },
  stack: { flexDirection: 'column' },
  discoverCard: { flex: 1, minWidth: 0, borderRadius: 16, borderWidth: 1, padding: 17 },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 23 },
  cardTitle: { fontSize: 18, fontWeight: '800', letterSpacing: -0.3 },
  cardDescription: { fontSize: 12, lineHeight: 18, marginTop: 7 },
  cardAccent: { width: 24, height: 3, borderRadius: 2, marginTop: 20 },
  duelHeading: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  footer: { borderTopWidth: 1, marginTop: 28, paddingTop: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  footerText: { fontSize: 10, fontWeight: '700', letterSpacing: 1.4 },
});
