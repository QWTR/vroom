import React, { useState } from 'react';
import {
  Modal, View, Text, TouchableOpacity, StyleSheet,
  FlatList, ActivityIndicator,
} from 'react-native';
import { MaterialIcons, MaterialCommunityIcons } from '@expo/vector-icons';
import type { MyRoute } from '../../hooks/useMyRoutes';
import { RouteMiniMap }   from '../profile/RouteMiniMap';
import { Dimensions }     from 'react-native';
const modalCardWidth = Dimensions.get('window').width - 32 - 32;

interface Props {
  visible:    boolean;
  routes:     MyRoute[];
  onClose:    () => void;
  onNavigate: (route: MyRoute) => void;
  onShare:    (route: MyRoute) => void;
  onDelete:   (id: number) => void;
  isOwner:    boolean;
}

export function RoutesListModal({
  visible, routes, onClose, onNavigate, onShare, onDelete, isOwner,
}: Props) {
  const [deleting, setDeleting] = useState<number | null>(null);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={s.overlay}>
        <View style={s.sheet}>
          <View style={s.handle} />

          {/* Nagłówek */}
          <View style={s.header}>
            <MaterialCommunityIcons name="map-marker-path" size={20} color="#e33835" />
            <Text style={s.title}>WSZYSTKIE TRASY</Text>
            <View style={s.countBadge}>
              <Text style={s.countText}>{routes.length}</Text>
            </View>
            <TouchableOpacity onPress={onClose} style={s.closeBtn}>
              <MaterialIcons name="close" size={20} color="#ffffff60" />
            </TouchableOpacity>
          </View>

          <FlatList
            data={routes}
            keyExtractor={r => String(r.id)}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: 40, paddingTop: 8 }}
            renderItem={({ item: route }) => (
              <View style={s.card}>
                <View style={s.miniMapWrap}>
                    <RouteMiniMap
                    points={route.points}
                    width={modalCardWidth}
                    height={125}
                    />
                </View>
                {/* Nazwa + badge */}
                <View style={s.cardTop}>
                    
                    <View style={s.cardIconWrap}>
                        <MaterialCommunityIcons name="map-marker-path" size={16} color="#e33835" />
                    </View>
                    <View style={{ flex: 1 }}>
                        <Text style={s.cardName} numberOfLines={1}>{route.name}</Text>
                        {!!route.description && (
                        <Text style={s.cardDesc} numberOfLines={1}>{route.description}</Text>
                        )}
                    </View>
                    <View style={[s.badge, route.isPublic ? s.badgePublic : s.badgePrivate]}>
                        <MaterialIcons
                        name={route.isPublic ? 'public' : 'lock'}
                        size={9}
                        color={route.isPublic ? '#4de926' : '#ffffff40'}
                        />
                    </View>
                </View>

                {/* Statsy */}
                <View style={s.statsRow}>
                  <View style={s.stat}>
                    <MaterialIcons name="straighten" size={12} color="#e33835" />
                    <Text style={s.statTxt}>{route.distance.toFixed(1)} km</Text>
                  </View>
                  <View style={s.stat}>
                    <MaterialIcons name="place" size={12} color="#ffffff40" />
                    <Text style={s.statTxt}>{route.points.length} pkt</Text>
                  </View>
                  <View style={s.stat}>
                    <MaterialIcons name="favorite" size={12} color="#ffffff40" />
                    <Text style={s.statTxt}>{route._count?.likes ?? 0}</Text>
                  </View>
                  <Text style={s.dateText}>
                    {new Date(route.createdAt).toLocaleDateString('pl-PL', { day: '2-digit', month: 'short' })}
                  </Text>
                </View>

                {/* Przyciski akcji */}
                <View style={s.actions}>
                  {/* Nawiguj */}
                  <TouchableOpacity
                    style={s.navBtn}
                    onPress={() => { onClose(); onNavigate(route); }}
                    activeOpacity={0.8}
                  >
                    <MaterialIcons name="navigation" size={14} color="#fff" />
                    <Text style={s.navBtnTxt}>NAWIGUJ</Text>
                  </TouchableOpacity>

                  {/* Wyślij do znajomego */}
                  <TouchableOpacity
                    style={s.shareBtn}
                    onPress={() => onShare(route)}
                    activeOpacity={0.8}
                  >
                    <MaterialIcons name="share" size={14} color="#00bfff" />
                    <Text style={s.shareBtnTxt}>WYŚLIJ</Text>
                  </TouchableOpacity>

                  {/* Usuń */}
                  {isOwner && (
                    <TouchableOpacity
                      style={s.deleteBtn}
                      onPress={() => { setDeleting(route.id); onDelete(route.id); }}
                      disabled={deleting === route.id}
                      activeOpacity={0.8}
                    >
                      {deleting === route.id
                        ? <ActivityIndicator size={12} color="#e33835" />
                        : <MaterialIcons name="delete-outline" size={14} color="#e33835" />
                      }
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            )}
          />
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
    miniMapWrap: {
    backgroundColor: '#0a0a0a',
    borderRadius: 10,
    overflow: 'hidden',
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#ffffff08',
    },
  overlay:      { flex: 1, backgroundColor: '#000000aa', justifyContent: 'flex-end' },
  sheet:        { backgroundColor: '#111', borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '88%', borderTopWidth: 1, borderColor: '#ffffff12', paddingHorizontal: 16 },
  handle:       { width: 40, height: 4, backgroundColor: '#ffffff20', borderRadius: 2, alignSelf: 'center', marginTop: 12, marginBottom: 8 },
  header:       { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, borderBottomWidth: 1, borderColor: '#ffffff08', marginBottom: 4 },
  title:        { fontFamily: 'Orbitron', fontSize: 13, color: '#fff', letterSpacing: 2, flex: 1 },
  countBadge:   { backgroundColor: '#e3383525', borderRadius: 12, paddingHorizontal: 10, paddingVertical: 3, borderWidth: 1, borderColor: '#e3383540' },
  countText:    { fontFamily: 'Orbitron', fontSize: 10, color: '#e33835' },
  closeBtn:     { padding: 4 },

  card:         { backgroundColor: '#1a1a1a', borderRadius: 14, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: '#ffffff0e' },
  cardTop:      { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  cardIconWrap: { width: 32, height: 32, borderRadius: 9, backgroundColor: '#e3383518', justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: '#e3383530' },
  cardName:     { fontFamily: 'Orbitron', fontSize: 12, color: '#fff', fontWeight: '700' },
  cardDesc:     { fontFamily: 'Orbitron', fontSize: 8, color: '#ffffff50', marginTop: 2 },
  badge:        { width: 24, height: 24, borderRadius: 12, justifyContent: 'center', alignItems: 'center', borderWidth: 1 },
  badgePublic:  { backgroundColor: '#4de92612', borderColor: '#4de92630' },
  badgePrivate: { backgroundColor: '#ffffff08', borderColor: '#ffffff15' },

  statsRow:     { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 12 },
  stat:         { flexDirection: 'row', alignItems: 'center', gap: 4 },
  statTxt:      { fontFamily: 'Orbitron', fontSize: 9, color: '#ffffff60' },
  dateText:     { fontFamily: 'Orbitron', fontSize: 8, color: '#ffffff30', marginLeft: 'auto' },

  actions:      { flexDirection: 'row', gap: 8 },
  navBtn:       { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: '#e33835', borderRadius: 10, paddingVertical: 10 },
  navBtnTxt:    { fontFamily: 'Orbitron', fontSize: 9, color: '#fff', fontWeight: '700', letterSpacing: 1 },
  shareBtn:     { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10, backgroundColor: '#00bfff15', borderWidth: 1, borderColor: '#00bfff30' },
  shareBtnTxt:  { fontFamily: 'Orbitron', fontSize: 9, color: '#00bfff' },
  deleteBtn:    { width: 38, height: 38, borderRadius: 10, backgroundColor: '#e3383515', borderWidth: 1, borderColor: '#e3383530', justifyContent: 'center', alignItems: 'center' },
});