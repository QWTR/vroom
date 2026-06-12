import React from 'react';
import { StatusBar } from 'react-native';
import { useTheme } from '../../../contexts/ThemeContext';
import { DailyDuelVotePanel } from '../../../components/community/DailyDuelVotePanel';
import { useDailyDuel } from '../../../hooks/useDailyDuel';

export default function DailyDuelVoteScreen() {
  const { isDark } = useTheme();
  const { duel, history, historyLoading, loading, voting, vote, refresh, refreshHistory } = useDailyDuel(15000);

  return (
    <>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />
      <DailyDuelVotePanel
        duel={duel}
        history={history}
        historyLoading={historyLoading}
        loading={loading}
        voting={voting}
        onVote={vote}
        onRefresh={() => {
          void refresh();
          void refreshHistory();
        }}
      />
    </>
  );
}
