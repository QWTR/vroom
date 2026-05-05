import React from 'react';
import { Animated, Dimensions, StyleSheet, View } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';

const SPARKLE_STARS = [...Array(14)].map((_, i) => ({
  key: i,
  left: `${(i * 67) % 100}%` as `${number}%`,
  top:  `${(i * 41) % 85}%` as `${number}%`,
  rot:  `${(i * 53) % 360}deg`,
}));

export default function VisitEntranceFx({ kind, onDone }: { kind: string; onDone: () => void }) {
  const fade = React.useRef(new Animated.Value(1)).current;
  const sweep = React.useRef(new Animated.Value(0)).current;
  const glow = React.useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    const ms = kind === 'hero-flash' ? 520 : kind === 'rings' ? 1600 : kind === 'sweep' ? 1100 : kind === 'glow' ? 1600 : 1400;
    Animated.timing(fade, {
      toValue:      0,
      duration:     ms,
      delay:        kind === 'hero-flash' ? 40 : 120,
      useNativeDriver: true,
    }).start(() => onDone());
  }, [kind, fade, onDone]);

  React.useEffect(() => {
    if (kind !== 'sweep') return;
    sweep.setValue(0);
    Animated.timing(sweep, {
      toValue:        1,
      duration:       900,
      delay:          40,
      useNativeDriver: true,
    }).start();
  }, [kind, sweep]);

  React.useEffect(() => {
    if (kind !== 'glow') return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(glow, { toValue: 1, duration: 380, useNativeDriver: true }),
        Animated.timing(glow, { toValue: 0, duration: 520, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [kind, glow]);

  if (kind === 'hero-flash') {
    return (
      <Animated.View
        pointerEvents="none"
        style={{ ...StyleSheet.absoluteFillObject, zIndex: 40, opacity: fade, backgroundColor: '#ffffff' }}
      />
    );
  }

  if (kind === 'rings') {
    return (
      <Animated.View pointerEvents="none" style={{ ...StyleSheet.absoluteFillObject, zIndex: 40, alignItems: 'center', justifyContent: 'center', opacity: fade }}>
        <View style={{ position: 'absolute', width: 140, height: 140, borderRadius: 70, borderWidth: 2, borderColor: '#FFD70066' }} />
        <View style={{ position: 'absolute', width: 200, height: 200, borderRadius: 100, borderWidth: 2, borderColor: '#e3383544' }} />
        <View style={{ position: 'absolute', width: 260, height: 260, borderRadius: 130, borderWidth: 2, borderColor: '#38bdf844' }} />
      </Animated.View>
    );
  }

  if (kind === 'glow') {
    return (
      <Animated.View
        pointerEvents="none"
        style={{
          ...StyleSheet.absoluteFillObject,
          zIndex:      40,
          opacity:     fade,
          alignItems:  'center',
          justifyContent: 'center',
        }}
      >
        <Animated.View
          style={{
            width:           Math.min(Dimensions.get('window').width * 1.2, 520),
            height:          Math.min(Dimensions.get('window').width * 1.2, 520),
            borderRadius:    999,
            backgroundColor: '#FFD700',
            opacity:         glow.interpolate({ inputRange: [0, 1], outputRange: [0.08, 0.38] }),
          }}
        />
      </Animated.View>
    );
  }

  if (kind === 'sweep') {
    const w = Dimensions.get('window').width;
    return (
      <Animated.View pointerEvents="none" style={{ ...StyleSheet.absoluteFillObject, zIndex: 40, opacity: fade, overflow: 'hidden' }}>
        <Animated.View
          style={{
            position:    'absolute',
            top:         0,
            bottom:      0,
            width:       120,
            marginLeft:  -60,
            transform:   [{
              translateX: sweep.interpolate({
                inputRange:  [0, 1],
                outputRange: [-80, w + 80],
              }),
            }],
            backgroundColor: 'rgba(255,215,0,0.35)',
          }}
        />
      </Animated.View>
    );
  }

  return (
    <Animated.View pointerEvents="none" style={{ ...StyleSheet.absoluteFillObject, zIndex: 40, opacity: fade }}>
      {SPARKLE_STARS.map(s => (
        <View key={s.key} style={{ position: 'absolute', left: s.left, top: s.top, transform: [{ rotate: s.rot }] }}>
          <MaterialIcons name="auto-awesome" size={22} color="#FFD700" />
        </View>
      ))}
    </Animated.View>
  );
}
