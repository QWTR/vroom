import React from 'react';
import { View, Text, type TextStyle, type StyleProp } from 'react-native';
import type { VroomkiTextOverlay } from '../../lib/vroomkiTypes';

const STROKE_OFFSETS = [
  { x: -2, y: 0 }, { x: 2, y: 0 }, { x: 0, y: -2 }, { x: 0, y: 2 },
  { x: -1.5, y: -1.5 }, { x: 1.5, y: -1.5 }, { x: -1.5, y: 1.5 }, { x: 1.5, y: 1.5 },
];

export function VroomkiStyledText({
  overlay,
  fontSize,
  style,
  numberOfLines,
}: {
  overlay: Pick<VroomkiTextOverlay, 'text' | 'color' | 'bgColor' | 'strokeColor' | 'strokeWidth'>;
  fontSize: number;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
}) {
  const strokeWidth = Math.max(0, overlay.strokeWidth ?? 0);
  const strokeColor = overlay.strokeColor ?? '#000000';
  const base: TextStyle = {
    fontFamily: 'Orbitron',
    fontWeight: '800',
    textAlign: 'center',
    fontSize,
    color: overlay.color,
    backgroundColor: overlay.bgColor ?? 'transparent',
    paddingHorizontal: overlay.bgColor ? 10 : 0,
    paddingVertical: overlay.bgColor ? 6 : 0,
    borderRadius: overlay.bgColor ? 10 : 0,
  };

  if (strokeWidth <= 0) {
    return (
      <Text style={[base, style]} numberOfLines={numberOfLines}>
        {overlay.text}
      </Text>
    );
  }

  const scale = strokeWidth / 2;
  const offsets = STROKE_OFFSETS.map((item) => ({
    x: item.x * scale,
    y: item.y * scale,
  }));

  return (
    <View style={{ alignItems: 'center', justifyContent: 'center' }}>
      {offsets.map((offset, index) => (
        <Text
          key={`stroke-${index}`}
          numberOfLines={numberOfLines}
          style={[
            base,
            style,
            {
              position: 'absolute',
              color: strokeColor,
              backgroundColor: 'transparent',
              paddingHorizontal: 0,
              paddingVertical: 0,
              borderRadius: 0,
              left: offset.x,
              top: offset.y,
            },
          ]}
        >
          {overlay.text}
        </Text>
      ))}
      <Text style={[base, style]} numberOfLines={numberOfLines}>
        {overlay.text}
      </Text>
    </View>
  );
}
