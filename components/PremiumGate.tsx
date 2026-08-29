import React, { ReactNode, useMemo } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
} from 'react-native';
import { LinearGradient }  from 'expo-linear-gradient';
import MaterialIcons       from '@expo/vector-icons/MaterialIcons';
import { useRouter }       from 'expo-router';
import { useTheme } from '../contexts/ThemeContext';
import type { AppTheme } from '../constants/theme';
import { track } from '../lib/analytics/client';

const GOLD = '#FFD700';

interface Props {
  feature:     string;
  description: string;
  children?:   ReactNode;
  locked:      boolean;
}

export default function PremiumGate({ feature, description, children, locked }: Props) {
  const router = useRouter();
  const { theme, isDark } = useTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);

  React.useEffect(() => { if (locked) track({ eventName: 'premium_paywall_shown', entityType: 'premium_feature', entityId: feature, surface: 'premium_gate', properties: { reason: feature } }); }, [feature, locked]);
  if (!locked) return <>{children}</>;

  return (
    <View style={s.card}>
      <LinearGradient
        colors={isDark ? ['#1a0808', '#100404', theme.bg] : [theme.surface2, theme.surface, theme.bgAlt]}
        style={StyleSheet.absoluteFill}
      />
      <View style={s.cardDeco} />

      <View style={s.iconWrap}>
        <LinearGradient
          colors={isDark ? ['#2a2000', '#1a1500', theme.bg] : [theme.gold + '25', theme.surface2, theme.surface]}
          style={s.iconBox}
        >
          <MaterialIcons name="workspace-premium" size={32} color={GOLD} />
        </LinearGradient>
      </View>

      <Text style={s.feature}>{feature}</Text>
      <Text style={s.description}>{description}</Text>

      <TouchableOpacity
        style={s.btn}
        onPress={() => router.push('/premium' as any)}
        activeOpacity={0.85}
      >
        <LinearGradient
          colors={[theme.primary, '#c02020']}
          start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
          style={StyleSheet.absoluteFill}
        />
        <MaterialIcons name="lock-open" size={14} color={theme.onPrimary} />
        <Text style={s.btnTxt}>ODBLOKUJ PREMIUM</Text>
      </TouchableOpacity>
    </View>
  );
}

function makeStyles(t: AppTheme) {
  return StyleSheet.create({
    card: {
      borderRadius: 20,
      borderWidth: 1, borderColor: t.primaryBorder,
      padding: 24,
      alignItems: 'center',
      overflow: 'hidden',
      marginVertical: 8,
    },
    cardDeco: {
      position: 'absolute', top: -40, right: -40,
      width: 140, height: 140, borderRadius: 70,
      backgroundColor: t.primaryBg,
    },
    iconWrap: { marginBottom: 14 },
    iconBox: {
      width: 64, height: 64, borderRadius: 18,
      alignItems: 'center', justifyContent: 'center',
      borderWidth: 1, borderColor: GOLD + '30',
      overflow: 'hidden',
    },
    feature: {
      fontFamily: 'OrbitronBold',
      fontSize: 14, color: t.text,
      letterSpacing: 2, marginBottom: 8, textAlign: 'center',
    },
    description: {
      fontFamily: 'Orbitron',
      fontSize: 10, color: t.textDim,
      textAlign: 'center', lineHeight: 16,
      marginBottom: 20,
    },
    btn: {
      flexDirection: 'row', alignItems: 'center', gap: 8,
      paddingHorizontal: 24, paddingVertical: 13,
      borderRadius: 14, overflow: 'hidden',
    },
    btnTxt: {
      fontFamily: 'Orbitron',
      fontSize: 11, color: t.onPrimary, fontWeight: '900',
      letterSpacing: 1,
    },
  });
}
