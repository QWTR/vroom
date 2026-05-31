import React from 'react';
import { View, Text } from 'react-native';
import ViewShot from 'react-native-view-shot';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { SpeedCamera } from '../../hooks/useSpeedCameras';
import { useTheme } from '../../contexts/ThemeContext';

interface Props {
  camera:    SpeedCamera;
  userSpeed: number;
  onCapture: (uri: string) => void;
}

const TYPE_CONFIG: Record<string, { icon: string; color: string }> = {
  fixed:   { icon: 'camera-outline',    color: '#e33835' },
  section: { icon: 'camera-timer',      color: '#ff922b' },
  mobile:  { icon: 'car-speed-limiter', color: '#FFD700' },
  bump:    { icon: 'speedometer-slow',  color: '#4de926' },
};

export function SpeedCameraRenderer({ camera, userSpeed, onCapture }: Props) {
  const { theme } = useTheme();
  const { distanceM, maxspeed, type } = camera;
  const cfg     = TYPE_CONFIG[type] ?? TYPE_CONFIG.fixed;
  const isBump  = type === 'bump';
  const isSpeeding = !isBump && maxspeed !== null && userSpeed > maxspeed + 3;

  const color =
    isBump                        ? '#4de926' :
    isSpeeding && distanceM < 500 ? '#e33835' :
    distanceM  < 500              ? '#ff922b' :
    distanceM  < 2000             ? '#FFD700' :
                                    '#aaaaaa';

  return (
    <View style={{
      position: 'absolute', top: 0, left: 0,
      opacity: 0, zIndex: -999, pointerEvents: 'none',
    }}>
      <ViewShot
        onCapture={uri => onCapture(uri)}
        captureMode="mount"
        options={{ format: 'png', quality: 1.0 }}
      >
        <View style={{
          alignItems: 'center',
          paddingHorizontal: 8,
          paddingTop: 8,
          paddingBottom: 4,
          backgroundColor: 'transparent',
        }}>
          {isBump ? (
            /* ── Próg zwalniający ── */
            <View style={{
              backgroundColor:   '#4de92625',
              borderRadius:      12,
              borderWidth:       2.5,
              borderColor:       '#4de926',
              paddingHorizontal: 10,
              paddingVertical:   8,
              alignItems:        'center',
              gap:               3,
            }}>
              <MaterialCommunityIcons name="speedometer-slow" size={22} color="#4de926" />
              <Text style={{ color: '#4de926', fontSize: 8, fontWeight: '700' }}>
                PRÓG
              </Text>
            </View>
          ) : maxspeed !== null ? (
            /* ── Fotoradar z limitem ── */
            <View style={{
              width:           48,
              height:          48,
              borderRadius:    24,
              backgroundColor: '#ffffff',
              borderWidth:     4,
              borderColor:     isSpeeding ? '#e33835' : '#cc0000',
              alignItems:      'center',
              justifyContent:  'center',
            }}>
              <Text style={{
                fontSize:   maxspeed >= 100 ? 11 : 14,
                color:      theme.text,
                fontWeight: '900',
              }}>
                {maxspeed}
              </Text>
            </View>
          ) : (
            /* ── Fotoradar bez limitu ── */
            <View style={{
              width:           48,
              height:          48,
              borderRadius:    24,
              backgroundColor: `${cfg.color}25`,
              borderWidth:     2.5,
              borderColor:     cfg.color,
              alignItems:      'center',
              justifyContent:  'center',
            }}>
              <MaterialCommunityIcons
                name={cfg.icon as any}
                size={24}
                color={cfg.color}
              />
            </View>
          )}

          {/* Odległość pod markerem */}
          <View style={{
            backgroundColor:   theme.mapLabelBg,
            borderRadius:      6,
            paddingHorizontal: 6,
            paddingVertical:   2,
            marginTop:         4,
          }}>
            <Text style={{ color, fontSize: 9, fontWeight: '700' }}>
              {distanceM < 1000
                ? `${Math.round(distanceM)}m`
                : `${(distanceM / 1000).toFixed(1)}km`}
            </Text>
          </View>
        </View>
      </ViewShot>
    </View>
  );
}