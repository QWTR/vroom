import React from 'react';
import { View, Text, Image } from 'react-native';
import ViewShot from 'react-native-view-shot';
import { MaterialIcons } from '@expo/vector-icons';
import { User } from '../../constants/types';

interface MarkerRendererProps {
  user:      User;
  distance:  number;
  onCapture: (uri: string) => void;
}

export const MarkerRenderer = ({ user, distance, onCapture }: MarkerRendererProps) => {
  const color       = user.isFriend ? '#4de926' : '#00bfff';
  const bgColor     = user.isFriend ? '#4de92622' : '#00bfff22';
  const borderColor = user.isPremium ? '#FFD700' : (user.isFriend ? '#4de92650' : '#00bfff50');
  const isUrl       = user.avatar?.startsWith('http');

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
        <View style={{
          alignItems: 'center', backgroundColor: 'transparent',
          paddingHorizontal: 2, paddingTop: 2,
        }}>

          {/* Dymek */}
          <View style={{
            backgroundColor: '#0a0a0af0', borderRadius: 10,
            paddingHorizontal: 10, paddingVertical: 6, marginBottom: 3,
            borderWidth: 1.5, borderColor, minWidth: 88, alignItems: 'center',
          }}>
            <Text numberOfLines={1} style={{
              color: '#ffffff', fontSize: 10, fontWeight: '700',
              textAlign: 'center', letterSpacing: 0.3,
            }}>
              {user.name}
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 2 }}>
              <View style={{
                width: 5, height: 5, borderRadius: 3,
                backgroundColor: user.status === 'Online' ? '#4de926' : '#ffffff40',
              }} />
              <Text style={{
                color, fontSize: 8, fontWeight: '700',
                textAlign: 'center', letterSpacing: 0.5,
              }}>
                {distance.toFixed(1)} km
              </Text>
            </View>
          </View>

          {/* Avatar lub inicjały */}
          <View style={{ position: 'relative' }}>
            <View style={{
              width: 40, height: 40, borderRadius: 20,
              backgroundColor: bgColor, justifyContent: 'center',
              alignItems: 'center', borderWidth: user.isPremium ? 3 : 1.5, borderColor, overflow: 'hidden',
            }}>
              {isUrl ? (
                <Image
                  source={{ uri: user.avatar }}
                  style={{ width: 40, height: 40, borderRadius: 20 }}
                  resizeMode="cover"
                />
              ) : (
                <Text style={{ color, fontSize: 14, fontWeight: '700' }}>
                  {user.name?.slice(0, 2).toUpperCase() ?? '??'}
                </Text>
              )}
            </View>
            {user.isPremium && (
              <View style={{
                position: 'absolute', top: -6, right: -6,
                backgroundColor: '#FFD700', borderRadius: 8,
                width: 16, height: 16,
                alignItems: 'center', justifyContent: 'center',
                zIndex: 10,
              }}>
                <MaterialIcons name="workspace-premium" size={10} color="#000" />
              </View>
            )}
          </View>

          {/* Nóżka */}
          <View style={{
            width: 0, height: 0,
            borderLeftWidth: 6, borderRightWidth: 6, borderTopWidth: 7,
            borderStyle: 'solid', borderLeftColor: 'transparent',
            borderRightColor: 'transparent', borderTopColor: color, marginTop: -1,
          }} />
        </View>
      </ViewShot>
    </View>
  );
};