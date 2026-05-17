import React from 'react';
import { View, Text, TouchableOpacity, FlatList, RefreshControl } from 'react-native';
import { formatDistanceToNow } from 'date-fns';
import { pl }                  from 'date-fns/locale';
import { useTheme }            from '../../../contexts/ThemeContext';
import { RouteMiniMap }        from '../../../components/profile/RouteMiniMap';
import MaterialIcons           from '@expo/vector-icons/MaterialIcons';
import MaterialCommunityIcons  from '@expo/vector-icons/MaterialCommunityIcons';
import {
  type PublicRoute,
  Avatar, StatPill, ListFooter,
} from './communityShared';

// ─────────────────────────────────────────────────────────
// ROUTE CARD
// ─────────────────────────────────────────────────────────
const RouteCard = React.memo(({
  route, myId, onLike, onNavigate, onShare, onLeaderboard, onProfile,
}: {
  route: PublicRoute; myId: number | null;
  onLike: (id: number) => void;
  onNavigate: (r: PublicRoute) => void;
  onShare: (r: PublicRoute) => void;
  onLeaderboard: (r: PublicRoute) => void;
  onProfile: (id: number) => void;
}) => {
  const { theme } = useTheme();
  const time = formatDistanceToNow(new Date(route.createdAt), { addSuffix: true, locale: pl });
  const points = route.points ?? [];

  return (
    <View style={{
      marginHorizontal: 12, marginBottom: 12,
      backgroundColor: theme.surface,
      borderRadius: 20, borderWidth: 1, borderColor: theme.border2,
      overflow: 'hidden',
    }}>
      {/* Header */}
      <View style={{ flexDirection: 'row', alignItems: 'center', padding: 14, paddingBottom: 10 }}>
        <TouchableOpacity onPress={() => onProfile(route.author.id)}>
          <Avatar user={route.author} size={38} />
        </TouchableOpacity>
        <View style={{ flex: 1, marginLeft: 10 }}>
          <Text style={{ fontFamily: 'Orbitron', fontSize: 11, color: theme.text, fontWeight: '700' }}>{route.author.username}</Text>
          <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: theme.textDim, marginTop: 2 }}>{time}</Text>
        </View>
        <TouchableOpacity
          style={{
            flexDirection: 'row', alignItems: 'center', gap: 5,
            backgroundColor: '#00bfff12', borderRadius: 10,
            borderWidth: 1, borderColor: '#00bfff30',
            paddingHorizontal: 10, paddingVertical: 7,
          }}
          onPress={() => onShare(route)}
        >
          <MaterialIcons name="send" size={13} color="#00bfff" />
          <Text style={{ fontFamily: 'Orbitron', fontSize: 9, color: '#00bfff', fontWeight: '700' }}>WYŚLIJ</Text>
        </TouchableOpacity>
      </View>

      {/* Mapa + info */}
      <TouchableOpacity
        style={{ flexDirection: 'row', gap: 12, paddingHorizontal: 14, paddingBottom: 12 }}
        onPress={() => onLeaderboard(route)}
        activeOpacity={0.88}
      >
        <View style={{ borderRadius: 12, overflow: 'hidden', borderWidth: 1, borderColor: theme.border }}>
          <RouteMiniMap points={points} width={100} height={70} />
        </View>
        <View style={{ flex: 1, justifyContent: 'center' }}>
          <Text style={{ fontFamily: 'Orbitron', fontSize: 13, color: theme.text, fontWeight: '700', marginBottom: 4 }} numberOfLines={1}>
            {route.name}
          </Text>
          {!!route.description && (
            <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: theme.textDim, marginBottom: 6, lineHeight: 13 }} numberOfLines={2}>
              {route.description}
            </Text>
          )}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <StatPill icon="straighten" value={`${route.distance.toFixed(1)} km`} color="#e33835" />
            <StatPill icon="place" value={`${points.length} pkt`} />
            {!!route.runsCount && route.runsCount > 0 && (
              <StatPill icon="replay" value={`${route.runsCount} przej.`} />
            )}
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6 }}>
            <MaterialIcons name="leaderboard" size={9} color="#FFD70060" />
            <Text style={{ fontFamily: 'Orbitron', fontSize: 7, color: '#FFD70060' }}>DOTKNIJ → RANKING</Text>
          </View>
        </View>
      </TouchableOpacity>

      {/* Footer */}
      <View style={{
        flexDirection: 'row', alignItems: 'center', gap: 8,
        paddingHorizontal: 14, paddingBottom: 12, paddingTop: 8,
        borderTopWidth: 1, borderTopColor: theme.border,
      }}>
        <TouchableOpacity
          style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}
          onPress={() => onLike(route.id)}
        >
          <MaterialCommunityIcons
            name={route.isLiked ? 'heart' : 'heart-outline'}
            size={18} color={route.isLiked ? '#e33835' : theme.textDim}
          />
          <Text style={{ fontFamily: 'Orbitron', fontSize: 11, color: route.isLiked ? '#e33835' : theme.textDim }}>
            {route.likesCount}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={{
            flexDirection: 'row', alignItems: 'center', gap: 5,
            backgroundColor: '#FFD70015', borderRadius: 10,
            borderWidth: 1, borderColor: '#FFD70030',
            paddingHorizontal: 12, paddingVertical: 8,
          }}
          onPress={() => onLeaderboard(route)}
        >
          <MaterialIcons name="leaderboard" size={13} color="#FFD700" />
          <Text style={{ fontFamily: 'Orbitron', fontSize: 9, color: '#FFD700', fontWeight: '700' }}>TOP</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={{
            flex: 1, flexDirection: 'row', alignItems: 'center',
            justifyContent: 'center', gap: 6,
            backgroundColor: '#e33835', borderRadius: 10, paddingVertical: 9,
          }}
          onPress={() => onNavigate(route)}
        >
          <MaterialIcons name="navigation" size={14} color="#fff" />
          <Text style={{ fontFamily: 'Orbitron', fontSize: 9, color: '#fff', fontWeight: '700' }}>NAWIGUJ</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
});
RouteCard.displayName = 'RouteCard';

// ─────────────────────────────────────────────────────────
// TAB TRASY
// ─────────────────────────────────────────────────────────
export function TabTrasy({ routes, myId, loadingMoreR, refreshingR, hasMoreR,
  onLike, onNavigate, onShare, onLeaderboard, onProfile, onRefresh, onLoadMore, bottomInset }: {
  routes: PublicRoute[];
  myId: number | null;
  loadingMoreR: boolean;
  refreshingR: boolean;
  hasMoreR: boolean;
  onLike: (id: number) => void;
  onNavigate: (r: PublicRoute) => void;
  onShare: (r: PublicRoute) => void;
  onLeaderboard: (r: PublicRoute) => void;
  onProfile: (id: number) => void;
  onRefresh: () => void;
  onLoadMore: () => void;
  bottomInset: number;
}) {
  return (
    <FlatList
      data={routes}
      keyExtractor={r => String(r.id)}
      renderItem={({ item }) => <RouteCard route={item} myId={myId} onLike={onLike}
        onNavigate={onNavigate} onShare={onShare} onLeaderboard={onLeaderboard} onProfile={onProfile} />}
      refreshControl={<RefreshControl refreshing={refreshingR} onRefresh={onRefresh} tintColor="#e33835" />}
      onEndReached={onLoadMore}
      onEndReachedThreshold={0.4}
      ListFooterComponent={<ListFooter loading={loadingMoreR} />}
      contentContainerStyle={{ paddingTop: 8, paddingBottom: Math.max(bottomInset, 20) }}
    />
  );
}
