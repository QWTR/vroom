import React from 'react';
import { View, TouchableOpacity, Image, ActivityIndicator } from 'react-native';
import { AppText as Text } from '../ui/AppText';
import MaterialIcons          from '@expo/vector-icons/MaterialIcons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useTheme }           from '../../contexts/ThemeContext';
import { Club }               from './types';
import { PremiumAvatar, type PublicUserIdentity } from '../user/PremiumIdentity';

export const UAv = ({ uri, name, size = 36, user }: { uri?: string | null; name?: string; size?: number; user?: PublicUserIdentity | null }) => {
  if (user) return <PremiumAvatar user={user} size={size} />;
  return uri ? (
    <Image source={{ uri }} style={{ width: size, height: size, borderRadius: size / 2 }} />
  ) : (
    <View style={{
      width: size, height: size, borderRadius: size / 2,
      backgroundColor: '#e3383520', borderWidth: 1, borderColor: '#e3383540',
      alignItems: 'center', justifyContent: 'center',
    }}>
      <Text style={{ fontFamily: 'Manrope_600SemiBold', fontSize: size * 0.3, color: '#e33835', fontWeight: '700' }}>
        {(name ?? '?').slice(0, 2).toUpperCase()}
      </Text>
    </View>
  );
};

export const RankBadge = ({ rank }: { rank: { name: string; color: string } | null | undefined }) => {
  if (!rank) return null;
  return (
    <View style={{
      backgroundColor: rank.color + '25', borderRadius: 5,
      paddingHorizontal: 5, paddingVertical: 1,
      borderWidth: 1, borderColor: rank.color + '60',
    }}>
      <Text style={{ fontFamily: 'Manrope_600SemiBold', fontSize: 12, color: rank.color, fontWeight: '700' }}>
        {rank.name.toUpperCase()}
      </Text>
    </View>
  );
};

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
  const isMember  = club.isMember;
  const isPrivate = club.isPrivate;
  const myRanks   = Array.isArray(club.myRanks) ? club.myRanks : (club.myRank ? [club.myRank] : []);

  return (
    <TouchableOpacity
      style={{
        backgroundColor: theme.surface,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: isMember ? '#e3383540' : theme.border2,
        marginBottom: 10,
        overflow: 'hidden',
      }}
      onPress={() => onPress(club)}
      activeOpacity={0.88}
    >
      {/* Akcent member */}
      {isMember && <View style={{ height: 2, backgroundColor: '#e33835' }} />}

      <View style={{ flexDirection: 'row', alignItems: 'center', padding: 12, gap: 11 }}>
        {/* Avatar */}
        <View style={{
          width: 50, height: 50, borderRadius: 14, overflow: 'hidden',
          backgroundColor: '#e3383518',
          borderWidth: isMember ? 2 : 1,
          borderColor: isMember ? '#e33835' : '#e3383530',
          alignItems: 'center', justifyContent: 'center',
          flexShrink: 0,
        }}>
          {club.avatarUrl
            ? <Image source={{ uri: club.avatarUrl }} style={{ width: 50, height: 50 }} />
            : <MaterialCommunityIcons name="shield-crown-outline" size={24} color="#e33835" />
          }
        </View>

        {/* Info */}
        <View style={{ flex: 1, minWidth: 0 }}>
          {/* Nazwa */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 3 }}>
            <Text style={{
              fontFamily: 'Manrope_600SemiBold', fontSize: 12,
              color: theme.text, fontWeight: '900', flexShrink: 1,
            }} numberOfLines={1}>
              {club.name}
            </Text>
            {isPrivate && <MaterialIcons name="lock" size={11} color={theme.textDim} />}
          </View>

          {/* Badges */}
          <View style={{ flexDirection: 'row', gap: 4, flexWrap: 'wrap', marginBottom: 4 }}>
            {isOwner && (
              <View style={{ backgroundColor: '#e3383520', borderRadius: 5, paddingHorizontal: 5, paddingVertical: 1, borderWidth: 1, borderColor: '#e3383540' }}>
                <Text style={{ fontFamily: 'Manrope_600SemiBold', fontSize: 12, color: '#e33835', fontWeight: '700' }}>OWNER</Text>
              </View>
            )}
            {myRanks.map(rank => <RankBadge key={rank.id} rank={rank} />)}
            {isMember && !isOwner && myRanks.length === 0 && (
              <View style={{ backgroundColor: '#4de92615', borderRadius: 5, paddingHorizontal: 5, paddingVertical: 1, borderWidth: 1, borderColor: '#4de92630' }}>
                <Text style={{ fontFamily: 'Manrope_600SemiBold', fontSize: 12, color: '#4de926', fontWeight: '700' }}>CZŁONEK</Text>
              </View>
            )}
          </View>

          {/* Meta */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
              <MaterialCommunityIcons name="account-group" size={10} color={theme.textDim} />
              <Text style={{ fontFamily: 'Manrope_600SemiBold', fontSize: 12, color: theme.textDim }}>{club.memberCount}</Text>
            </View>
            <Text style={{ fontFamily: 'Manrope_600SemiBold', fontSize: 12, color: theme.textDim }} numberOfLines={1}>
              @{club.owner?.username ?? 'nieznany'}
            </Text>
          </View>
        </View>

        {/* Przycisk */}
        {!isOwner && (
          isMember ? (
            <TouchableOpacity
              style={{
                borderRadius: 10, paddingHorizontal: 10, paddingVertical: 7,
                flexDirection: 'row', alignItems: 'center', gap: 3,
                backgroundColor: '#ffffff08', borderWidth: 1, borderColor: theme.border2,
                flexShrink: 0,
              }}
              onPress={() => onLeave(club.id)}
              disabled={joining === club.id}
            >
              {joining === club.id
                ? <ActivityIndicator size={12} color={theme.textDim} />
                : <>
                    <MaterialIcons name="exit-to-app" size={12} color={theme.textDim} />
                    <Text style={{ fontFamily: 'Manrope_600SemiBold', fontSize: 12, fontWeight: '700', color: theme.textDim }}>OPUŚĆ</Text>
                  </>
              }
            </TouchableOpacity>
          ) : isPrivate ? (
            <View style={{
              borderRadius: 10, paddingHorizontal: 8, paddingVertical: 7,
              flexDirection: 'row', alignItems: 'center', gap: 3,
              backgroundColor: theme.surface2, borderWidth: 1, borderColor: theme.border2,
              flexShrink: 0,
            }}>
              <MaterialIcons name="lock" size={11} color={theme.textFaint} />
              <Text style={{ fontFamily: 'Manrope_600SemiBold', fontSize: 12, color: theme.textFaint }}>ZAPROSZ.</Text>
            </View>
          ) : (
            <TouchableOpacity
              style={{
                borderRadius: 10, paddingHorizontal: 10, paddingVertical: 7,
                flexDirection: 'row', alignItems: 'center', gap: 3,
                backgroundColor: '#e33835', flexShrink: 0,
              }}
              onPress={() => onJoin(club.id)}
              disabled={joining === club.id}
            >
              {joining === club.id
                ? <ActivityIndicator size={12} color="#fff" />
                : <>
                    <MaterialIcons name="add" size={12} color="#fff" />
                    <Text style={{ fontFamily: 'Manrope_600SemiBold', fontSize: 12, fontWeight: '700', color: '#fff' }}>DOŁĄCZ</Text>
                  </>
              }
            </TouchableOpacity>
          )
        )}
      </View>

      {/* Opis — tylko gdy jest, kompaktowo */}
      {!!club.description && (
        <View style={{ paddingHorizontal: 12, paddingBottom: 10 }}>
          <Text style={{ fontFamily: 'Manrope_600SemiBold', fontSize: 12, color: theme.textDim, lineHeight: 16 }} numberOfLines={1}>
            {club.description}
          </Text>
        </View>
      )}
    </TouchableOpacity>
  );
}
