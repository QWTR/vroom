import React from 'react';
import { View } from 'react-native';
import { AppText as Text } from '../ui/AppText';
import ViewShot from 'react-native-view-shot';
import { useTheme } from '../../contexts/ThemeContext';

interface Props {
  type:      'start' | 'end';
  label:     string;
  onCapture: (uri: string) => void;
}

export const RouteEndpointRenderer = ({ type, label, onCapture }: Props) => {
  const { theme } = useTheme();
  const color = type === 'start' ? '#4de926' : '#e33835';

  return (
    <View style={{ position: 'absolute', top: 0, left: 0, opacity: 0, zIndex: -999, pointerEvents: 'none' }}>
      <ViewShot onCapture={onCapture} captureMode="mount" options={{ format: 'png', quality: 1.0 }}>
        <View style={{ alignItems: 'center', padding: 4 }}>
          {/* Etykieta */}
          <View style={{
            backgroundColor: theme.mapLabelBg, borderRadius: 8,
            paddingHorizontal: 10, paddingVertical: 5, marginBottom: 4,
            borderWidth: 1.5, borderColor: color, minWidth: 70, alignItems: 'center',
          }}>
            <Text style={{ color, fontSize: 12, fontWeight: '800', letterSpacing: 1 }}>
              {type === 'start' ? 'START' : 'KONIEC'}
            </Text>
            <Text style={{ color: theme.textMuted, fontSize: 12, marginTop: 1 }} numberOfLines={1}>
              {label}
            </Text>
          </View>
          {/* Kółko */}
          <View style={{
            width: 32, height: 32, borderRadius: 16,
            backgroundColor: color,
            justifyContent: 'center', alignItems: 'center',
            borderWidth: 3, borderColor: '#000',
          }}>
            <Text style={{ fontSize: 14 }}>
              {type === 'start' ? '🚦' : '🏁'}
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