import React, { type ComponentProps, type ReactNode } from 'react';
import {
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../contexts/ThemeContext';
import { getThemeChrome, withAlpha, type AppTheme } from '../../constants/theme';
import { pickAppAnimationForValue } from '../../constants/appAnimations';
import { useAppAnimations } from '../../hooks/useAppAnimations';
import { useDailyDuel } from '../../hooks/useDailyDuel';
import { DailyDuelHero } from '../../components/community';
import { useTabScrollBottomPadding } from '../../lib/screenHeaderInsets';

type MciName = ComponentProps<typeof MaterialCommunityIcons>['name'];

function SectionHeading({
  icon,
  title,
  subtitle,
  theme,
}: {
  icon: MciName;
  title: string;
  subtitle?: string;
  theme: AppTheme;
}) {
  return (
    <View style={styles.sectionHeading}>
      <View style={[styles.sectionIcon, { backgroundColor: theme.primaryBg }]}>
        <MaterialCommunityIcons name={icon} size={15} color={theme.primary} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.sectionTitle, { color: theme.text }]}>{title}</Text>
        {!!subtitle && <Text style={[styles.sectionSubtitle, { color: theme.textDim }]}>{subtitle}</Text>}
      </View>
      <View style={[styles.sectionLine, { backgroundColor: theme.primaryBorder }]} />
    </View>
  );
}

function Arrow({ theme }: { theme: AppTheme }) {
  return (
    <View style={[styles.arrowCircle, { backgroundColor: theme.primaryBg }]}>
      <Feather name="arrow-up-right" size={16} color={theme.primary} />
    </View>
  );
}

function MiniCard({
  title,
  description,
  icon,
  tag,
  onPress,
  theme,
  isDark,
}: {
  title: string;
  description: string;
  icon: MciName;
  tag?: string;
  onPress: () => void;
  theme: AppTheme;
  isDark: boolean;
}) {
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={title}
      onPress={onPress}
      activeOpacity={0.86}
      style={[styles.miniCard, { borderColor: theme.border2, backgroundColor: theme.surface }]}
    >
      <LinearGradient
        colors={isDark
          ? [withAlpha(theme.primary, '1a'), 'transparent']
          : [withAlpha(theme.primary, '14'), 'transparent']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFillObject}
      />
      <View style={styles.miniTop}>
        <View style={[styles.miniIcon, { backgroundColor: theme.primaryBg, borderColor: theme.primaryBorder }]}>
          <MaterialCommunityIcons name={icon} size={22} color={theme.primary} />
        </View>
        {!!tag && (
          <View style={[styles.tag, { backgroundColor: theme.primary }]}>
            <Text style={styles.tagText}>{tag}</Text>
          </View>
        )}
      </View>
      <Text style={[styles.miniTitle, { color: theme.text }]}>{title}</Text>
      <Text numberOfLines={2} style={[styles.miniDescription, { color: theme.textDim }]}>{description}</Text>
      <Feather name="arrow-up-right" size={16} color={theme.primary} style={styles.miniArrow} />
    </TouchableOpacity>
  );
}

function WideCard({
  title,
  description,
  icon,
  eyebrow,
  onPress,
  theme,
  isDark,
  children,
}: {
  title: string;
  description: string;
  icon: MciName;
  eyebrow?: string;
  onPress: () => void;
  theme: AppTheme;
  isDark: boolean;
  children?: ReactNode;
}) {
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={title}
      onPress={onPress}
      activeOpacity={0.88}
      style={[styles.wideCard, { borderColor: theme.primaryBorder, backgroundColor: theme.surface }]}
    >
      <LinearGradient
        colors={isDark
          ? [withAlpha(theme.primary, '20'), withAlpha(theme.surface, 'e8'), theme.surface]
          : [withAlpha(theme.primary, '14'), theme.surface, theme.surface]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFillObject}
      />
      <View style={[styles.wideIcon, { backgroundColor: theme.primary, shadowColor: theme.primary }]}>
        <MaterialCommunityIcons name={icon} size={27} color="#fff" />
      </View>
      <View style={styles.wideCopy}>
        {!!eyebrow && <Text style={[styles.wideEyebrow, { color: theme.primary }]}>{eyebrow}</Text>}
        <Text style={[styles.wideTitle, { color: theme.text }]}>{title}</Text>
        <Text style={[styles.wideDescription, { color: theme.textMuted }]}>{description}</Text>
        {children}
      </View>
      <Arrow theme={theme} />
    </TouchableOpacity>
  );
}

