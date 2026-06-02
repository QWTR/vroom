import React, { memo } from 'react';
import { View, Text, TouchableOpacity, Image } from 'react-native';
import Mapbox from '@rnmapbox/maps';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { PartnerPoi } from '../../hooks/usePartnerPois';
import { normalizeMediaUri } from '../../lib/mediaUri';

const CATEGORY_ICONS: Record<string, keyof typeof MaterialCommunityIcons.glyphMap> = {
  warsztat: 'car-wrench',
  myjnia: 'car-wash',
  tuning: 'engine',
  sklep: 'store',
  restauracja: 'silverware-fork-knife',
  hotel: 'bed',
  other: 'store',
};

interface Props {
  poi: PartnerPoi;
  onPress?: () => void;
  compact?: boolean;
}

export const PartnerPoiMarker = memo(({ poi, onPress, compact = false }: Props) => {
  const { lat, lng, logoUrl, name, markerAccentColor, category } = poi;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const accent = markerAccentColor || '#FFD700';
  const logo = normalizeMediaUri(logoUrl);
  const iconName = CATEGORY_ICONS[category || 'other'] || 'store';

  return (
    <Mapbox.MarkerView coordinate={[lng, lat]} anchor={{ x: 0.5, y: 1 }} allowOverlap allowOverlapWithPuck>
      <TouchableOpacity onPress={onPress} activeOpacity={0.85}>
        <View style={{ alignItems: 'center' }}>
          <View style={{
            minWidth: compact ? 34 : 52,
            maxWidth: compact ? 34 : 88,
            backgroundColor: '#121820',
            paddingHorizontal: compact ? 4 : 6,
            paddingVertical: compact ? 4 : 5,
            borderRadius: compact ? 17 : 12,
            borderWidth: 1.2,
            borderColor: accent,
            alignItems: 'center',
            shadowColor: '#000',
            shadowOpacity: 0.22,
            shadowRadius: 6,
            shadowOffset: { width: 0, height: 2 },
            elevation: 4,
          }}>
            <View style={{
              width: compact ? 18 : 24,
              height: compact ? 18 : 24,
              borderRadius: compact ? 9 : 12,
              backgroundColor: '#ffffff',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: compact ? 0 : 2,
              overflow: 'hidden',
            }}>
              {logo ? (
                <Image
                  source={{ uri: logo }}
                  style={{ width: compact ? 13 : 17, height: compact ? 13 : 17 }}
                  resizeMode="contain"
                />
              ) : (
                <MaterialCommunityIcons name={iconName} size={compact ? 11 : 14} color={accent} />
              )}
            </View>
            {!compact && (
              <>
                <Text
                  numberOfLines={1}
                  style={{ color: accent, fontSize: 8, fontWeight: '900', marginBottom: 1 }}
                >
                  PARTNER
                </Text>
                <Text
                  numberOfLines={1}
                  style={{ color: '#d8e9ff', fontSize: 9, fontWeight: '800' }}
                >
                  {name}
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
              borderTopColor: accent,
            }} />
          )}
        </View>
      </TouchableOpacity>
    </Mapbox.MarkerView>
  );
});
