import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { MaterialIcons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '../../contexts/ThemeContext';
import { RouteMiniMap } from '../profile/RouteMiniMap';

interface RouteData {
  type:     'route';
  routeId:  number;
  name:     string;
  distance: number;
  points:   { latitude: number; longitude: number }[];
  isPublic: boolean;
}

interface Props {
  data:       RouteData;
  isMe:       boolean;
  onNavigate: (data: RouteData) => void;
}

export function RouteMessageCard({ data, isMe, onNavigate }: Props) {
  const { theme } = useTheme();

  return (
    <View style={{
      borderRadius: 14, overflow: 'hidden', borderWidth: 1, marginBottom: 2, width: 220,
      backgroundColor: isMe ? '#c42e2b' : theme.surface3,
      borderColor:     isMe ? '#e3383540' : theme.border,
    }}>
      {/* Nagłówek */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, padding: 10, paddingBottom: 6 }}>
        <MaterialCommunityIcons name="map-marker-path" size={14} color={theme.primary} />
        <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: isMe ? '#ffffff80' : theme.textDim, letterSpacing: 2, flex: 1 }}>TRASA</Text>
        <View style={[{ width: 20, height: 20, borderRadius: 10, justifyContent: 'center', alignItems: 'center', borderWidth: 1 },
          data.isPublic ? { backgroundColor: '#4de92612', borderColor: '#4de92630' } : { backgroundColor: theme.surface4, borderColor: theme.border2 }]}>
          <MaterialIcons name={data.isPublic ? 'public' : 'lock'} size={9} color={data.isPublic ? '#4de926' : theme.textDim} />
        </View>
      </View>

      {/* Minimap */}
      <View style={{ marginHorizontal: 8, borderRadius: 8, overflow: 'hidden', backgroundColor: '#0a0a0a', borderWidth: 1, borderColor: theme.border }}>
        <RouteMiniMap points={data.points} width={200} height={90} />
      </View>

      {/* Info */}
      <Text style={{ fontFamily: 'Orbitron', fontSize: 11, color: '#fff', fontWeight: '700', marginHorizontal: 10, marginTop: 8 }} numberOfLines={1}>{data.name}</Text>
      <View style={{ flexDirection: 'row', gap: 12, marginHorizontal: 10, marginTop: 4, marginBottom: 8 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
          <MaterialIcons name="straighten" size={11} color={theme.primary} />
          <Text style={{ fontFamily: 'Orbitron', fontSize: 9, color: isMe ? '#ffffff80' : theme.textDim }}>{data.distance.toFixed(1)} km</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
          <MaterialIcons name="place" size={11} color={isMe ? '#ffffff40' : theme.textDim} />
          <Text style={{ fontFamily: 'Orbitron', fontSize: 9, color: isMe ? '#ffffff60' : theme.textDim }}>{data.points.length} pkt</Text>
        </View>
      </View>

      {/* Nawiguj */}
      <TouchableOpacity
        style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: theme.primary, margin: 8, marginTop: 0, borderRadius: 10, paddingVertical: 9 }}
        onPress={() => onNavigate(data)} activeOpacity={0.8}
      >
        <MaterialIcons name="navigation" size={13} color="#fff" />
        <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: '#fff', fontWeight: '700', letterSpacing: 0.5 }}>NAWIGUJ PO TEJ TRASIE</Text>
      </TouchableOpacity>
    </View>
  );
}