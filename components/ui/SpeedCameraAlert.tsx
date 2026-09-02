import React, { useEffect, useRef, memo } from 'react';
import { View, Animated, Platform } from 'react-native';
import { AppText as Text } from './AppText';
import { MaterialCommunityIcons }         from '@expo/vector-icons';
import type { SpeedCamera }               from '../../hooks/useSpeedCamera';
import { useTheme } from '../../contexts/ThemeContext';

interface Props {
  camera:    SpeedCamera | null;
  userSpeed: number;
  visible:   boolean;
  topOffset?: number;
}

export const SpeedCameraAlert = memo(({ camera, userSpeed, visible, topOffset }: Props) => {
  const { theme } = useTheme();
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.spring(anim, {
      toValue:         visible ? 1 : 0,
      tension:         80,
      friction:        10,
      useNativeDriver: true,
    }).start();
  }, [visible]);

  if (!camera) return null;

  const isBump     = camera.type === 'bump';
  const limit      = camera.maxspeed;
  const isSpeeding = limit !== null && userSpeed > limit + 3;
  const dist       = Math.round(camera.distanceM);
  const color      = isSpeeding ? theme.danger : theme.warning;

  const top = topOffset ?? (Platform.OS === 'ios' ? 155 : 140);

  return (
    <Animated.View style={{
      position:  'absolute',
      top,
      left:      12,
      right:     12,
      zIndex:    30,
      opacity:   anim,
      transform: [{
        translateY: anim.interpolate({
          inputRange:  [0, 1],
          outputRange: [-12, 0],
        }),
      }],
      pointerEvents: 'none',
    }}>
      <View style={{
        flexDirection:   'row',
        alignItems:      'center',
        backgroundColor: theme.mapOverlay,
        borderRadius:    16,
        borderWidth:     1,
        borderColor:     color + '50',
        paddingVertical:  10,
        paddingHorizontal: 14,
        gap:             12,
        shadowColor:     color,
        shadowOpacity:   0.25,
        shadowOffset:    { width: 0, height: 4 },
        shadowRadius:    12,
        elevation:       10,
      }}>

        <View style={{
          width:           40,
          height:          40,
          borderRadius:    11,
          backgroundColor: color + '18',
          borderWidth:     1,
          borderColor:     color + '40',
          alignItems:      'center',
          justifyContent:  'center',
        }}>
          <MaterialCommunityIcons name={isBump ? 'speedometer-slow' : 'camera-outline'} size={22} color={color} />
        </View>

        <View style={{ flex: 1 }}>
          <Text style={{
            fontFamily:    'Manrope_600SemiBold',
            fontSize:      12,
            color:         color,
            fontWeight:    '700',
            letterSpacing: 1,
          }}>
            {isBump ? '🚧 PRÓG ZWALNIAJĄCY' : (isSpeeding ? '⚠️ ZA SZYBKO — FOTORADAR' : '📷 FOTORADAR')}
          </Text>
          <Text style={{
            fontFamily: 'Manrope_600SemiBold',
            fontSize:   12,
            color:      theme.textDim,
            marginTop:  3,
          }}>
            {dist < 1000 ? `za ${dist} m` : `za ${(dist / 1000).toFixed(1)} km`}
            {limit ? `  ·  limit ${limit} km/h` : ''}
          </Text>
        </View>

        {limit !== null && (
          <View style={{
            width:           46,
            height:          46,
            borderRadius:    23,
            backgroundColor: '#fff',
            borderWidth:     4,
            borderColor:     isSpeeding ? theme.danger : '#cc0000',
            alignItems:      'center',
            justifyContent:  'center',
            shadowColor:     isSpeeding ? theme.danger : '#cc0000',
            shadowOpacity:   isSpeeding ? 0.5 : 0.2,
            shadowOffset:    { width: 0, height: 0 },
            shadowRadius:    isSpeeding ? 8 : 4,
            elevation:       isSpeeding ? 8 : 4,
          }}>
            <Text style={{
              fontFamily: 'Manrope_600SemiBold',
              fontSize:   limit >= 100 ? 11 : 13,
              color:      theme.text,
              fontWeight: '900',
              lineHeight: 16,
            }}>
              {limit}
            </Text>
          </View>
        )}
      </View>
    </Animated.View>
  );
});
