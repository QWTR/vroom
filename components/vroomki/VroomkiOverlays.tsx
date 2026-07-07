import React from 'react';
import { View, StyleSheet, Dimensions } from 'react-native';
import { VroomkiStyledText } from './VroomkiStyledText';
import type { VroomkiTextOverlay } from '../../lib/vroomkiTypes';

const { width: SCREEN_W } = Dimensions.get('window');

export function VroomkiOverlays({
  overlays,
  width = SCREEN_W,
  height,
  interactive = false,
  onPressOverlay,
}: {
  overlays: VroomkiTextOverlay[];
  width?: number;
  height: number;
  interactive?: boolean;
  onPressOverlay?: (id: string) => void;
}) {
  if (!overlays.length) return null;

  return (
    <View pointerEvents={interactive ? 'box-none' : 'none'} style={StyleSheet.absoluteFill}>
      {overlays.map((overlay) => (
        <View
          key={overlay.id}
          onTouchEnd={interactive && onPressOverlay ? () => onPressOverlay(overlay.id) : undefined}
          style={{
            position: 'absolute',
            left: overlay.x * width,
            top: overlay.y * height,
            transform: [
              { translateX: '-50%' },
              { translateY: '-50%' },
              { rotate: `${overlay.rotation}deg` },
              { scale: overlay.scale },
            ],
            maxWidth: width * 0.86,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <VroomkiStyledText overlay={overlay} fontSize={overlay.fontSize} />
        </View>
      ))}
    </View>
  );
}
