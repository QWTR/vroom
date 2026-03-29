import React, { useState, useEffect } from 'react';
import { View, Text } from 'react-native';
import { Marker } from 'react-native-maps';

interface RoutePinProps {
  id:        string;
  index:     number;
  total:     number;
  label:     string;
  latitude:  number;
  longitude: number;
  onRemove:  (id: string) => void;
}

export const RoutePin = ({ id, index, total, label, latitude, longitude, onRemove }: RoutePinProps) => {
  const [tracks, setTracks] = useState(true);

  // Po wyrenderowaniu wyłącz tracksViewChanges — bez tego mapa laguje
  useEffect(() => {
    const t = setTimeout(() => setTracks(false), 500);
    return () => clearTimeout(t);
  }, []);

  const isFirst = index === 0;
  const isLast  = index === total - 1 && total > 1;
  const color   = isFirst ? '#4de926' : isLast ? '#e33835' : '#ff922b';

  return (
    <Marker
      coordinate={{ latitude, longitude }}
      anchor={{ x: 0.5, y: 1 }}
      tracksViewChanges={tracks}
      onPress={(e) => { e.stopPropagation(); onRemove(id); }}
      onCalloutPress={() => onRemove(id)}
      zIndex={200 + index}
      title={label}
      description="🗑️ Dotknij aby usunąć"
    >
      <View style={{ alignItems: 'center' }}>
        {/* Etykieta */}
        <View style={{
          backgroundColor: '#0a0a0af5',
          borderRadius: 7,
          paddingHorizontal: 8, paddingVertical: 4,
          marginBottom: 3,
          borderWidth: 1.5, borderColor: color,
          minWidth: 56, alignItems: 'center',
        }}>
          <Text style={{
            color, fontSize: 8, fontWeight: '800',
            letterSpacing: 1,
          }}>
            {label.toUpperCase()}
          </Text>
          <Text style={{ color: '#ffffff55', fontSize: 6, marginTop: 1 }}>
            TAP TO REMOVE
          </Text>
        </View>

        {/* Kółko z numerem */}
        <View style={{
          width: 34, height: 34, borderRadius: 17,
          backgroundColor: color,
          justifyContent: 'center', alignItems: 'center',
          borderWidth: 3, borderColor: '#000',
          elevation: 6,
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
          borderLeftColor: 'transparent',
          borderRightColor: 'transparent',
          borderTopColor: color,
          marginTop: -1,
        }} />
      </View>
    </Marker>
  );
};