import React, { useState } from 'react';
import { View, Text, TouchableOpacity, Alert } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { Feather }       from '@expo/vector-icons';
import { RouteMiniMap }  from './RouteMiniMap';
import type { MyRoute }  from '../../hooks/useMyRoutes';
import { useTheme }      from '../../contexts/ThemeContext';

interface Props {
  route:          MyRoute;
  isOwner:        boolean;
  onDelete:       (id: number) => void;
  onNavigate:     (route: MyRoute) => void;
  onShare?:       (route: MyRoute) => void;
  onLeaderboard?: (route: MyRoute) => void;
}

export default function RouteCard({ route, isOwner, onDelete, onNavigate, onShare, onLeaderboard }: Props) {
  const { theme } = useTheme();
  const [deleting, setDeleting] = useState(false);

  const date = new Date(route.createdAt).toLocaleDateString('pl-PL', { day: '2-digit', month: 'short', year: 'numeric' });

  const handleDelete = () => {
    Alert.alert('Usuń trasę', `Czy na pewno chcesz usunąć "${route.name}"?`, [
      { text: 'Anuluj', style: 'cancel' },
      { text: 'Usuń', style: 'destructive', onPress: () => { setDeleting(true); onDelete(route.id); } },
    ]);
  };

  return (
    <View style={[{ backgroundColor: theme.surface3, borderRadius: 14, padding: 12, marginBottom: 10, borderWidth: 1, borderColor: theme.border }, deleting && { opacity: 0.4 }]}>
      <View style={{ flexDirection: 'row', gap: 12, marginBottom: 10 }}>
        <View style={{ backgroundColor: theme.bg, borderRadius: 10, overflow: 'hidden', borderWidth: 1, borderColor: theme.border }}>
          <RouteMiniMap points={route.points} width={110} height={70} />
        </View>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 }}>
            <Text style={{ fontFamily: 'Orbitron', fontSize: 11, color: theme.text, fontWeight: '700', flex: 1 }} numberOfLines={1}>{route.name}</Text>
            <View style={{
              flexDirection: 'row', alignItems: 'center', gap: 3,
              paddingHorizontal: 6, paddingVertical: 3, borderRadius: 8, borderWidth: 1,
              backgroundColor: route.isPublic ? '#4de92612' : theme.border,
              borderColor:     route.isPublic ? '#4de92630' : theme.border2,
            }}>
              <MaterialIcons name={route.isPublic ? 'public' : 'lock'} size={9} color={route.isPublic ? '#4de926' : theme.textDim} />
              <Text style={{ fontFamily: 'Orbitron', fontSize: 7, letterSpacing: 0.5, color: route.isPublic ? '#4de926' : theme.textDim }}>
                {route.isPublic ? 'PUB' : 'PRV'}
              </Text>
            </View>
          </View>
          {!!route.description && (
            <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: theme.textDim, marginBottom: 6 }} numberOfLines={1}>{route.description}</Text>
          )}
          <View style={{ flexDirection: 'row', gap: 10, marginBottom: 4 }}>
            {[
              { icon: 'straighten', color: theme.primary, val: `${route.distance.toFixed(1)} km` },
              { icon: 'place',      color: theme.textDim,  val: `${route.points.length} pkt` },
              { icon: 'favorite',   color: theme.textDim,  val: String(route._count?.likes ?? 0) },
            ].map(s => (
              <View key={s.icon} style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                <MaterialIcons name={s.icon as any} size={11} color={s.color} />
                <Text style={{ fontFamily: 'Orbitron', fontSize: 9, color: theme.textDim }}>{s.val}</Text>
              </View>
            ))}
          </View>
          <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: theme.textFaint }}>{date}</Text>
        </View>
      </View>

      {/* Akcje */}
      <View style={{ flexDirection: 'row', gap: 8, borderTopWidth: 1, borderColor: theme.border, paddingTop: 10 }}>
        {onLeaderboard && (
          <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 9, borderRadius: 10, backgroundColor: '#FFD70012', borderWidth: 1, borderColor: '#FFD70030' }} onPress={() => onLeaderboard(route)} activeOpacity={0.8}>
            <MaterialIcons name="leaderboard" size={13} color="#FFD700" />
            <Text style={{ fontFamily: 'Orbitron', fontSize: 9, color: '#FFD700', fontWeight: '700' }}>TOP</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: theme.primary, borderRadius: 10, paddingVertical: 9 }} onPress={() => onNavigate(route)} activeOpacity={0.8}>
          <MaterialIcons name="navigation" size={13} color="#fff" />
          <Text style={{ fontFamily: 'Orbitron', fontSize: 9, color: '#fff', fontWeight: '700', letterSpacing: 1 }}>NAWIGUJ</Text>
        </TouchableOpacity>
        {onShare && (
          <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 10, backgroundColor: '#00bfff12', borderWidth: 1, borderColor: '#00bfff30' }} onPress={() => onShare(route)} activeOpacity={0.8}>
            <Feather name="send" size={13} color="#00bfff" />
            <Text style={{ fontFamily: 'Orbitron', fontSize: 9, color: '#00bfff' }}>WYŚLIJ</Text>
          </TouchableOpacity>
        )}
        {isOwner && (
          <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 10, backgroundColor: theme.primaryBg, borderWidth: 1, borderColor: theme.primaryBorder }} onPress={handleDelete} disabled={deleting} activeOpacity={0.8}>
            <MaterialIcons name="delete-outline" size={14} color={theme.primary} />
            <Text style={{ fontFamily: 'Orbitron', fontSize: 9, color: theme.primary }}>USUŃ</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}