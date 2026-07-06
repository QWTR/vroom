import type { LocationState, RouteInfo } from '../../constants/types';
import type { DirectionsResult } from '../../hooks/useGoogleDirections';

export type PersistedNavSession = {
  savedAt: number;
  isOffroadRoute: boolean;
  startLocation: LocationState | null;
  endLocation: LocationState | null;
  navStartLoc: LocationState | null;
  routeInfo: (RouteInfo & { durationText?: string | null }) | null;
  routeSnapshot?: DirectionsResult | null;
  currentStep: number;
  offroadPoints: { latitude: number; longitude: number }[];
};

/** Załadowana trasa użytkownika (ranking) — osobno od bieżącego celu nawigacji. */
export type LoadedRouteContext = {
  routeId: number;
  routeName: string;
  start: LocationState;
  end: LocationState;
  isOffroad: boolean;
  points: { latitude: number; longitude: number }[];
};

