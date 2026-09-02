import React, { useState } from 'react';
import { View, TouchableOpacity, Modal, ScrollView, Platform } from 'react-native';
import { AppText as Text } from '../ui/AppText';
import { MaterialIcons, MaterialCommunityIcons, Feather } from '@expo/vector-icons';
import { RouteMiniMap }   from './RouteMiniMap';
import { ShareRouteModal } from '../modals/ShareRouteModal';
import type { ParticipatedRoute } from '../../hooks/useParticipatedRoutes';
import { useTheme } from '../../contexts/ThemeContext';

function formatTime(s: number) {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
  return `${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
}

interface Props {
  routes:        ParticipatedRoute[];
  myId:          number | null;
  onNavigate:    (r: ParticipatedRoute) => void;
  onLeaderboard: (r: ParticipatedRoute) => void;
}

function RouteRow({ route, onNavigate, onLeaderboard, onShare, onClose }: {
  route:         ParticipatedRoute;
  onNavigate:    (r: ParticipatedRoute) => void;
  onLeaderboard: (r: ParticipatedRoute) => void;
  onShare:       (r: ParticipatedRoute) => void;
  onClose:       () => void;
}) {
  const { theme } = useTheme();
  const posColor = route.myPosition === 1 ? '#FFD700'
    : route.myPosition === 2 ? '#C0C0C0'
    : route.myPosition === 3 ? '#CD7F32'
    : theme.textDim;

  return (
    <View style={{ backgroundColor: theme.surface2, borderRadius: 14, borderWidth: 1, borderColor: theme.border, padding: 12, marginBottom: 10, flexDirection: 'row', gap: 10 }}>
      <View style={{ backgroundColor: theme.bg, borderRadius: 10, overflow: 'hidden', borderWidth: 1, borderColor: theme.border2 }}>
        <RouteMiniMap points={route.points} width={90} height={60} />
      </View>
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 }}>
          <Text style={{ fontFamily: 'Manrope_600SemiBold', fontSize: 12, color: theme.text, fontWeight: '700', flex: 1 }} numberOfLines={1}>{route.name}</Text>
          {route.isOwn && (
            <View style={{ backgroundColor: theme.primaryBg, borderRadius: 6, borderWidth: 1, borderColor: theme.primaryBorder, paddingHorizontal: 5, paddingVertical: 2 }}>
              <Text style={{ fontFamily: 'Manrope_600SemiBold', fontSize: 12, color: theme.primary }}>MOJA</Text>
            </View>
          )}
        </View>
        {route.author && !route.isOwn && (
          <Text style={{ fontFamily: 'Manrope_600SemiBold', fontSize: 12, color: theme.textFaint, marginBottom: 4 }} numberOfLines={1}>autor: {route.author.username}</Text>
        )}
        <View style={{ flexDirection: 'row', gap: 10, marginBottom: 4 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
            <MaterialIcons name="straighten" size={9} color={theme.primary} />
            <Text style={{ fontFamily: 'Manrope_600SemiBold', fontSize: 12, color: theme.textDim }}>{route.distance.toFixed(1)} km</Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
            <MaterialIcons name="replay" size={9} color={theme.textDim} />
            <Text style={{ fontFamily: 'Manrope_600SemiBold', fontSize: 12, color: theme.textDim }}>{route.totalRuns} przej.</Text>
          </View>
        </View>
        {route.myBestTime != null && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <MaterialIcons name="emoji-events" size={10} color={posColor} />
            <Text style={{ fontFamily: 'Manrope_600SemiBold', fontSize: 12, fontWeight: '700', color: posColor }}>#{route.myPosition}</Text>
            <Text style={{ fontFamily: 'Manrope_600SemiBold', fontSize: 12, color: theme.text, fontWeight: '700' }}>{formatTime(route.myBestTime)}</Text>
            <Text style={{ fontFamily: 'Manrope_600SemiBold', fontSize: 12, color: theme.textFaint }}>/ {route.totalRunners}</Text>
          </View>
        )}
      </View>
      <View style={{ justifyContent: 'space-between', gap: 5 }}>
        <TouchableOpacity style={{ backgroundColor: theme.surface4, borderRadius: 10, borderWidth: 1, borderColor: theme.border2, padding: 8, alignItems: 'center', justifyContent: 'center' }} onPress={() => { onClose(); setTimeout(() => onLeaderboard(route), 300); }} activeOpacity={0.8}>
          <MaterialIcons name="leaderboard" size={13} color="#FFD700" />
        </TouchableOpacity>
        <TouchableOpacity style={{ backgroundColor: theme.surface4, borderRadius: 10, borderWidth: 1, borderColor: theme.border2, padding: 8, alignItems: 'center', justifyContent: 'center' }} onPress={() => onShare(route)} activeOpacity={0.8}>
          <Feather name="send" size={13} color="#00bfff" />
        </TouchableOpacity>
        <TouchableOpacity style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, backgroundColor: theme.primary, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 7 }} onPress={() => { onClose(); onNavigate(route); }} activeOpacity={0.8}>
          <MaterialIcons name="navigation" size={12} color="#fff" />
          <Text style={{ fontFamily: 'Manrope_600SemiBold', fontSize: 12, color: '#fff', fontWeight: '700' }}>NAWIGUJ</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

export default function ParticipatedRoutesSection({ routes = [], myId, onNavigate, onLeaderboard }: Props) {
  const { theme } = useTheme();
  const [modalVisible, setModalVisible] = useState(false);
  const [shareRoute,   setShareRoute]   = useState<ParticipatedRoute | null>(null);

  if (routes.length === 0) return null;

  return (
    <>
      <TouchableOpacity
        style={{ marginVertical: 4, paddingVertical: 12, paddingHorizontal: 16, backgroundColor: theme.surface3, borderRadius: 12, borderWidth: 1, borderColor: theme.primaryBorder, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}
        onPress={() => setModalVisible(true)} activeOpacity={0.8}
      >
        <MaterialCommunityIcons name="map-marker-path" size={14} color={theme.primary} style={{ marginRight: 6 }} />
        <Text style={{ fontFamily: 'Manrope_600SemiBold', color: theme.primary, fontSize: 12, letterSpacing: 0.5 }}>PRZEJECHANE TRASY ({routes.length})</Text>
      </TouchableOpacity>

      <Modal visible={modalVisible} transparent animationType="slide" onRequestClose={() => setModalVisible(false)} statusBarTranslucent>
        <View style={{ flex: 1, backgroundColor: theme.overlay, justifyContent: 'flex-end' }}>
          <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={() => setModalVisible(false)} />
          <View style={{ height: '85%', backgroundColor: theme.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, borderTopWidth: 1, borderLeftWidth: 1, borderRightWidth: 1, borderColor: theme.border2, paddingBottom: Platform.OS === 'ios' ? 34 : 16, overflow: 'hidden' }}>
            <View style={{ width: 40, height: 4, backgroundColor: theme.border3, borderRadius: 2, alignSelf: 'center', marginTop: 12, marginBottom: 4 }} />
            <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, paddingTop: 12, paddingBottom: 14, borderBottomWidth: 1, borderColor: theme.border }}>
              <View style={{ backgroundColor: theme.primaryBg, borderRadius: 10, padding: 7, marginRight: 12, borderWidth: 1, borderColor: theme.primaryBorder }}>
                <MaterialCommunityIcons name="map-marker-path" size={18} color={theme.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: 'Manrope_600SemiBold', fontSize: 13, color: theme.text, fontWeight: '700', letterSpacing: 1 }}>PRZEJECHANE TRASY</Text>
                <Text style={{ fontFamily: 'Manrope_600SemiBold', fontSize: 12, color: theme.textDim, marginTop: 2 }}>{routes.length} tras</Text>
              </View>
              <TouchableOpacity onPress={() => setModalVisible(false)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <MaterialIcons name="close" size={20} color={theme.textDim} />
              </TouchableOpacity>
            </View>
            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 30, paddingTop: 8 }} showsVerticalScrollIndicator={false}>
              {routes.map(route => (
                <RouteRow key={route.id} route={route} onNavigate={onNavigate} onLeaderboard={onLeaderboard} onShare={r => setShareRoute(r)} onClose={() => setModalVisible(false)} />
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>

      <ShareRouteModal visible={shareRoute !== null} route={shareRoute} onClose={() => setShareRoute(null)} onSent={() => setShareRoute(null)} myId={myId} />
    </>
  );
}