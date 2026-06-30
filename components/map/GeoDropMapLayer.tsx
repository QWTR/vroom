import React, { useMemo } from 'react';
import { TouchableOpacity, View } from 'react-native';
import Mapbox from '@rnmapbox/maps';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { GeoDropNearby } from '../../lib/gamificationClient';

const SPRITE_PX = 44;

function GeoDropSprite() {
  return (
    <View
      style={{
        width: SPRITE_PX,
        height: SPRITE_PX,
        borderRadius: SPRITE_PX / 2,
        backgroundColor: '#7c3aed',
        justifyContent: 'center',
        alignItems: 'center',
        borderWidth: 2.5,
        borderColor: '#fbbf24',
        shadowColor: '#000',
        shadowOpacity: 0.35,
        shadowRadius: 4,
        shadowOffset: { width: 0, height: 2 },
        elevation: 6,
      }}
    >
      <MaterialCommunityIcons name="diamond-stone" size={22} color="#fde68a" />
    </View>
  );
}

type Props = {
  drops: GeoDropNearby[];
  onSelectDrop?: (drop: GeoDropNearby) => void;
};

export function GeoDropMapLayer({ drops, onSelectDrop }: Props) {
  const visibleDrops = useMemo(
    () => drops.filter((d) => Number.isFinite(d.lat) && Number.isFinite(d.lng)),
    [drops],
  );

  return (
    <>
      {visibleDrops.map((drop) => (
        <Mapbox.MarkerView
          key={`geo-drop-${drop.id}`}
          coordinate={[drop.lng, drop.lat]}
          anchor={{ x: 0.5, y: 0.5 }}
        >
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={() => onSelectDrop?.(drop)}
          >
            <GeoDropSprite />
          </TouchableOpacity>
        </Mapbox.MarkerView>
      ))}
    </>
  );
}
