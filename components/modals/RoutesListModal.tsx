import React, { useState } from 'react';
import { Modal, View, TouchableOpacity, FlatList, ActivityIndicator, Dimensions, Share } from 'react-native';
import { AppText as Text } from '../ui/AppText';
import { MaterialIcons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import Toast from 'react-native-toast-message';
import { useTheme } from '../../contexts/ThemeContext';
import type { MyRoute } from '../../hooks/useMyRoutes';
import { RouteMiniMap } from '../profile/RouteMiniMap';

const GOLD = '#FFD700';
const modalCardWidth = Dimensions.get('window').width - 32 - 32;

interface Props {
  visible:       boolean;
  routes:        MyRoute[];
  onClose:       () => void;
  onNavigate:    (route: MyRoute) => void;
  onShare:       (route: MyRoute) => void;
  onDelete:      (id: number) => void;
  onLeaderboard: (route: MyRoute) => void;
  isOwner:       boolean;
  isPremium?:    boolean;
}

function buildGpx(route: MyRoute): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
  const trkpts = route.points
    .map(p => `      <trkpt lat="${p.latitude.toFixed(6)}" lon="${p.longitude.toFixed(6)}"></trkpt>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="VROOM">\n  <trk>\n    <name>${esc(route.name)}</name>\n    <trkseg>\n${trkpts}\n    </trkseg>\n  </trk>\n</gpx>`;
}

export function RoutesListModal({
  visible, routes, onClose, onNavigate, onShare, onDelete, onLeaderboard, isOwner, isPremium,
}: Props) {
  const { theme } = useTheme();
  const router    = useRouter();
  const [deleting, setDeleting] = useState<number | null>(null);

  const handleExportGpx = async (route: MyRoute) => {
    if (!isPremium) {
      router.push('/premium' as any);
      return;
    }
    try {
      await Share.share({ message: buildGpx(route), title: `${route.name}.gpx` });
    } catch {
      Toast.show({ type: 'error', text1: 'Błąd eksportu GPX' });
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: theme.overlay, justifyContent: 'flex-end' }}>
        <View style={{
          backgroundColor: theme.surface,
          borderTopLeftRadius: 24, borderTopRightRadius: 24,
          maxHeight: '88%',
          borderTopWidth: 1, borderColor: theme.border2,
          paddingHorizontal: 16,
        }}>
          <View style={{ width: 40, height: 4, backgroundColor: theme.border3, borderRadius: 2, alignSelf: 'center', marginTop: 12, marginBottom: 8 }} />

          {/* Nagłówek */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, borderBottomWidth: 1, borderColor: theme.border, marginBottom: 4 }}>
            <MaterialCommunityIcons name="map-marker-path" size={20} color={theme.primary} />
            <Text style={{ fontFamily: 'Manrope_600SemiBold', fontSize: 13, color: theme.text, letterSpacing: 1, flex: 1 }}>
              WSZYSTKIE TRASY
            </Text>
            <View style={{ backgroundColor: theme.primaryBg, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 3, borderWidth: 1, borderColor: theme.primaryBorder }}>
              <Text style={{ fontFamily: 'Manrope_600SemiBold', fontSize: 12, color: theme.primary }}>{routes.length}</Text>
            </View>
            <TouchableOpacity onPress={onClose} style={{ padding: 4 }}>
              <MaterialIcons name="close" size={20} color={theme.textDim} />
            </TouchableOpacity>
          </View>

          <FlatList
            data={routes}
            keyExtractor={r => String(r.id)}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: 40, paddingTop: 8 }}
            renderItem={({ item: route }) => (
              <View style={{
                backgroundColor: theme.surface2,
                borderRadius: 14, padding: 14, marginBottom: 10,
                borderWidth: 1, borderColor: theme.border2,
              }}>
                {/* Mini mapa */}
                <View style={{ backgroundColor: theme.bg, borderRadius: 10, overflow: 'hidden', marginBottom: 10, borderWidth: 1, borderColor: theme.border }}>
                  <RouteMiniMap points={route.points} width={modalCardWidth} height={125} />
                </View>

                {/* Nazwa + badge */}
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                  <View style={{ width: 32, height: 32, borderRadius: 9, backgroundColor: theme.primaryBg, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: theme.primaryBorder }}>
                    <MaterialCommunityIcons name="map-marker-path" size={16} color={theme.primary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontFamily: 'Manrope_600SemiBold', fontSize: 12, color: theme.text, fontWeight: '700' }} numberOfLines={1}>{route.name}</Text>
                    {!!route.description && (
                      <Text style={{ fontFamily: 'Manrope_600SemiBold', fontSize: 12, color: theme.textDim, marginTop: 2 }} numberOfLines={1}>{route.description}</Text>
                    )}
                  </View>
                  <View style={{
                    width: 24, height: 24, borderRadius: 12, justifyContent: 'center', alignItems: 'center', borderWidth: 1,
                    backgroundColor: route.isPublic ? '#4de92612' : theme.border,
                    borderColor:     route.isPublic ? '#4de92630' : theme.border2,
                  }}>
                    <MaterialIcons name={route.isPublic ? 'public' : 'lock'} size={9} color={route.isPublic ? '#4de926' : theme.textDim} />
                  </View>
                </View>

                {/* Statystyki */}
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 12 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                    <MaterialIcons name="straighten" size={12} color={theme.primary} />
                    <Text style={{ fontFamily: 'Manrope_600SemiBold', fontSize: 12, color: theme.textMuted }}>{route.distance.toFixed(1)} km</Text>
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                    <MaterialIcons name="place" size={12} color={theme.textDim} />
                    <Text style={{ fontFamily: 'Manrope_600SemiBold', fontSize: 12, color: theme.textMuted }}>{route.points.length} pkt</Text>
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                    <MaterialIcons name="favorite" size={12} color={theme.textDim} />
                    <Text style={{ fontFamily: 'Manrope_600SemiBold', fontSize: 12, color: theme.textMuted }}>{route._count?.likes ?? 0}</Text>
                  </View>
                  <Text style={{ fontFamily: 'Manrope_600SemiBold', fontSize: 12, color: theme.textDim, marginLeft: 'auto' }}>
                    {new Date(route.createdAt).toLocaleDateString('pl-PL', { day: '2-digit', month: 'short' })}
                  </Text>
                </View>

                {/* Akcje */}
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <TouchableOpacity
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 10, borderRadius: 10, backgroundColor: '#FFD70012', borderWidth: 1, borderColor: '#FFD70030' }}
                    onPress={() => onLeaderboard(route)} activeOpacity={0.8}
                  >
                    <MaterialIcons name="leaderboard" size={14} color="#FFD700" />
                    <Text style={{ fontFamily: 'Manrope_600SemiBold', fontSize: 12, color: '#FFD700', fontWeight: '700' }}>TOP</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: theme.primary, borderRadius: 10, paddingVertical: 10 }}
                    onPress={() => { onClose(); onNavigate(route); }} activeOpacity={0.8}
                  >
                    <MaterialIcons name="navigation" size={14} color="#fff" />
                    <Text style={{ fontFamily: 'Manrope_600SemiBold', fontSize: 12, color: '#fff', fontWeight: '700', letterSpacing: 1 }}>NAWIGUJ</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10, backgroundColor: '#00bfff15', borderWidth: 1, borderColor: '#00bfff30' }}
                    onPress={() => onShare(route)} activeOpacity={0.8}
                  >
                    <MaterialIcons name="share" size={14} color="#00bfff" />
                    <Text style={{ fontFamily: 'Manrope_600SemiBold', fontSize: 12, color: '#00bfff' }}>WYŚLIJ</Text>
                  </TouchableOpacity>

                  {isOwner && (
                    <TouchableOpacity
                      style={{ width: 38, height: 38, borderRadius: 10, backgroundColor: isPremium ? '#4de92615' : theme.surface, borderWidth: 1, borderColor: isPremium ? '#4de92630' : theme.border2, justifyContent: 'center', alignItems: 'center' }}
                      onPress={() => handleExportGpx(route)} activeOpacity={0.8}
                    >
                      {isPremium
                        ? <MaterialIcons name="file-download" size={14} color="#4de926" />
                        : <MaterialIcons name="lock" size={14} color={GOLD} />
                      }
                    </TouchableOpacity>
                  )}

                  {isOwner && (
                    <TouchableOpacity
                      style={{ width: 38, height: 38, borderRadius: 10, backgroundColor: theme.primaryBg, borderWidth: 1, borderColor: theme.primaryBorder, justifyContent: 'center', alignItems: 'center' }}
                      onPress={() => { setDeleting(route.id); onDelete(route.id); }}
                      disabled={deleting === route.id} activeOpacity={0.8}
                    >
                      {deleting === route.id
                        ? <ActivityIndicator size={12} color={theme.primary} />
                        : <MaterialIcons name="delete-outline" size={14} color={theme.primary} />
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