import React, { useEffect, useRef } from 'react';
import { View, Modal, TouchableOpacity, StyleSheet, Animated, AccessibilityInfo } from 'react-native';
import { AppText as Text } from '../ui/AppText';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../contexts/ThemeContext';
import { APP_TUTORIAL_STEPS } from '../../constants/appTutorial';
import { useAppTutorial } from '../../contexts/AppTutorialContext';
import { StaticHudGrid } from '../motion/vroomHudPrimitives';

const RED = '#e33835';

export function AppTutorialOverlay() {
  const { theme, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const {
    tutorialOpen,
    stepIndex,
    goNext,
    goBack,
    skipTutorial,
    completeTutorial,
  } = useAppTutorial();

  const fade = useRef(new Animated.Value(0)).current;
  const slide = useRef(new Animated.Value(24)).current;

  const step = APP_TUTORIAL_STEPS[stepIndex];
  const isLast = stepIndex >= APP_TUTORIAL_STEPS.length - 1;
  const total = APP_TUTORIAL_STEPS.length;

  useEffect(() => {
    if (!tutorialOpen || !step) return;

    if (step.tabRoute) {
      router.replace(step.tabRoute as any);
    }

    fade.setValue(0);
    slide.setValue(24);
    AccessibilityInfo.isReduceMotionEnabled()
      .then(reduce => {
        if (reduce) {
          fade.setValue(1);
          slide.setValue(0);
          return;
        }
        Animated.parallel([
          Animated.timing(fade, { toValue: 1, duration: 320, useNativeDriver: true }),
          Animated.spring(slide, { toValue: 0, damping: 14, stiffness: 120, useNativeDriver: true }),
        ]).start();
      })
      .catch(() => {
        Animated.parallel([
          Animated.timing(fade, { toValue: 1, duration: 320, useNativeDriver: true }),
          Animated.spring(slide, { toValue: 0, damping: 14, stiffness: 120, useNativeDriver: true }),
        ]).start();
      });
  }, [tutorialOpen, stepIndex, step, fade, slide, router]);

  if (!tutorialOpen || !step) return null;

  const Icon = step.iconLib === 'material' ? (
    <MaterialCommunityIcons name={step.icon as any} size={36} color={RED} />
  ) : (
    <Feather name={step.icon as any} size={32} color={RED} />
  );

  return (
    <Modal visible animationType="fade" presentationStyle="fullScreen" statusBarTranslucent>
      <View style={[styles.root, { backgroundColor: isDark ? '#030303' : theme.bg }]}>
        <LinearGradient
          colors={isDark ? ['#1a0505', '#030303', '#0a0800'] : [theme.bg, theme.bgAlt, theme.bg]}
          style={StyleSheet.absoluteFill}
        />
        <StaticHudGrid isDark={isDark} primary={RED} opacity={0.7} />

        <View style={[styles.topBar, { paddingTop: insets.top + 12 }]}>
          <Text style={styles.progress}>
            {stepIndex + 1} / {total}
          </Text>
          <TouchableOpacity onPress={skipTutorial} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <Text style={styles.skip}>Pomiń przewodnik</Text>
          </TouchableOpacity>
        </View>

        <Animated.View
          style={[
            styles.card,
            {
              opacity: fade,
              transform: [{ translateY: slide }],
              backgroundColor: isDark ? '#0c0c0c' : theme.surface,
              borderColor: `${RED}44`,
            },
          ]}
        >
          <View style={[styles.iconWrap, { backgroundColor: `${RED}18`, borderColor: `${RED}55` }]}>
            {Icon}
          </View>
          <Text style={[styles.title, { color: theme.text }]}>{step.title}</Text>
          <Text style={[styles.body, { color: theme.textMuted }]}>{step.body}</Text>

          <View style={styles.dots}>
            {APP_TUTORIAL_STEPS.map((s, i) => (
              <View
                key={s.id}
                style={[
                  styles.dot,
                  { backgroundColor: i === stepIndex ? RED : `${RED}33` },
                  i === stepIndex && styles.dotActive,
                ]}
              />
            ))}
          </View>
        </Animated.View>

        <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 20) }]}>
          <TouchableOpacity
            onPress={goBack}
            disabled={stepIndex === 0}
            style={[styles.btnGhost, { opacity: stepIndex === 0 ? 0.35 : 1 }]}
          >
            <Text style={[styles.btnGhostText, { color: theme.textDim }]}>Wstecz</Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={isLast ? completeTutorial : goNext}
            style={styles.btnPrimary}
          >
            <LinearGradient
              colors={[RED, '#c42a28']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={StyleSheet.absoluteFill}
            />
            <Text style={styles.btnPrimaryText}>{isLast ? 'Zaczynamy!' : 'Dalej'}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    zIndex: 2,
  },
  progress: {
    fontFamily: 'Manrope_600SemiBold',
    fontSize: 12,
    color: '#ffffff88',
    letterSpacing: 1,
  },
  skip: {
    fontFamily: 'Manrope_600SemiBold',
    fontSize: 12,
    color: '#ffffff66',
    letterSpacing: 1,
  },
  card: {
    flex: 1,
    marginHorizontal: 20,
    marginTop: 24,
    marginBottom: 16,
    borderRadius: 20,
    borderWidth: 1,
    padding: 24,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 2,
  },
  iconWrap: {
    width: 72,
    height: 72,
    borderRadius: 22,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  title: {
    fontFamily: 'Manrope_600SemiBold',
    fontSize: 20,
    fontWeight: '900',
    letterSpacing: 1,
    textAlign: 'center',
    marginBottom: 14,
  },
  body: {
    fontSize: 14,
    lineHeight: 22,
    textAlign: 'center',
    maxWidth: 320,
  },
  dots: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 28,
    flexWrap: 'wrap',
    justifyContent: 'center',
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  dotActive: {
    width: 22,
  },
  footer: {
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 20,
    zIndex: 2,
  },
  btnGhost: {
    flex: 1,
    height: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnGhostText: {
    fontFamily: 'Manrope_600SemiBold',
    fontSize: 12,
    letterSpacing: 1,
  },
  btnPrimary: {
    flex: 2,
    height: 48,
    borderRadius: 14,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnPrimaryText: {
    fontFamily: 'Manrope_600SemiBold',
    fontSize: 12,
    fontWeight: '900',
    color: '#fff',
    letterSpacing: 1,
  },
});
