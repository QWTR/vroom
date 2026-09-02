import React, { useState } from 'react';
import { View, TouchableOpacity, StyleSheet } from 'react-native';
import { AppText as Text } from '../ui/AppText';
import { LinearGradient } from 'expo-linear-gradient';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import type { ProfileGradientSpec, ProfileHeroMotion, ProfileVisitEntranceAnim } from '../../constants/profilePremiumExtras';
import { linearGradientFromSpec } from './profileGradientUtils';
import ProfileHeroMotionLayer, { ProfileHeroKenBurnsWrapper } from './ProfileHeroMotionLayer';
import VisitEntranceFx from './VisitEntranceFx';

const PREVIEW_H = 180;

type Props = {
  heroMotion: ProfileHeroMotion;
  visitEntranceAnim: ProfileVisitEntranceAnim;
  customHeroGradient: ProfileGradientSpec | null;
  bannerUri?: string | null;
  isDark?: boolean;
  textMain: string;
  textDim: string;
  accent: string;
  inputBorder: string;
};

export default function ProfileAnimationSettingsPreview({
  heroMotion,
  visitEntranceAnim,
  customHeroGradient,
  isDark = true,
  textMain,
  textDim,
  accent,
  inputBorder,
}: Props) {
  const [replayTick, setReplayTick] = useState(0);
  const [visitPlaying, setVisitPlaying] = useState(false);

  const gradient = linearGradientFromSpec(customHeroGradient, ['#080808', '#1A0404', '#0D0808']);
  const canReplayVisit = visitEntranceAnim !== 'none';

  const handleReplay = () => {
    if (!canReplayVisit) return;
    setVisitPlaying(true);
    setReplayTick(t => t + 1);
  };

  return (
    <View style={{ gap: 8 }}>
      <Text style={{ fontFamily: 'Manrope_600SemiBold', fontSize: 12, color: textDim, letterSpacing: 1 }}>
        PODGLĄD ANIMACJI
      </Text>
      <View
        style={{
          height: PREVIEW_H,
          borderRadius: 14,
          overflow: 'hidden',
          borderWidth: 1,
          borderColor: inputBorder,
          backgroundColor: '#0a0a0a',
        }}
      >
        <ProfileHeroKenBurnsWrapper motion={heroMotion} style={{ flex: 1 }}>
          {gradient ? (
            <LinearGradient
              colors={gradient.colors as [string, string, ...string[]]}
              start={gradient.start}
              end={gradient.end}
              style={StyleSheet.absoluteFill}
            />
          ) : null}
        </ProfileHeroKenBurnsWrapper>
        <ProfileHeroMotionLayer motion={heroMotion} isDark={isDark} screenWidth={320} bannerHeight={PREVIEW_H} />
        <LinearGradient
          colors={['transparent', '#090909ee']}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
        <View style={{ ...StyleSheet.absoluteFillObject, justifyContent: 'flex-end', alignItems: 'center', paddingBottom: 16 }}>
          <View
            style={{
              width: 52,
              height: 52,
              borderRadius: 26,
              backgroundColor: '#e3383522',
              borderWidth: 2,
              borderColor: accent + '88',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <MaterialCommunityIcons name="account" size={28} color={accent} />
          </View>
          <Text style={{ fontFamily: 'Manrope_600SemiBold', fontSize: 12, color: textMain, marginTop: 8, letterSpacing: 1 }}>
            TWÓJ PROFIL
          </Text>
        </View>
        {visitPlaying && canReplayVisit && (
          <VisitEntranceFx
            key={replayTick}
            kind={visitEntranceAnim}
            onDone={() => setVisitPlaying(false)}
          />
        )}
      </View>
      <TouchableOpacity
        onPress={handleReplay}
        disabled={!canReplayVisit}
        style={{
          alignSelf: 'flex-start',
          paddingHorizontal: 12,
          paddingVertical: 8,
          borderRadius: 10,
          borderWidth: 1,
          borderColor: canReplayVisit ? accent : inputBorder,
          backgroundColor: canReplayVisit ? accent + '18' : '#ffffff08',
          opacity: canReplayVisit ? 1 : 0.45,
        }}
      >
        <Text style={{ fontFamily: 'Manrope_600SemiBold', fontSize: 12, color: canReplayVisit ? accent : textDim, letterSpacing: 1 }}>
          ODTWÓRZ WEJŚCIE
        </Text>
      </TouchableOpacity>
    </View>
  );
}
