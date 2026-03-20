import React from 'react';
import { View, Text } from 'react-native';
import ViewShot from 'react-native-view-shot';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { LiveWarning, getWarningColor, getWarningIcon } from '../../hooks/useLiveMap';

interface WarningMarkerRendererProps {
  warning:   LiveWarning;
  onCapture: (id: number, uri: string) => void;
}

export const WarningMarkerRenderer = ({ warning, onCapture }: WarningMarkerRendererProps) => {
  const color    = getWarningColor(warning.type);
  const icon     = getWarningIcon(warning.type);
  const timeLeft = Math.max(0, Math.round(
    (new Date(warning.expiresAt).getTime() - Date.now()) / 60000
  ));

  return (
    <View style={{
      position: 'absolute', top: 0, left: 0,
      opacity: 0, zIndex: -999, pointerEvents: 'none',
    }}>
      <ViewShot
        onCapture={uri => onCapture(warning.id, uri)}
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
          {warning.confirmCount > 0 && (
            <View style={{
              backgroundColor: color, borderRadius: 10,
              paddingHorizontal: 6, paddingVertical: 2,
              marginBottom: 4, minWidth: 24, alignItems: 'center',
            }}>
              <Text style={{ color: '#000', fontSize: 9, fontWeight: '700' }}>
                +{warning.confirmCount}
              </Text>
            </View>
          )}
          <View style={{
            width: 48, height: 48, borderRadius: 24,
            backgroundColor: `${color}25`,
            borderWidth: 2.5, borderColor: color,
            alignItems: 'center', justifyContent: 'center',
          }}>
            <MaterialCommunityIcons name={icon as any} size={24} color={color} />
          </View>
          <View style={{
            backgroundColor: '#0a0a0aee', borderRadius: 6,
            paddingHorizontal: 6, paddingVertical: 2, marginTop: 4,
          }}>
            <Text style={{ color, fontSize: 9, fontWeight: '700' }}>
              {15 - timeLeft}min
            </Text>
          </View>
        </View>
      </ViewShot>
    </View>
  );
};