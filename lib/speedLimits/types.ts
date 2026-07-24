export type SpeedLimitResolution = {
  limitKmh: number | null;
  source: 'osm_explicit' | 'community_verified' | 'community_pending' | 'community_queued' | 'unknown';
  status: 'known' | 'pending' | 'queued' | 'unknown';
  roadKey: string | null;
  roadName: string | null;
  direction: string | null;
  votes: number;
  roadRecognized?: boolean;
  featureEnabled?: boolean;
  temporarilyUnavailable?: boolean;
  candidateReportId?: number | null;
  candidateLimitKmh?: number | null;
  candidateVotes?: number;
  reportId?: number | null;
  roadContextToken?: string | null;
};

export type SpeedLimitUiState = 'known' | 'verified' | 'pending' | 'queued' | 'candidate' | 'unknown_add' | 'unavailable';

export function speedLimitUiState(resolution: SpeedLimitResolution): SpeedLimitUiState {
  if (resolution.featureEnabled === false || resolution.temporarilyUnavailable || !resolution.roadRecognized) return 'unavailable';
  if (resolution.status === 'queued') return 'queued';
  if (resolution.status === 'pending') return 'pending';
  if (resolution.source === 'community_verified' && resolution.status === 'known') return 'verified';
  if (resolution.status === 'known' && resolution.limitKmh != null) return 'known';
  if (resolution.candidateLimitKmh != null) return 'candidate';
  return 'unknown_add';
}

export function canReportCommunitySpeedLimit(resolution: SpeedLimitResolution): boolean {
  const state = speedLimitUiState(resolution);
  return state === 'unknown_add' || state === 'candidate';
}

export function speedLimitDirectionLabel(direction: string | null | undefined): string | null {
  if (direction === 'forward') return 'zgodnie z kierunkiem drogi';
  if (direction === 'backward') return 'przeciwnie do kierunku drogi';
  if (direction === 'both') return 'oba kierunki';
  return null;
}
