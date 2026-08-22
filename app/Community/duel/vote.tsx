import React from 'react';
import { StatusBar } from 'react-native';
import { useTheme } from '../../../contexts/ThemeContext';
import { DailyDuelVotePanel } from '../../../components/community/DailyDuelVotePanel';
import { useDailyDuel } from '../../../hooks/useDailyDuel';

export default function DailyDuelVoteScreen() {
  const { isDark } = useTheme();
  const {
    duel,
    history,
    historyLoading,
    loading,
    voting,
    submission,
    eligibleCars,
    submissionLoading,
    submitting,
    vote,
    submitCar,
    cancelSubmission,
    refresh,
    refreshHistory,
    refreshSubmission,
  } = useDailyDuel(15000);

  return (
    <>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />
      <DailyDuelVotePanel
        duel={duel}
        history={history}
        historyLoading={historyLoading}
        loading={loading}
        voting={voting}
        submission={submission}
        eligibleCars={eligibleCars}
        submissionLoading={submissionLoading}
        submitting={submitting}
        onVote={vote}
        onSubmitCar={(carId) => { void submitCar(carId); }}
        onCancelSubmission={() => { void cancelSubmission(); }}
        onRefresh={() => {
          void refresh();
          void refreshHistory();
          void refreshSubmission();
        }}
      />
    </>
  );
}
