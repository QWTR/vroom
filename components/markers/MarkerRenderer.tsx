import React from 'react';
import { View, Text } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import ViewShot from 'react-native-view-shot';
import { User } from '../../constants/types';

interface MarkerRendererProps {
  user: User;
  distance: number;
  onCapture: (uri: string) => void;
}

export const MarkerRenderer = ({ user, distance, onCapture }: MarkerRendererProps) => {
  const carColor = user.isFriend ? '#00d26a' : '#00bfff';

  return (
    <View
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        opacity: 0,        // ✅ niewidoczny ale renderowany
        zIndex: -999,
        pointerEvents: 'none',
      }}
    >
      <ViewShot
        onCapture={onCapture}
        captureMode="mount"
        options={{ format: 'png', quality: 1.0 }}
      >
        <View style={{
          alignItems: 'center',
          backgroundColor: 'transparent',
          padding: 2,
        }}>
          {/* NAZWA + DYSTANS */}
          <View style={{
            backgroundColor: '#000000ee',
            borderRadius: 8,
            paddingHorizontal: 8,
            paddingVertical: 4,
            marginBottom: 2,
            borderWidth: 1.5,
            borderColor: carColor,
            minWidth: 80,
          }}>
            <Text numberOfLines={1} style={{
              color: '#fff',
              fontSize: 11,
              fontWeight: 'bold',
              textAlign: 'center',
            }}>
              {user.avatar} {user.name}
            </Text>
            <Text style={{
              color: carColor,
              fontSize: 9,
              fontWeight: 'bold',
              textAlign: 'center',
            }}>
              {distance.toFixed(1)} km
            </Text>
          </View>

          {/* AUTO */}
          <View style={{
            width: 36,
            height: 36,
            borderRadius: 8,
            backgroundColor: carColor,
            justifyContent: 'center',
            alignItems: 'center',
            borderWidth: 2,
            borderColor: '#000',
          }}>
            <MaterialIcons name="directions-car" size={20} color="#000" />
          </View>

          {/* NÓŻKA */}
          <View style={{
            width: 0,
            height: 0,
            borderLeftWidth: 6,
            borderRightWidth: 6,
            borderTopWidth: 8,
            borderStyle: 'solid',
            borderLeftColor: 'transparent',
            borderRightColor: 'transparent',
            borderTopColor: carColor,
          }} />
        </View>
      </ViewShot>
    </View>
  );
};