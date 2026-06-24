import React, { useEffect, useRef } from 'react';
import { View, Text, Animated, Platform } from 'react-native';
import { MaterialCommunityIcons, MaterialIcons } from '@expo/vector-icons';
import type { SpeedCamera } from '../../hooks/useSpeedCamera';

interface Props {
  camera:    SpeedCamera | null;
  userSpeed: number;  // km/h
  visible:   boolean;
}

export function SpeedAlertBanner({ camera, userSpeed, visible }: Props) {
  const opacity  = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(-20)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, {
        toValue:         visible ? 1 : 0,
        duration:        250,
        useNativeDriver: true,
      }),
      Animated.timing(translateY, {
        toValue:         visible ? 0 : -20,
        duration:        250,
        useNativeDriver: true,
      }),
    ]).start();
  }, [visible]);

  if (!camera) return null;

  const isBump     = camera.type === 'bump';
  const isSpeeding = camera.maxspeed !== null && userSpeed > camera.maxspeed + 3;
  const color      = isSpeeding ? '#e33835' : '#ff922b';
  const dist       = Math.round(camera.distanceM);

  return (
    <Animated.View style={{
      position:  'absolute',
      top:       Platform.OS === 'ios' ? 160 : 145,
      left:      12,
      right:     12,
      zIndex:    25,
      opacity,
      transform: [{ translateY }],
    }}>
      <View style={{
        backgroundColor:  color + '15',
        borderRadius:     14,
        borderWidth:      1,
        borderColor:      color + '60',
        padding:          12,
        flexDirection:    'row',
        alignItems:       'center',
        gap:              10,
      }}>
        {/* Ikona */}
        <View style={{
          width:           40,
          height:          40,
          borderRadius:    10,
          backgroundColor: color + '20',
          borderWidth:     1,
          borderColor:     color + '40',
          alignItems:      'center',
          justifyContent:  'center',
        }}>
          <MaterialCommunityIcons name={isBump ? 'speedometer-slow' : 'camera-outline'} size={22} color={color} />
        </View>

        {/* Tekst */}
        <View style={{ flex: 1 }}>
          <Text style={{
            fontFamily:    'Orbitron',
            fontSize:      9,
            color:         color,
            letterSpacing: 2,
            fontWeight:    '700',
          }}>
            {isBump ? '🚧 PRÓG ZWALNIAJĄCY' : (isSpeeding ? '⚠️ FOTORADAR — ZA SZYBKO!' : '📷 FOTORADAR AHEAD')}
          </Text>
          <Text style={{
            fontFamily: 'Orbitron',
            fontSize:   8,
            color:      color + 'aa',
            marginTop:  2,
          }}>
            {dist}m · {camera.maxspeed ? `limit: ${camera.maxspeed} km/h` : 'nieznany limit'}
          </Text>
        </View>

        {/* Kółko z limitem */}
        {camera.maxspeed !== null && (
          <View style={{
            width:           42,
            height:          42,
            borderRadius:    21,
            backgroundColor: '#fff',
            borderWidth:     4,
            borderColor:     isSpeeding ? '#e33835' : '#ff922b',
            alignItems:      'center',
            justifyContent:  'center',
          }}>
            <Text style={{
              fontFamily: 'Orbitron',
              fontSize:   12,
              color:      '#111',
              fontWeight: '900',
            }}>
              {camera.maxspeed}
            </Text>
          </View>
        )}
      </View>
    </Animated.View>
  );
}