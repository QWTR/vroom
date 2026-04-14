import React from 'react';
import { View, Text, TouchableOpacity, Image, ActivityIndicator } from 'react-native';
import MaterialIcons          from '@expo/vector-icons/MaterialIcons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useTheme }           from '../../contexts/ThemeContext';
import { Club }               from './types';

// ── Mini avatar ───────────────────────────────────────────
export const UAv = ({
  uri, name, size = 36,
}: { uri?: string | null; name?: string; size?: number }) => {
  return uri ? (
    <Image source={{ uri }} style={{ width: size, height: size, borderRadius: size / 2 }} />
  ) : (
    <View style={{
      width: size, height: size, borderRadius: size / 2,
      backgroundColor: '#e3383520', borderWidth: 1, borderColor: '#e3383540',
      alignItems: 'center', justifyContent: 'center',
    }}>
      <Text style={{ fontFamily: 'Orbitron', fontSize: size * 0.3, color: '#e33835', fontWeight: '700' }}>
        {(name ?? '?').slice(0, 2).toUpperCase()}
      </Text>
    </View>
  );
};

// ── Rank badge ────────────────────────────────────────────
export const RankBadge = ({ rank }: { rank: { name: string; color: string } | null | undefined }) => {
  if (!rank) return null;
  return (
    <View style={{
      backgroundColor: rank.color + '25', borderRadius: 5,
      paddingHorizontal: 5, paddingVertical: 1,
      borderWidth: 1, borderColor: rank.color + '60',
    }}>
      <Text style={{ fontFamily: 'Orbitron', fontSize: 7, color: rank.color, fontWeight: '700' }}>
        {rank.name.toUpperCase()}
      </Text>
    </View>
  );
};

// ── Club Card ─────────────────────────────────────────────
interface Props {
  club:    Club;
  onPress: (c: Club) => void;
  onJoin:  (id: number) => void;
  onLeave: (id: number) => void;
  joining: number | null;
}

export default function ClubCard({ club, onPress, onJoin, onLeave, joining }: Props) {
  const { theme } = useTheme();
  const isOwner   = club.myRole === 'owner';

  return (
    <TouchableOpacity
      style={{
        backgroundColor: theme.surface, borderRadius: 16,
        borderWidth: 1, borderColor: club.isMember ? '#e3383540' : theme.border2,
        marginBottom: 12, overflow: 'hidden',
      }}
      onPress={() => onPress(club)} activeOpacity={0.88}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', padding: 14, gap: 12 }}>

        {/* Avatar */}
        <View style={{
          width: 52, height: 52, borderRadius: 14, overflow: 'hidden',
          backgroundColor: '#e3383518', borderWidth: 1, borderColor: '#e3383530',
          alignItems: 'center', justifyContent: 'center',
        }}>
          {club.avatarUrl
            ? <Image source={{ uri: club.avatarUrl }} style={{ width: 52, height: 52 }} />
            : <MaterialCommunityIcons name="shield-crown-outline" size={26} color="#e33835" />
          }
        </View>

        {/* Info */}
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 3, flexWrap: 'wrap' }}>
            <Text style={{ fontFamily: 'Orbitron', fontSize: 12, color: theme.text, fontWeight: '700' }} numberOfLines={1}>
              {club.name}
            </Text>
            {club.isPrivate && <MaterialIcons name="lock" size={10} color={theme.textDim} />}
            {isOwner && (
              <View style={{ backgroundColor: '#e3383520', borderRadius: 5, paddingHorizontal: 5, paddingVertical: 1 }}>
                <Text style={{ fontFamily: 'Orbitron', fontSize: 7, color: '#e33835' }}>OWNER</Text>
              </View>
            )}
            {club.myRank && <RankBadge rank={club.myRank} />}
            {club.myRole === 'member' && !club.myRank && (
              <View style={{ backgroundColor: '#4de92615', borderRadius: 5, paddingHorizontal: 5, paddingVertical: 1 }}>
                <Text style={{ fontFamily: 'Orbitron', fontSize: 7, color: '#4de926' }}>CZŁONEK</Text>
              </View>
            )}
          </View>

          {!!club.description && (
            <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: theme.textDim, lineHeight: 12 }} numberOfLines={1}>
              {club.description}
            </Text>
          )}

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
              <MaterialCommunityIcons name="account-group" size={11} color={theme.textDim} />
              <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: theme.textDim }}>{club.memberCount}</Text>
            </View>
            <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: theme.textDim }}>@{club.owner.username}</Text>
          </View>
        </View>

        {/* Join / Leave */}
        {!isOwner && (
          <TouchableOpacity
            style={[
              { borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', gap: 4 },
              club.isMember
                ? { backgroundColor: '#ffffff08', borderWidth: 1, borderColor: theme.border2 }
                : { backgroundColor: '#e33835' },
            ]}
            onPress={() => club.isMember ? onLeave(club.id) : onJoin(club.id)}
            disabled={joining === club.id}
            activeOpacity={0.8}
          >
            {joining === club.id ? (
              <ActivityIndicator size={13} color="#fff" />
            ) : (
              <>
                <MaterialIcons
                  name={club.isMember ? 'exit-to-app' : 'add'}
                  size={13}
                  color={club.isMember ? theme.textDim : '#fff'}
                />
                <Text style={{
                  fontFamily: 'Orbitron', fontSize: 8, fontWeight: '700',
                  color: club.isMember ? theme.textDim : '#fff',
                }}>
                  {club.isMember ? 'OPUŚĆ' : 'DOŁĄCZ'}
                </Text>
              </>
            )}
          </TouchableOpacity>
        )}
      </View>
    </TouchableOpacity>
  );
}