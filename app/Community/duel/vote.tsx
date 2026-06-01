import React from 'react';
import { StatusBar } from 'react-native';
import { useTheme } from '../../../contexts/ThemeContext';
import { DailyDuelVotePanel } from '../../../components/community/DailyDuelVotePanel';
import { useDailyDuel } from '../../../hooks/useDailyDuel';

export default function DailyDuelVoteScreen() {
  const { isDark } = useTheme();
  const { duel, loading, voting, vote, refresh } = useDailyDuel(15000);

  return (
    <>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />
      <DailyDuelVotePanel
        duel={duel}
        loading={loading}
        voting={voting}
        onVote={vote}
        onRefresh={() => { void refresh(); }}
      />
    </>
  );
}
