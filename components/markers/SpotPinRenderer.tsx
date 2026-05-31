import React, { useRef, useEffect } from 'react';
import { View, Text } from 'react-native';
import { captureRef } from 'react-native-view-shot';
import { MaterialIcons } from '@expo/vector-icons';
import { CATEGORY_COLORS, CATEGORY_ICONS } from '../../constants/spotTypes';
import type { Spot } from '../../constants/spotTypes';
import { useTheme } from '../../contexts/ThemeContext';

interface Props {
  spot: Spot;
  zoom: 'dot' | 'full';
  onCapture: (uri: string) => void;
}

export function SpotPinRenderer({ spot, zoom, onCapture }: Props) {
  const { theme } = useTheme();
  const viewRef = useRef<View>(null);
  const color = CATEGORY_COLORS[spot.category] ?? '#e33835';

  useEffect(() => {
    const timer = setTimeout(async () => {
      try {
        if (!viewRef.current) return;
        const uri = await captureRef(viewRef, { format: 'png', quality: 1, result: 'tmpfile' });
        onCapture(uri);
      } catch {}
    }, 80);
    return () => clearTimeout(timer);
  }, [spot.id, zoom, color]);

  if (zoom === 'dot') {
    return (
      <View
        ref={viewRef}
        collapsable={false}
        style={{
          position: 'absolute', top: -9999, left: -9999,
          width: 20, height: 20, alignItems: 'center', justifyContent: 'center',
        }}
      >
        <View style={{
          width: 14, height: 14, borderRadius: 7,
          backgroundColor: color,
          borderWidth: 2.5, borderColor: theme.surface,
        }} />
      </View>
    );
  }

  // full pin z nazwą
  const totalHeight = 70; // label(~26) + gap(5) + circle(36) + arrow(7)
  return (
    <View
      ref={viewRef}
      collapsable={false}
      style={{
        position: 'absolute', top: -9999, left: -9999,
        width: 160, height: totalHeight,
        alignItems: 'center', justifyContent: 'flex-end',
      }}
    >
      {/* Nazwa */}
      <View style={{
        backgroundColor: theme.mapLabelBg,
        borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4,
        marginBottom: 5,
        borderWidth: 1, borderColor: color + '60',
        maxWidth: 158,
        alignSelf: 'center',
      }}>
        <Text
          numberOfLines={1}
          style={{
            fontFamily: 'Orbitron',
            fontSize: 9,
            color: theme.mapLabelText,
            fontWeight: '700',
            letterSpacing: 0.5,
          }}
        >
          {spot.name}
        </Text>
      </View>

      {/* Kółko z ikoną */}
      <View style={{
        width: 36, height: 36, borderRadius: 18,
        backgroundColor: color + '22',
        borderWidth: 2.5, borderColor: color,
        alignItems: 'center', justifyContent: 'center',
      }}>
        <MaterialIcons name={CATEGORY_ICONS[spot.category] as any} size={17} color={color} />
      </View>

      {/* Strzałka w dół */}
      <View style={{
        width: 0, height: 0,
        borderLeftWidth: 5, borderRightWidth: 5, borderTopWidth: 7,
        borderLeftColor: 'transparent', borderRightColor: 'transparent',
        borderTopColor: color,
        marginTop: -1,
      }} />
    </View>
  );
}