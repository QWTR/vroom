import React from 'react';
import { View, Text, ActivityIndicator } from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useTheme } from '../../contexts/ThemeContext';
import { COMMUNITY_ACCENTS } from './communityTheme';
import {
  type DailyDuelData,
  carDisplayLabel,
  formatDuelCount,
} from './dailyDuelTypes';

function formatDuelDay(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('pl-PL', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return iso.slice(0, 10);
  }
}

interface Props {
  history: DailyDuelData[];
  loading?: boolean;
}

export function DailyDuelHistorySection({ history, loading }: Props) {
  const { theme } = useTheme();
  const gold = COMMUNITY_ACCENTS.duel;
  const red = COMMUNITY_ACCENTS.duelAlt;

  return (
    <View style={{
      marginTop: 20,
      padding: 16,
      borderRadius: 16,
      backgroundColor: theme.surface,
      borderWidth: 1,
      borderColor: theme.border2,
      gap: 12,
    }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <MaterialCommunityIcons name="history" size={18} color={gold} />
        <Text style={{ fontFamily: 'Orbitron', fontSize: 11, color: theme.text, fontWeight: '800', letterSpacing: 1 }}>
          ARCHIWUM POJEDYNKÓW
        </Text>
      </View>

      {loading ? (
        <ActivityIndicator color={gold} size="small" />
      ) : history.length === 0 ? (
        <Text style={{ fontFamily: 'Orbitron', fontSize: 10, color: theme.textDim }}>
          Brak zakończonych pojedynków.
        </Text>
      ) : (
        history.map((item) => {
          const votesA = Number(item.votesA ?? 0);
          const votesB = Number(item.votesB ?? 0);
          const totalVotes = Number(item.totalVotes ?? votesA + votesB);
          const percentA = Number(item.percentA ?? (totalVotes > 0 ? Math.round((votesA / totalVotes) * 100) : 50));
          const percentB = Number(item.percentB ?? (totalVotes > 0 ? 100 - percentA : 50));
          const isTie = votesA === votesB;
          const winnerIsA = votesA > votesB;
          const winnerLabel = isTie
            ? 'Remis'
            : carDisplayLabel(winnerIsA ? item.carA : item.carB);
          const winnerColor = isTie ? theme.text : winnerIsA ? red : gold;
          return (
            <View
              key={item.id}
              style={{
                paddingVertical: 10,
                borderTopWidth: 1,
                borderTopColor: theme.border2,
                gap: 4,
              }}
            >
              <Text style={{ fontFamily: 'Orbitron', fontSize: 9, color: theme.textDim }}>
                {formatDuelDay(item.duelDate)}
              </Text>
              <Text style={{ fontFamily: 'Orbitron', fontSize: 10, color: theme.textMuted }}>
                {carDisplayLabel(item.carA)} vs {carDisplayLabel(item.carB)}
              </Text>
              <Text style={{ fontFamily: 'Orbitron', fontSize: 10, color: winnerColor, fontWeight: '800' }}>
                {isTie ? winnerLabel : `Zwycięzca: ${winnerLabel}`}
              </Text>
              <Text style={{ fontFamily: 'Orbitron', fontSize: 9, color: theme.text, fontWeight: '700' }}>
                A: {percentA}% ({formatDuelCount(votesA)}) · B: {percentB}% ({formatDuelCount(votesB)})
              </Text>
              <Text style={{ fontFamily: 'Orbitron', fontSize: 9, color: theme.textDim }}>
                Łącznie: {formatDuelCount(totalVotes)} głosów
              </Text>
              {item.myVoteCarId != null && (
                <Text style={{ fontFamily: 'Orbitron', fontSize: 9, color: theme.textDim }}>
                  Twój głos: {item.myVoteCarId === item.carA.id ? 'A' : 'B'}
                </Text>
              )}
            </View>
          );
        })
      )}
    </View>
  );
}
