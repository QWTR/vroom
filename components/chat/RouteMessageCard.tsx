import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { MaterialIcons, MaterialCommunityIcons } from '@expo/vector-icons';
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
  return (
    <View style={[s.card, isMe ? s.cardMe : s.cardOther]}>
      {/* Nagłówek */}
      <View style={s.topRow}>
        <MaterialCommunityIcons name="map-marker-path" size={14} color="#e33835" />
        <Text style={s.label}>TRASA</Text>
        <View style={[s.badge, data.isPublic ? s.badgePub : s.badgePrv]}>
          <MaterialIcons
            name={data.isPublic ? 'public' : 'lock'}
            size={9}
            color={data.isPublic ? '#4de926' : '#ffffff50'}
          />
        </View>
      </View>

      {/* Minimap */}
      <View style={s.mapWrap}>
        <RouteMiniMap points={data.points} width={200} height={90} />
      </View>

      {/* Info */}
      <Text style={s.name} numberOfLines={1}>{data.name}</Text>
      <View style={s.statsRow}>
        <View style={s.stat}>
          <MaterialIcons name="straighten" size={11} color="#e33835" />
          <Text style={s.statTxt}>{data.distance.toFixed(1)} km</Text>
        </View>
        <View style={s.stat}>
          <MaterialIcons name="place" size={11} color="#ffffff40" />
          <Text style={s.statTxt}>{data.points.length} pkt</Text>
        </View>
      </View>

      {/* Przycisk nawiguj */}
      <TouchableOpacity
        style={s.navBtn}
        onPress={() => onNavigate(data)}
        activeOpacity={0.8}
      >
        <MaterialIcons name="navigation" size={13} color="#fff" />
        <Text style={s.navTxt}>NAWIGUJ PO TEJ TRASIE</Text>
      </TouchableOpacity>
    </View>
  );
}

const s = StyleSheet.create({
  card:      { borderRadius: 14, overflow: 'hidden', borderWidth: 1, marginBottom: 2, width: 220 },
  cardMe:    { backgroundColor: '#c42e2b', borderColor: '#e3383540' },
  cardOther: { backgroundColor: '#1c1c1c', borderColor: '#ffffff12' },

  topRow:    { flexDirection: 'row', alignItems: 'center', gap: 6, padding: 10, paddingBottom: 6 },
  label:     { fontFamily: 'Orbitron', fontSize: 8, color: '#ffffff80', letterSpacing: 2, flex: 1 },
  badge:     { width: 20, height: 20, borderRadius: 10, justifyContent: 'center', alignItems: 'center', borderWidth: 1 },
  badgePub:  { backgroundColor: '#4de92612', borderColor: '#4de92630' },
  badgePrv:  { backgroundColor: '#ffffff08', borderColor: '#ffffff15' },

  mapWrap:   { marginHorizontal: 8, borderRadius: 8, overflow: 'hidden', backgroundColor: '#0a0a0a', borderWidth: 1, borderColor: '#ffffff10' },

  name:      { fontFamily: 'Orbitron', fontSize: 11, color: '#fff', fontWeight: '700', marginHorizontal: 10, marginTop: 8 },
  statsRow:  { flexDirection: 'row', gap: 12, marginHorizontal: 10, marginTop: 4, marginBottom: 8 },
  stat:      { flexDirection: 'row', alignItems: 'center', gap: 3 },
  statTxt:   { fontFamily: 'Orbitron', fontSize: 9, color: '#ffffff60' },

  navBtn:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: '#e33835', margin: 8, marginTop: 0, borderRadius: 10, paddingVertical: 9 },
  navTxt:    { fontFamily: 'Orbitron', fontSize: 8, color: '#fff', fontWeight: '700', letterSpacing: 0.5 },
});