function ChatShortcut({
  title,
  subtitle,
  icon,
  live,
  onPress,
  theme,
}: {
  title: string;
  subtitle: string;
  icon: MciName;
  live?: boolean;
  onPress: () => void;
  theme: AppTheme;
}) {
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={title}
      activeOpacity={0.82}
      onPress={onPress}
      style={[styles.chatShortcut, { backgroundColor: theme.surface2, borderColor: theme.border2 }]}
    >
      <View style={[styles.chatShortcutIcon, { backgroundColor: theme.primaryBg }]}>
        <MaterialCommunityIcons name={icon} size={18} color={theme.primary} />
      </View>
      <View style={{ flex: 1 }}>
        <View style={styles.chatShortcutTitleRow}>
          <Text style={[styles.chatShortcutTitle, { color: theme.text }]}>{title}</Text>
          {live && <View style={[styles.liveDot, { backgroundColor: theme.online }]} />}
        </View>
        <Text numberOfLines={1} style={[styles.chatShortcutSubtitle, { color: theme.textDim }]}>{subtitle}</Text>
      </View>
      <Feather name="chevron-right" size={16} color={theme.textDim} />
    </TouchableOpacity>
  );
}

export default function Community() {
  const router = useRouter();
  const { theme, isDark } = useTheme();
  const chrome = getThemeChrome(theme, isDark);
  const { animations } = useAppAnimations(['community_daily_duel_vs']);
  const duelVsAnimation = pickAppAnimationForValue(animations, 'community_daily_duel_vs');
  const insets = useSafeAreaInsets();
  const tabScrollBottomPad = useTabScrollBottomPadding(20);
  const { duel, loading: duelLoading } = useDailyDuel(30000);
  const go = (route: string) => router.push(route as any);

  return (
    <View style={styles.root}>
      <LinearGradient colors={chrome.pageGradient} style={StyleSheet.absoluteFillObject} />
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor="transparent" translucent />

      <ScrollView
        contentContainerStyle={{ paddingBottom: tabScrollBottomPad }}
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.hero, { paddingTop: insets.top + 15, borderBottomColor: theme.border2 }]}>
          <LinearGradient
            colors={isDark
              ? [withAlpha(theme.primary, '20'), 'transparent']
              : [withAlpha(theme.primary, '14'), 'transparent']}
            start={{ x: 1, y: 0 }}
            end={{ x: 0.2, y: 1 }}
            style={StyleSheet.absoluteFillObject}
          />
          <View style={[styles.heroOrbLarge, { borderColor: withAlpha(theme.primary, '24') }]} />
          <View style={[styles.heroOrbSmall, { borderColor: withAlpha(theme.primary, '30') }]} />
          <View style={styles.heroTopRow}>
            <View style={[styles.heroBadge, { backgroundColor: theme.primaryBg, borderColor: theme.primaryBorder }]}>
              <MaterialCommunityIcons name="account-group" size={15} color={theme.primary} />
              <Text style={[styles.heroBadgeText, { color: theme.primary }]}>VROOM SOCIAL</Text>
            </View>
            <View style={styles.onlinePill}>
              <View style={[styles.onlineDot, { backgroundColor: theme.online }]} />
              <Text style={[styles.onlineText, { color: theme.textMuted }]}>RAZEM W DRODZE</Text>
            </View>
          </View>
          <Text style={[styles.heroTitle, { color: theme.text }]}>SPOŁECZNOŚĆ</Text>
          <Text style={[styles.heroSubtitle, { color: theme.textMuted }]}>Rozmawiaj, publikuj i spotykaj ludzi, którzy żyją motoryzacją.</Text>
        </View>

        <SectionHeading icon="sword-cross" title="DZISIAJ" subtitle="Oddaj głos w pojedynku dnia" theme={theme} />
        <DailyDuelHero
          duel={duel}
          loading={duelLoading}
          compact
          contained
          vsAnimation={duelVsAnimation}
          onPressVote={() => go('/Community/duel/vote')}
        />

        <SectionHeading icon="message-processing-outline" title="ROZMOWY" subtitle="Wszystkie czaty w jednym miejscu" theme={theme} />
        <View style={[styles.chatHub, { backgroundColor: theme.surface, borderColor: theme.primaryBorder }]}>
          <LinearGradient
            colors={isDark
              ? [withAlpha(theme.primary, '22'), 'transparent', withAlpha(theme.primary, '0a')]
              : [withAlpha(theme.primary, '16'), 'transparent', withAlpha(theme.primary, '08')]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFillObject}
          />
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Otwórz prywatne wiadomości"
            activeOpacity={0.84}
            onPress={() => go('/Community/chats/chats')}
            style={styles.chatPrimary}
          >
            <View style={[styles.chatPrimaryIcon, { backgroundColor: theme.primary, shadowColor: theme.primary }]}>
              <MaterialCommunityIcons name="message-text" size={27} color="#fff" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.chatEyebrow, { color: theme.primary }]}>TWOJE ROZMOWY</Text>
              <Text style={[styles.chatTitle, { color: theme.text }]}>Wiadomości</Text>
              <Text style={[styles.chatDescription, { color: theme.textMuted }]}>Znajomi, prywatne rozmowy i grupy.</Text>
            </View>
            <Arrow theme={theme} />
          </TouchableOpacity>
          <View style={[styles.chatDivider, { backgroundColor: theme.border2 }]} />
          <View style={styles.chatShortcutRow}>
            <ChatShortcut
              title="Czat ogólny"
              subtitle="Rozmowa na żywo"
              icon="earth"
              live
              theme={theme}
              onPress={() => go('/Community/public/public')}
            />
            <ChatShortcut
              title="Kluby"
              subtitle="Czaty klubowe"
              icon="shield-crown-outline"
              theme={theme}
              onPress={() => go('/Community/clubs/clubs')}
            />
          </View>
        </View>

        <SectionHeading icon="creation-outline" title="PUBLIKUJ I ODKRYWAJ" subtitle="Treści tworzone przez kierowców" theme={theme} />
        <View style={styles.contentBlock}>
          <WideCard
            title="Dyskusje"
            eyebrow="FORUM SPOŁECZNOŚCI"
            description="Posty, auta, trasy, pytania i ankiety w jednym feedzie."
            icon="forum-outline"
            theme={theme}
            isDark={isDark}
            onPress={() => go('/Community/community/community')}
          />
          <View style={styles.twoColumns}>
            <MiniCard
              title="VROOMKI"
              description="Krótkie filmy kierowców."
              icon="play-box-multiple-outline"
              tag="REELS"
              theme={theme}
              isDark={isDark}
              onPress={() => go('/Community/vroomki')}
            />
            <MiniCard
              title="NEWSY"
              description="Motoryzacja i VROOM Radar."
              icon="newspaper-variant-outline"
              tag="CZYTAJ"
              theme={theme}
              isDark={isDark}
              onPress={() => go('/Community/news')}
            />
          </View>
        </View>

        <SectionHeading icon="map-marker-radius-outline" title="SPOTKAJ SIĘ I RYWALIZUJ" subtitle="Wydarzenia, punkty i rankingi" theme={theme} />
        <View style={[styles.twoColumns, styles.sectionContent]}>
          <MiniCard
            title="WYDARZENIA"
            description="Meety i zloty w okolicy."
            icon="calendar-star"
            tag="MEETY"
            theme={theme}
            isDark={isDark}
            onPress={() => go('/Community/meets/events')}
          />
          <MiniCard
            title="RANKINGI"
            description="Punkty, dystans i podium."
            icon="podium-gold"
            theme={theme}
            isDark={isDark}
            onPress={() => go('/Community/Ranks/stats')}
          />
        </View>

        <SectionHeading icon="shopping-outline" title="GARAŻ I HANDEL" subtitle="Kupuj i sprzedawaj bez wychodzenia z VROOM" theme={theme} />
        <View style={[styles.sectionContent, { marginBottom: 12 }]}>
          <WideCard
            title="Giełda VROOM"
            eyebrow="AUTA · MOTO · CZĘŚCI"
            description="Ogłoszenia społeczności i bezpieczne rozmowy ze sprzedającymi."
            icon="tag-multiple-outline"
            theme={theme}
            isDark={isDark}
            onPress={() => go('/Community/market/market')}
          />
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  hero: { minHeight: 198, paddingHorizontal: 20, paddingBottom: 24, justifyContent: 'flex-end', borderBottomWidth: 1, overflow: 'hidden' },
  heroOrbLarge: { position: 'absolute', width: 260, height: 260, borderRadius: 130, borderWidth: 1, right: -78, top: -108 },
  heroOrbSmall: { position: 'absolute', width: 150, height: 150, borderRadius: 75, borderWidth: 1, right: -18, top: -45 },
  heroTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 },
  heroBadge: { minHeight: 32, borderRadius: 16, borderWidth: 1, paddingHorizontal: 11, flexDirection: 'row', alignItems: 'center', gap: 6 },
  heroBadgeText: { fontFamily: 'Orbitron', fontSize: 7, fontWeight: '900', letterSpacing: 1.2 },
  onlinePill: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  onlineDot: { width: 7, height: 7, borderRadius: 4 },
  onlineText: { fontFamily: 'Orbitron', fontSize: 6.5, fontWeight: '800', letterSpacing: 0.9 },
  heroTitle: { fontFamily: 'Orbitron', fontSize: 27, fontWeight: '900', letterSpacing: 2.3 },
  heroSubtitle: { maxWidth: 330, fontSize: 12, lineHeight: 18, marginTop: 8 },
  sectionHeading: { paddingHorizontal: 18, marginTop: 24, marginBottom: 12, flexDirection: 'row', alignItems: 'center', gap: 9 },
  sectionIcon: { width: 28, height: 28, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  sectionTitle: { fontFamily: 'Orbitron', fontSize: 10, fontWeight: '900', letterSpacing: 1.5 },
  sectionSubtitle: { fontSize: 8.5, marginTop: 3 },
  sectionLine: { width: 36, height: 1 },
  arrowCircle: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  chatHub: { marginHorizontal: 16, borderRadius: 26, borderWidth: 1, overflow: 'hidden', padding: 14, marginBottom: 4 },
  chatPrimary: { minHeight: 104, flexDirection: 'row', alignItems: 'center', gap: 13, paddingHorizontal: 3, paddingVertical: 6 },
  chatPrimaryIcon: { width: 54, height: 54, borderRadius: 18, alignItems: 'center', justifyContent: 'center', shadowOpacity: 0.28, shadowRadius: 12, elevation: 6 },
  chatEyebrow: { fontFamily: 'Orbitron', fontSize: 6.5, fontWeight: '900', letterSpacing: 1.2, marginBottom: 4 },
  chatTitle: { fontSize: 20, fontWeight: '900' },
  chatDescription: { fontSize: 10, marginTop: 4 },
  chatDivider: { height: 1, marginVertical: 10 },
  chatShortcutRow: { gap: 9 },
  chatShortcut: { minHeight: 62, borderRadius: 17, borderWidth: 1, paddingHorizontal: 11, flexDirection: 'row', alignItems: 'center', gap: 10 },
  chatShortcutIcon: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  chatShortcutTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  chatShortcutTitle: { fontSize: 11, fontWeight: '900' },
  chatShortcutSubtitle: { fontSize: 8.5, marginTop: 2 },
  liveDot: { width: 6, height: 6, borderRadius: 3 },
  contentBlock: { paddingHorizontal: 16, gap: 10 },
  sectionContent: { paddingHorizontal: 16 },
  twoColumns: { flexDirection: 'row', gap: 10 },
  wideCard: { minHeight: 132, borderRadius: 23, borderWidth: 1, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 13, overflow: 'hidden' },
  wideIcon: { width: 50, height: 50, borderRadius: 17, alignItems: 'center', justifyContent: 'center', shadowOpacity: 0.25, shadowRadius: 10, elevation: 5 },
  wideCopy: { flex: 1 },
  wideEyebrow: { fontFamily: 'Orbitron', fontSize: 6, fontWeight: '900', letterSpacing: 1.1, marginBottom: 4 },
  wideTitle: { fontFamily: 'Orbitron', fontSize: 14, fontWeight: '900', letterSpacing: 0.5 },
  wideDescription: { fontSize: 9.5, lineHeight: 14, marginTop: 5 },
  miniCard: { flex: 1, minWidth: 0, height: 154, borderRadius: 22, borderWidth: 1, padding: 14, overflow: 'hidden' },
  miniTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 11 },
  miniIcon: { width: 42, height: 42, borderRadius: 14, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  tag: { minHeight: 20, borderRadius: 10, paddingHorizontal: 7, alignItems: 'center', justifyContent: 'center' },
  tagText: { color: '#fff', fontFamily: 'Orbitron', fontSize: 5.5, fontWeight: '900', letterSpacing: 0.6 },
  miniTitle: { fontFamily: 'Orbitron', fontSize: 10, fontWeight: '900', letterSpacing: 0.7 },
  miniDescription: { fontSize: 8.5, lineHeight: 12, marginTop: 5, paddingRight: 12 },
  miniArrow: { position: 'absolute', right: 13, bottom: 13 },
});
