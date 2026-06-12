import React, { useMemo } from 'react';
import {
  View, Text, TouchableOpacity, ActivityIndicator, ScrollView, Dimensions,
} from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useRouter } from 'expo-router';
import { useTheme } from '../../contexts/ThemeContext';
import { CommunityScreenHeader } from './CommunityScreenHeader';
import { DailyDuelCarCarousel } from './DailyDuelCarCarousel';
import { DailyDuelResetTimer } from './DailyDuelResetTimer';
import { COMMUNITY_ACCENTS } from './communityTheme';
import {
  type DailyDuelCarSide,
  type DailyDuelData,
  formatDuelCount,
  carDisplayLabel,
  getCarPhotos,
} from './dailyDuelTypes';
import { DailyDuelHistorySection } from './DailyDuelHistorySection';

const { width: SCREEN_W } = Dimensions.get('window');
const CAROUSEL_W = SCREEN_W - 64;

interface CarBlockProps {
  car: DailyDuelCarSide;
  side: 'A' | 'B';
  percent: number;
  votes: number;
  color: string;
  label: string;
  selected: boolean;
  voted: boolean;
  voting?: boolean;
  onVote: (carId: number) => void;
}

const DailyDuelCarBlock = React.memo(function DailyDuelCarBlock({
  car,
  side,
  percent,
  votes,
  color,
  label,
  selected,
  voted,
  voting,
  onVote,
}: CarBlockProps) {
  const { theme } = useTheme();
  const router = useRouter();
  const photoKey = car.photos?.length ? car.photos.join('\0') : (car.photo ?? '');
  const photos = useMemo(() => getCarPhotos(car), [photoKey]);

  return (
    <View style={{
      marginBottom: 8,
      borderRadius: 20,
      borderWidth: selected ? 2 : 1,
      borderColor: selected ? color : theme.border2,
      backgroundColor: theme.surface,
      overflow: 'hidden',
    }}>
      <View style={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8 }}>
        <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color, letterSpacing: 3, fontWeight: '800' }}>
          {label}
        </Text>
      </View>

      <View style={{ paddingHorizontal: 16 }}>
        <DailyDuelCarCarousel
          photos={photos}
          height={260}
          width={CAROUSEL_W}
          accentColor={color}
          borderColor={selected ? color + '60' : theme.border2}
        />
      </View>

      <View style={{ padding: 16, gap: 8 }}>
        <Text style={{ fontFamily: 'Orbitron', fontSize: 15, color: theme.text, fontWeight: '900' }}>
          {carDisplayLabel(car)}
        </Text>
        <Text style={{ fontFamily: 'Orbitron', fontSize: 10, color: theme.textDim, lineHeight: 16 }}>
          {car.specs}
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 4 }}>
          <Text style={{ fontFamily: 'Orbitron', fontSize: 10, color: theme.textMuted }}>
            {car.power} KM
          </Text>
          <TouchableOpacity onPress={() => router.push({ pathname: '/profile/[userId]', params: { userId: String(car.owner.id) } })}>
            <Text style={{ fontFamily: 'Orbitron', fontSize: 10, color: theme.primary }}>
              @{car.owner.username}
            </Text>
          </TouchableOpacity>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
          <Text style={{ fontFamily: 'Orbitron', fontSize: 13, color, fontWeight: '800' }}>
            {percent}% · {formatDuelCount(votes)} głosów
          </Text>
          {selected && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <MaterialCommunityIcons name="check-circle" size={16} color={color} />
              <Text style={{ fontFamily: 'Orbitron', fontSize: 9, color }}>TWÓJ GŁOS</Text>
            </View>
          )}
        </View>

        {!voted && (
          <TouchableOpacity
            onPress={() => onVote(car.id)}
            disabled={voting}
            activeOpacity={0.85}
            style={{
              marginTop: 12,
              backgroundColor: color,
              borderRadius: 14,
              paddingVertical: 14,
              alignItems: 'center',
              opacity: voting ? 0.6 : 1,
            }}
          >
            {voting ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={{ fontFamily: 'Orbitron', fontSize: 11, color: '#fff', fontWeight: '800', letterSpacing: 1 }}>
                GŁOSUJ NA {side}
              </Text>
            )}
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
});

interface Props {
  duel: DailyDuelData | null;
  history?: DailyDuelData[];
  historyLoading?: boolean;
  loading?: boolean;
  voting?: boolean;
  onVote: (carId: number) => void;
  onRefresh?: () => void;
}

export function DailyDuelVotePanel({
  duel,
  history = [],
  historyLoading = false,
  loading,
  voting,
  onVote,
  onRefresh,
}: Props) {
  const { theme } = useTheme();
  const gold = COMMUNITY_ACCENTS.duel;
  const red = COMMUNITY_ACCENTS.duelAlt;

  if (loading || !duel) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator color={gold} size="large" />
      </View>
    );
  }

  const voted = duel.myVoteCarId != null;

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <CommunityScreenHeader
        title="POJEDYNEK DNIA"
        subtitleNode={<DailyDuelResetTimer endsAt={duel.endsAt} />}
        breadcrumb="SPOŁECZNOŚĆ"
        right={
          onRefresh ? (
            <TouchableOpacity onPress={onRefresh} style={{ padding: 4 }}>
              <MaterialCommunityIcons name="refresh" size={22} color={theme.textDim} />
            </TouchableOpacity>
          ) : undefined
        }
      />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24 }}
      >
        <DailyDuelCarBlock
          car={duel.carA}
          side="A"
          percent={duel.percentA}
          votes={duel.votesA}
          color={red}
          label="AUTO A · GÓRA"
          selected={duel.myVoteCarId === duel.carA.id}
          voted={voted}
          voting={voting}
          onVote={onVote}
        />

        <View style={{ alignItems: 'center', marginVertical: 4 }}>
          <View style={{
            width: 52,
            height: 52,
            borderRadius: 26,
            backgroundColor: theme.bg,
            borderWidth: 3,
            borderColor: gold,
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            <Text style={{ fontFamily: 'Orbitron', fontSize: 13, color: gold, fontWeight: '900' }}>VS</Text>
          </View>
        </View>

        <DailyDuelCarBlock
          car={duel.carB}
          side="B"
          percent={duel.percentB}
          votes={duel.votesB}
          color={gold}
          label="AUTO B · DÓŁ"
          selected={duel.myVoteCarId === duel.carB.id}
          voted={voted}
          voting={voting}
          onVote={onVote}
        />

        <View style={{
          marginTop: 8,
          padding: 16,
          borderRadius: 16,
          backgroundColor: theme.surface,
          borderWidth: 1,
          borderColor: theme.border2,
        }}>
          <View style={{ flexDirection: 'row', height: 10, borderRadius: 5, overflow: 'hidden', marginBottom: 10 }}>
            <View style={{ flex: duel.percentA || 1, backgroundColor: red }} />
            <View style={{ flex: duel.percentB || 1, backgroundColor: gold }} />
          </View>
          <Text style={{ fontFamily: 'Orbitron', fontSize: 9, color: theme.textDim, textAlign: 'center' }}>
            Łącznie {duel.totalVotes} głosów · przesuń zdjęcia palcem, aby zobaczyć więcej
          </Text>
        </View>

        <DailyDuelHistorySection history={history} loading={historyLoading} />
      </ScrollView>
    </View>
  );
}
