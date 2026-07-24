import { describe, expect, it } from 'vitest';
import {
  canReportCommunitySpeedLimit,
  speedLimitDirectionLabel,
  speedLimitUiState,
  type SpeedLimitResolution,
} from './types';

const resolution = (patch: Partial<SpeedLimitResolution>): SpeedLimitResolution => ({
  limitKmh: null, source: 'unknown', status: 'unknown', roadKey: 'road', roadName: 'A1', direction: 'forward', votes: 0, roadRecognized: true, ...patch,
});

describe('community speed limit states', () => {
  it('maps explicit and verified limits to stable known states', () => {
    expect(speedLimitUiState(resolution({ limitKmh: 70, source: 'osm_explicit', status: 'known' }))).toBe('known');
    expect(speedLimitUiState(resolution({ limitKmh: 80, source: 'community_verified', status: 'known' }))).toBe('verified');
  });

  it('maps the current driver vote to pending', () => {
    expect(speedLimitUiState(resolution({ limitKmh: 60, source: 'community_pending', status: 'pending' }))).toBe('pending');
  });

  it('keeps an offline vote visible as sending', () => {
    expect(speedLimitUiState(resolution({
      limitKmh: 70,
      source: 'community_queued',
      status: 'queued',
    }))).toBe('queued');
  });

  it('presents road direction in Polish', () => {
    expect(speedLimitDirectionLabel('forward')).toBe('zgodnie z kierunkiem drogi');
    expect(speedLimitDirectionLabel('backward')).toBe('przeciwnie do kierunku drogi');
    expect(speedLimitDirectionLabel('both')).toBe('oba kierunki');
  });

  it('highlights another driver candidate', () => {
    const candidate = resolution({ candidateLimitKmh: 50, candidateVotes: 1 });
    expect(speedLimitUiState(candidate)).toBe('candidate');
    expect(canReportCommunitySpeedLimit(candidate)).toBe(true);
  });

  it('allows plus only for a recognized road without a limit', () => {
    expect(canReportCommunitySpeedLimit(resolution({}))).toBe(true);
    expect(canReportCommunitySpeedLimit(resolution({ roadRecognized: false }))).toBe(false);
  });

  it('shows an unavailable dash when the server or feature is unavailable', () => {
    expect(speedLimitUiState(resolution({ temporarilyUnavailable: true }))).toBe('unavailable');
    expect(speedLimitUiState(resolution({ featureEnabled: false }))).toBe('unavailable');
  });
});
