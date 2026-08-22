import { requireOptionalNativeModule } from 'expo-modules-core';

export type CarPlayReportType =
  | 'accident'
  | 'police'
  | 'traffic'
  | 'hazard'
  | 'camera'
  | 'other';

export interface CarPlayNavigationStartedEvent {
  routePoints: { latitude: number; longitude: number }[];
  destination: {
    latitude: number;
    longitude: number;
    name: string;
  } | null;
  distanceMeters: number;
  durationSeconds: number;
  instruction: string;
  routePreview: boolean;
  selectedRouteIndex: number;
}

export interface VroomCarPlayNativeModule {
  updateSnapshot(json: string): void;
  setAuthToken(token: string): void;
  setPerformanceProfile(profile: 'standard' | 'battery' | 'smooth'): void;
  isConnected(): Promise<boolean>;
  diagnostics(): Promise<Record<string, unknown>>;
  addListener(
    eventName: 'stopRequested',
    listener: () => void,
  ): { remove(): void };
  addListener(
    eventName: 'reportRequested',
    listener: (event: { type?: CarPlayReportType; handled?: boolean }) => void,
  ): { remove(): void };
  addListener(
    eventName: 'navigationStarted',
    listener: (event: CarPlayNavigationStartedEvent) => void,
  ): { remove(): void };
}

const VroomCarPlay =
  requireOptionalNativeModule<VroomCarPlayNativeModule>('VroomCarPlay');

export default VroomCarPlay;
