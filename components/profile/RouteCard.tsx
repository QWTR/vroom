import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Alert,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { Feather }       from '@expo/vector-icons';
import { RouteMiniMap }  from './RouteMiniMap';
import type { MyRoute }  from '../../hooks/useMyRoutes';

interface Props {
  route:      MyRoute;
  isOwner:    boolean;
  onDelete:   (id: number) => void;
  onNavigate: (route: MyRoute) => void;
  onShare?:   (route: MyRoute) => void;
}

export default function RouteCard({ route, isOwner, onDelete, onNavigate, onShare }: Props) {
  const [deleting, setDeleting] = useState(false);

  const date = new Date(route.createdAt).toLocaleDateString('pl-PL', {
    day: '2-digit', month: 'short', year: 'numeric',
  });

  const handleDelete = () => {
    Alert.alert(
      'Usuń trasę',
      `Czy na pewno chcesz usunąć "${route.name}"?`,
      [
        { text: 'Anuluj', style: 'cancel' },
        {
          text: 'Usuń',
          style: 'destructive',
          onPress: () => { setDeleting(true); onDelete(route.id); },
        },
      ],
    );
  };

  return (
    <View style={[s.card, deleting && { opacity: 0.4 }]}>
      <View style={s.mainRow}>

        {/* Mini podgląd trasy */}
        <View style={s.miniMapWrap}>
          <RouteMiniMap points={route.points} width={110} height={70} />
        </View>

        {/* Info */}
        <View style={{ flex: 1 }}>
          <View style={s.topRow}>
            <Text style={s.name} numberOfLines={1}>{route.name}</Text>
            <View style={[s.badge, route.isPublic ? s.badgePublic : s.badgePrivate]}>
              <MaterialIcons
                name={route.isPublic ? 'public' : 'lock'}
                size={9}
                color={route.isPublic ? '#4de926' : '#ffffff40'}
              />
              <Text style={[s.badgeTxt, { color: route.isPublic ? '#4de926' : '#ffffff40' }]}>
                {route.isPublic ? 'PUB' : 'PRV'}
              </Text>
            </View>
          </View>

          {!!route.description && (
            <Text style={s.desc} numberOfLines={1}>{route.description}</Text>
          )}

          <View style={s.statsRow}>
            <View style={s.stat}>
              <MaterialIcons name="straighten" size={11} color="#e33835" />
              <Text style={s.statTxt}>{route.distance.toFixed(1)} km</Text>
            </View>
            <View style={s.stat}>
              <MaterialIcons name="place" size={11} color="#ffffff40" />
              <Text style={s.statTxt}>{route.points.length} pkt</Text>
            </View>
            <View style={s.stat}>
              <MaterialIcons name="favorite" size={11} color="#ffffff40" />
              <Text style={s.statTxt}>{route._count?.likes ?? 0}</Text>
            </View>
          </View>

          <Text style={s.date}>{date}</Text>
        </View>
      </View>

      {/* Przyciski */}
      <View style={s.actions}>
        {/* Nawiguj */}
        <TouchableOpacity
          style={s.navBtn}
          onPress={() => onNavigate(route)}
          activeOpacity={0.8}
        >
          <MaterialIcons name="navigation" size={13} color="#fff" />
          <Text style={s.navTxt}>NAWIGUJ</Text>
        </TouchableOpacity>

        {/* Wyślij */}
        {onShare && (
          <TouchableOpacity
            style={s.shareBtn}
            onPress={() => onShare(route)}
            activeOpacity={0.8}
          >
            <Feather name="send" size={13} color="#00bfff" />
            <Text style={s.shareTxt}>WYŚLIJ</Text>
          </TouchableOpacity>
        )}

        {/* Usuń */}
        {isOwner && (
          <TouchableOpacity
            style={s.delBtn}
            onPress={handleDelete}
            disabled={deleting}
            activeOpacity={0.8}
          >
            <MaterialIcons name="delete-outline" size={14} color="#e33835" />
            <Text style={s.delTxt}>USUŃ</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  card:        { backgroundColor: '#1a1a1a', borderRadius: 14, padding: 12, marginBottom: 10, borderWidth: 1, borderColor: '#ffffff0e' },
  mainRow:     { flexDirection: 'row', gap: 12, marginBottom: 10 },
  miniMapWrap: { backgroundColor: '#0a0a0a', borderRadius: 10, overflow: 'hidden', borderWidth: 1, borderColor: '#ffffff10' },

  topRow:      { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  name:        { fontFamily: 'Orbitron', fontSize: 11, color: '#fff', fontWeight: '700', flex: 1 },
  badge:       { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 6, paddingVertical: 3, borderRadius: 8, borderWidth: 1 },
  badgePublic: { backgroundColor: '#4de92612', borderColor: '#4de92630' },
  badgePrivate:{ backgroundColor: '#ffffff08', borderColor: '#ffffff15' },
  badgeTxt:    { fontFamily: 'Orbitron', fontSize: 7, letterSpacing: 0.5 },
  desc:        { fontFamily: 'Orbitron', fontSize: 8, color: '#ffffff50', marginBottom: 6 },
  statsRow:    { flexDirection: 'row', gap: 10, marginBottom: 4 },
  stat:        { flexDirection: 'row', alignItems: 'center', gap: 3 },
  statTxt:     { fontFamily: 'Orbitron', fontSize: 9, color: '#ffffff60' },
  date:        { fontFamily: 'Orbitron', fontSize: 8, color: '#ffffff30' },

  actions:     { flexDirection: 'row', gap: 8, borderTopWidth: 1, borderColor: '#ffffff08', paddingTop: 10 },

  navBtn:      { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: '#e33835', borderRadius: 10, paddingVertical: 9 },
  navTxt:      { fontFamily: 'Orbitron', fontSize: 9, color: '#fff', fontWeight: '700', letterSpacing: 1 },

  shareBtn:    { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 10, backgroundColor: '#00bfff12', borderWidth: 1, borderColor: '#00bfff30' },
  shareTxt:    { fontFamily: 'Orbitron', fontSize: 9, color: '#00bfff' },

  delBtn:      { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 10, backgroundColor: '#e3383515', borderWidth: 1, borderColor: '#e3383530' },
  delTxt:      { fontFamily: 'Orbitron', fontSize: 9, color: '#e33835' },
});