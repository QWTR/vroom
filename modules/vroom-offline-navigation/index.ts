import { requireOptionalNativeModule } from 'expo-modules-core';

export type OfflineNavigationCapabilities = {
  available: boolean;
  sdkVersion: string;
  supportsOfflineRouting: boolean;
  supportsVoiceGuidance: boolean;
  supportsRerouting: boolean;
  reason?: string | null;
};

export type OfflineNavigationPack = {
  id: string;
  routeId: number;
  routeName: string;
  status: 'queued' | 'downloading' | 'paused' | 'ready' | 'error';
  progress: number;
  completedBytes: number;
  requiredBytes: number;
  updatedAt: number;
  bufferKm: 5 | 10 | 20;
  error?: string | null;
};

export type OfflineNavigationDownload = {
  id: string;
  routeId: number;
  routeName: string;
  geometry: { type: 'Polygon'; coordinates: number[][][] };
  routeGeoJson: { type: 'LineString'; coordinates: number[][] };
  styleURI: string;
  bufferKm: 5 | 10 | 20;
  minZoom: number;
  maxZoom: number;
  instructions: unknown[];
  savedPlaces: unknown[];
};

export type OfflineNavigationRouteRequest = {
  origin: { latitude: number; longitude: number };
  destination: { latitude: number; longitude: number };
  headingDeg?: number | null;
};

export type OfflineNavigationRoute = {
  points: { latitude: number; longitude: number }[];
  steps: Array<{
    html_instructions: string;
    distance: { text: string; value: number };
    duration: { text: string; value: number };
    start_location: { lat: number; lng: number };
    end_location: { lat: number; lng: number };
    maneuver?: string;
    streetName?: string;
    polyline: { points: string };
  }>;
  distanceText: string;
  distanceValue: number;
  durationText: string;
  duration: number;
  index: number;
  routerOrigin: 'offline' | 'online' | 'unknown';
};

export interface VroomOfflineNavigationNativeModule {
  getCapabilities(): Promise<OfflineNavigationCapabilities>;
  estimatePack(input: OfflineNavigationDownload): Promise<{ requiredBytes: number }>;
  listPacks(): Promise<OfflineNavigationPack[]>;
  downloadPack(input: OfflineNavigationDownload): Promise<OfflineNavigationPack>;
  pausePack(id: string): Promise<void>;
  resumePack(id: string): Promise<void>;
  updatePack(input: OfflineNavigationDownload): Promise<OfflineNavigationPack>;
  deletePack(id: string): Promise<void>;
  setPremiumEntitlement(active: boolean): Promise<void>;
  requestOfflineRoute(input: OfflineNavigationRouteRequest): Promise<OfflineNavigationRoute>;
  addListener(eventName: 'packProgress', listener: (event: OfflineNavigationPack) => void): { remove(): void };
}

const VroomOfflineNavigation = requireOptionalNativeModule<VroomOfflineNavigationNativeModule>('VroomOfflineNavigation');

export default VroomOfflineNavigation;
