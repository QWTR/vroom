import React from 'react';
import { Image, ScrollView, StyleSheet, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import Svg, { Circle, Defs, G, LinearGradient as SvgGradient, Path, Stop } from 'react-native-svg';
import { AppText as Text } from '../ui/AppText';

const BG = '#090b0d';
const RED = '#ff514a';

/** Lightweight vector artwork: a route that connects the garage and the community. */
function RouteArtwork() {
  return <View style={s.artwork} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
    <Svg width="100%" height="100%" viewBox="0 0 360 250">
      <Defs>
        <SvgGradient id="route" x1="0" y1="1" x2="1" y2="0"><Stop offset="0" stopColor="#74231f" /><Stop offset="0.5" stopColor={RED} /><Stop offset="1" stopColor="#ffa58e" /></SvgGradient>
      </Defs>
      <G fill="none" stroke="#24272c" strokeWidth="1">
        {[0, 1, 2, 3, 4, 5, 6].map((i) => <Path key={i} d={`M ${-70 + i * 24} 270 C ${-50 + i * 24} 148 ${150 + i * 19} 206 ${160 + i * 24} 88 S ${310 + i * 21} 2 400 -30`} />)}
        <Path d="M-10 96 370 192 M0 42 370 140 M48 0 354 250 M-40 180 290 250" stroke="#1b1f24" />
      </G>
      <Path d="M60 198 C60 150 98 154 171 157 S279 154 279 122 210 107 202 74 230 42 276 43" fill="none" stroke={RED} strokeWidth="24" opacity="0.05" />
      <Path d="M60 198 C60 150 98 154 171 157 S279 154 279 122 210 107 202 74 230 42 276 43" fill="none" stroke="url(#route)" strokeWidth="4" strokeLinecap="round" />
      <Circle cx="60" cy="198" r="10" fill={BG} stroke={RED} strokeWidth="2" />
      <Circle cx="60" cy="198" r="3" fill={RED} />
      <Circle cx="276" cy="43" r="18" fill={RED} opacity="0.09" />
      <Circle cx="276" cy="43" r="7" fill="#ffd2c4" />
      <G transform="translate(166 155) rotate(4)">
        <Path d="M0 -22 C8 -22 11 -15 11 -7 L11 14 Q11 21 0 21 Q-11 21 -11 14 L-11 -7 Q-11 -22 0 -22Z" fill="#e9e5df" stroke="#090b0d" strokeWidth="2" />
        <Path d="M-7 -10 Q0 -14 7 -10 L6 -3 -6 -3Z M-6 10 6 10 7 15 -7 15Z" fill="#23282f" />
        <Path d="M-8 18 -4 18 M4 18 8 18" stroke={RED} strokeWidth="2" />
      </G>
    </Svg>
    <View style={s.routeTopLabel}>
      <MaterialCommunityIcons name="flag-checkered" size={15} color={RED} />
      <Text contrastBackground={BG} style={s.artLabel}>WIDZIMY SIĘ NA TRASIE</Text>
    </View>
    <View style={s.garageTag}>
      <View style={s.tagIcon}><MaterialCommunityIcons name="garage-variant" size={19} color={RED} /></View>
      <View><Text contrastBackground="#16191e" style={s.tagTitle}>Twój garaż</Text><Text contrastBackground="#16191e" style={s.tagSub}>Każde auto ma historię.</Text></View>
    </View>
    <View style={s.crewTag}>
      <MaterialCommunityIcons name="account-group-outline" size={17} color="#eeeae4" />
      <Text contrastBackground="#16191e" style={s.tagTitle}>Twoja ekipa</Text>
      <View style={s.crewDot} />
    </View>
  </View>;
}

export function WelcomeScreen({ onChoosePath }: { onChoosePath: (path: 'login' | 'register') => void }) {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const compact = height < 750;
  return <View style={s.root} testID="auth-welcome">
    <StatusBar style="light" backgroundColor={BG} />
    <LinearGradient colors={['#24110f', BG, BG]} start={{ x: 1, y: 0 }} end={{ x: 0.35, y: 0.65 }} style={StyleSheet.absoluteFill} />
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={[s.scroll, { paddingTop: insets.top + 18, paddingBottom: Math.max(insets.bottom, 18) }]}>
      <View style={s.content}>
        <View style={s.header}>
          <View style={s.brand}>
            <Image source={require('../../assets/images/Frame1933.png')} style={s.logo} resizeMode="contain" />
            <Text contrastBackground={BG} style={s.wordmark}>VROOM</Text>
          </View>
          <View style={s.headerRule} />
          <MaterialCommunityIcons name="flag-checkered" size={22} color="#696b71" />
        </View>

        <View style={[s.hero, compact && { paddingTop: 28 }]}>
          <View style={s.eyebrowRow}><View style={s.eyebrowLine} /><Text contrastBackground={BG} style={s.eyebrow}>ŁĄCZY NAS MOTORYZACJA</Text></View>
          <Text accessibilityRole="header" contrastBackground={BG} style={[s.title, { fontSize: width < 360 ? 37 : 43 }]}>Twoja pasja.</Text>
          <Text contrastBackground={BG} style={[s.title, s.titleRed, { fontSize: width < 360 ? 37 : 43 }]}>Twoi ludzie.</Text>
          <Text contrastBackground={BG} style={s.subtitle}>Pokaż swoje auto. Znajdź ekipę.{"\n"}Niech każda trasa będzie początkiem historii.</Text>
        </View>

        <View style={[s.artWrap, compact && { marginVertical: 6 }]}><RouteArtwork /></View>

        <View style={s.features}>
          {([
            ['routes', 'Trasy'], ['car-sports', 'Garaż'], ['account-group-outline', 'Społeczność'],
          ] as const).map(([icon, label], index) => <View key={label} style={[s.feature, index > 0 && s.featureBorder]}>
            <MaterialCommunityIcons name={icon} size={21} color={RED} />
            <Text contrastBackground={BG} style={s.featureLabel}>{label}</Text>
          </View>)}
        </View>

        <View style={s.actions}>
          <TouchableOpacity testID="auth-create-account" accessibilityRole="button" activeOpacity={0.85} onPress={() => onChoosePath('register')} style={s.primary}>
            <View style={s.primaryTextWrap}>
              <Text contrastBackground="#c82c28" style={s.primaryText}>Dołącz do VROOM</Text>
              <Text contrastBackground="#c82c28" style={s.primarySub}>Stwórz konto i ruszaj z nami</Text>
            </View>
            <View style={s.arrowBox}><MaterialIcons name="arrow-forward" size={24} color="#fff" /></View>
          </TouchableOpacity>
          <TouchableOpacity testID="auth-sign-in" accessibilityRole="button" activeOpacity={0.75} onPress={() => onChoosePath('login')} style={s.secondary}>
            <Text contrastBackground={BG} style={s.secondaryHint}>Masz już konto?</Text>
            <Text contrastBackground={BG} style={s.secondaryText}>Zaloguj się</Text>
            <MaterialIcons name="arrow-forward" size={17} color="#eeeae4" />
          </TouchableOpacity>
        </View>
        <View style={s.footer}><View style={s.footerLine} /><Text contrastBackground={BG} style={s.footerText}>PASJA ZACZYNA SIĘ OD CIEBIE</Text><View style={s.footerLine} /></View>
      </View>
    </ScrollView>
  </View>;
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },
  scroll: { flexGrow: 1, paddingHorizontal: 24 },
  content: { width: '100%', maxWidth: 480, alignSelf: 'center', flexGrow: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 20 },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  logo: { width: 35, height: 35, borderRadius: 9 },
  wordmark: { fontSize: 23, fontWeight: '800', color: '#f2eee8', letterSpacing: 1 },
  headerRule: { flex: 1, height: 1, backgroundColor: '#ffffff16' },
  hero: { paddingTop: 40 },
  eyebrowRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14 },
  eyebrowLine: { width: 18, height: 2, backgroundColor: RED },
  eyebrow: { color: '#b8aaa5', fontSize: 11, fontWeight: '700', letterSpacing: 1, flexShrink: 1 },
  title: { color: '#f2eee8', fontWeight: '800', lineHeight: 50, letterSpacing: -1 },
  titleRed: { color: RED },
  subtitle: { color: '#a4a4ac', fontSize: 14, lineHeight: 22, marginTop: 14 },
  artWrap: { marginVertical: 14, flexGrow: 1, justifyContent: 'center' },
  artwork: { height: 232, width: '100%', maxWidth: 420, alignSelf: 'center' },
  routeTopLabel: { position: 'absolute', top: 4, left: 0, flexDirection: 'row', alignItems: 'center', gap: 6 },
  artLabel: { color: '#8b8b94', fontSize: 10, fontWeight: '700' },
  garageTag: { position: 'absolute', left: 0, bottom: 0, padding: 10, flexDirection: 'row', alignItems: 'center', gap: 9, borderRadius: 14, backgroundColor: '#16191e', borderWidth: 1, borderColor: '#303037' },
  tagIcon: { width: 34, height: 34, borderRadius: 10, backgroundColor: '#ff514a12', alignItems: 'center', justifyContent: 'center' },
  tagTitle: { color: '#eeeae4', fontSize: 12, fontWeight: '700' },
  tagSub: { color: '#a5a4ac', fontSize: 10, marginTop: 2 },
  crewTag: { position: 'absolute', right: 0, top: 51, backgroundColor: '#16191e', borderWidth: 1, borderColor: '#303037', borderRadius: 24, paddingHorizontal: 12, paddingVertical: 9, flexDirection: 'row', alignItems: 'center', gap: 8 },
  crewDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: '#a3b797' },
  features: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 16, paddingVertical: 15, marginTop: 12, borderTopWidth: 1, borderBottomWidth: 1, borderColor: '#ffffff12' },
  feature: { flex: 1, minWidth: 100, alignItems: 'center', gap: 6, paddingHorizontal: 3 },
  featureBorder: { borderLeftWidth: 1, borderLeftColor: '#ffffff12' },
  featureLabel: { color: '#c4c1c3', fontSize: 11, textAlign: 'center' },
  actions: { marginTop: 24, gap: 10 },
  primary: { backgroundColor: '#c82c28', borderRadius: 18, padding: 17, flexDirection: 'row', alignItems: 'center', gap: 12, borderTopWidth: 1, borderTopColor: '#ff7363' },
  primaryTextWrap: { flex: 1 },
  primaryText: { color: '#fff', fontSize: 17, fontWeight: '800' },
  primarySub: { color: '#ffddd6', fontSize: 11, marginTop: 3 },
  arrowBox: { width: 40, height: 40, backgroundColor: '#ffffff12', borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  secondary: { minHeight: 54, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', gap: 7, padding: 10 },
  secondaryHint: { color: '#9999a2', fontSize: 13 },
  secondaryText: { color: '#eeeae4', fontSize: 13, fontWeight: '800' },
  footer: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12 },
  footerLine: { height: 1, flex: 1, backgroundColor: '#ffffff12' },
  footerText: { color: '#72747d', fontSize: 9, letterSpacing: 0.7, flexShrink: 1, textAlign: 'center' },
});
