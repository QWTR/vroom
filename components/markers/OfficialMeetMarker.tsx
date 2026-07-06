import React, { memo } from 'react';
import { View, Text, TouchableOpacity, Image } from 'react-native';
import Mapbox from '@rnmapbox/maps';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { OfficialMapMeet } from '../../hooks/useOfficialMapMeets';
import { normalizeMediaUri } from '../../lib/mediaUri';

const ACCENT = '#f5c518';

interface Props {
  meet: OfficialMapMeet;
  onPress?: () => void;
  compact?: boolean;
}

export const OfficialMeetMarker = memo(({ meet, onPress, compact = false }: Props) => {
  const { lat, lng, title, coverImage, status } = meet;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const cover = normalizeMediaUri(coverImage);
  const isHot = status === 'HOT';

  return (
    <Mapbox.MarkerView coordinate={[lng, lat]} anchor={{ x: 0.5, y: 1 }} allowOverlap allowOverlapWithPuck>
      <TouchableOpacity onPress={onPress} activeOpacity={0.85}>
        <View style={{ alignItems: 'center' }}>
          <View style={{
            minWidth: compact ? 34 : 56,
            maxWidth: compact ? 34 : 96,
            backgroundColor: '#121820',
            paddingHorizontal: compact ? 4 : 6,
            paddingVertical: compact ? 4 : 5,
            borderRadius: compact ? 17 : 12,
            borderWidth: 1.5,
            borderColor: isHot ? '#ff9800' : ACCENT,
            alignItems: 'center',
            shadowColor: '#000',
            shadowOpacity: 0.25,
            shadowRadius: 6,
            shadowOffset: { width: 0, height: 2 },
            elevation: 4,
          }}>
            <View style={{
              width: compact ? 18 : 26,
              height: compact ? 18 : 26,
              borderRadius: compact ? 9 : 13,
              backgroundColor: '#ffffff',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: compact ? 0 : 2,
              overflow: 'hidden',
            }}>
              {cover ? (
                <Image
                  source={{ uri: cover }}
                  style={{ width: compact ? 16 : 24, height: compact ? 16 : 24 }}
                  resizeMode="cover"
                />
              ) : (
                <MaterialCommunityIcons name="flag-checkered" size={compact ? 11 : 15} color={ACCENT} />
              )}
            </View>
            {!compact && (
              <>
                <Text
                  numberOfLines={1}
                  style={{ color: ACCENT, fontSize: 7, fontWeight: '900', marginBottom: 1, letterSpacing: 0.5 }}
                >
                  {isHot ? '🔥 HOT' : '⭐ EVENT'}
                </Text>
                <Text
                  numberOfLines={2}
                  style={{ color: '#f0f4ff', fontSize: 9, fontWeight: '800', textAlign: 'center' }}
                >
                  {title}
                </Text>
              </>
            )}
          </View>
          {!compact && (
            <View style={{
              width: 0,
              height: 0,
              borderLeftWidth: 5,
              borderRightWidth: 5,
              borderTopWidth: 6,
              borderStyle: 'solid',
              borderLeftColor: 'transparent',
              borderRightColor: 'transparent',
              borderTopColor: isHot ? '#ff9800' : ACCENT,
            }} />
          )}
        </View>
      </TouchableOpacity>
    </Mapbox.MarkerView>
  );
});
