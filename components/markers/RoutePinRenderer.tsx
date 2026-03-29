import React from 'react';
import { View, Text } from 'react-native';
import ViewShot from 'react-native-view-shot';

interface Props {
  index:     number;
  total:     number;
  label:     string;
  onCapture: (uri: string) => void;
}

export const RoutePinRenderer = ({ index, total, label, onCapture }: Props) => {
  const isFirst = index === 0;
  const isLast  = index === total - 1 && total > 1;
  const color   = isFirst ? '#4de926' : isLast ? '#e33835' : '#ff922b';

  return (
    <View style={{
      position: 'absolute', top: 0, left: 0,
      opacity: 0, zIndex: -999, pointerEvents: 'none',
    }}>
      <ViewShot
        onCapture={onCapture}
        captureMode="mount"
        options={{ format: 'png', quality: 1.0 }}
      >
        <View style={{ alignItems: 'center', backgroundColor: 'transparent', padding: 4 }}>
          {/* Etykieta */}
          <View style={{
            backgroundColor: '#0a0a0af5', borderRadius: 7,
            paddingHorizontal: 9, paddingVertical: 4, marginBottom: 3,
            borderWidth: 1.5, borderColor: color,
            minWidth: 60, alignItems: 'center',
          }}>
            <Text style={{ color, fontSize: 8, fontWeight: '800', letterSpacing: 1 }}>
              {label.toUpperCase()}
            </Text>
            <Text style={{ color: '#ffffff55', fontSize: 6, marginTop: 1 }}>
              DOTKNIJ ABY USUNĄĆ
            </Text>
          </View>

          {/* Kółko */}
          <View style={{
            width: 34, height: 34, borderRadius: 17,
            backgroundColor: color,
            justifyContent: 'center', alignItems: 'center',
            borderWidth: 3, borderColor: '#000',
          }}>
            <Text style={{ color: '#000', fontSize: 12, fontWeight: '900' }}>
              {index + 1}
            </Text>
          </View>

          {/* Nóżka */}
          <View style={{
            width: 0, height: 0,
            borderLeftWidth: 7, borderRightWidth: 7, borderTopWidth: 9,
            borderStyle: 'solid',
            borderLeftColor: 'transparent', borderRightColor: 'transparent',
            borderTopColor: color, marginTop: -1,
          }} />
        </View>
      </ViewShot>
    </View>
  );
};