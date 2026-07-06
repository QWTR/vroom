import React, { memo } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Toast from 'react-native-toast-message';
import type { Router } from 'expo-router';
import { SearchModal } from '../modals/SearchModal';
import { UserInfoModal } from '../modals/UserInfoModal';
import { SettingsModal } from '../modals/SettingsModal';
import { ReportModal } from '../modals/ReportModal';
import { WarningDetailModal } from '../modals/WarningDetailModal';
import { SaveRouteModal } from '../modals/SaveRouteModal';
import { RouteLeaderboardModal } from '../modals/RouteLeaderboardModal';
import { TripStatsModal } from '../modals/TripStatsModal';
import { AddSpeedCameraModal, type CameraType } from '../modals/AddSpeedCameraModal';
import { SpeedCameraDetailModal } from '../modals/SpeedCameraDetailModal';
import { AddFuelStationModal } from '../modals/AddFuelStationModal';
import { FuelStationModal } from '../modals/FuelStationModal';
import { PartnerPoiModal } from '../modals/PartnerPoiModal';
import { OfficialMeetMapModal } from '../modals/OfficialMeetMapModal';
import type { LocationState, User } from '../../constants/types';
import type { SpeedCamera } from '../../hooks/useSpeedCameras';
import type { PartnerPoi } from '../../hooks/usePartnerPois';
import type { OfficialMapMeet } from '../../hooks/useOfficialMapMeets';
import type { LiveWarning } from '../../hooks/useLiveMap';
import { API_URL } from '../../constants/mapConfig';

export type MapModalsHostProps = {
  router: Router;
  isPremium: boolean;
  userLocation: LocationState | null;
  nearbyUsers: User[];
  homeLocation: LocationState | null;
  currentUserId: string | null;
  mapType: string;
  pins: { id: string; latitude: number; longitude: number }[];
  snappedRoute: { latitude: number; longitude: number }[];
  saving: boolean;
  snapping: boolean;
  tripStats: Record<string, unknown> | null;
  selectedUser: User | null;
  selectedWarning: LiveWarning | null;
  selectedCamera: SpeedCamera | null;
  selectedFuelStation: unknown;
  selectedPartnerPoi: PartnerPoi | null;
  selectedOfficialMeet: OfficialMapMeet | null;
  addFuelStationCoords: { latitude: number; longitude: number } | null;
  pendingAddCameraParams: {
    maxspeed: number | null;
    type: CameraType;
    description: string | null;
  } | null;
  pickCenterRef: React.MutableRefObject<{ lat: number; lng: number }>;
  leaderboardRouteId: number | null;
  leaderboardRouteName: string;
  leaderboardData: unknown;
  leaderboardRunsData: unknown;
  leaderboardLoading: boolean;
  myFinishedTime: number | null;
  searchModalVisible: boolean;
  userInfoVisible: boolean;
  settingsVisible: boolean;
  reportVisible: boolean;
  saveRouteVisible: boolean;
  tripStatsVisible: boolean;
  addCameraVisible: boolean;
  cameraDetailVisible: boolean;
  fuelStationModalVisible: boolean;
  partnerPoiModalVisible: boolean;
  officialMeetModalVisible: boolean;
  leaderboardVisible: boolean;
  addFuelStationVisible: boolean;
  isSubmittingWarning: boolean;
  onCloseSearch: () => void;
  onSelectStart: (loc: LocationState) => void;
  onSelectEnd: (loc: LocationState) => void;
  onCloseUserInfo: () => void;
  onNavigateToUser: (user: User) => void;
  onViewProfile: (user: User) => void;
  onMessageUser: (user: User) => void;
  onChangeMapType: (type: string) => void;
  onCloseSettings: () => void;
  onCloseReport: () => void;
  onReport: (type: LiveWarning['type'], message?: string) => Promise<void>;
  onCloseWarning: () => void;
  onConfirmWarning: (id: string) => void;
  onCancelWarning: (id: string) => void;
  onCancelSaveRoute: () => void;
  onSnapToRoad: () => void;
  onSaveRoute: (name: string, desc: string, isPublic: boolean, isOffroad: boolean) => Promise<void>;
  totalDistance: (pts: { latitude: number; longitude: number }[]) => number;
  onCloseLeaderboard: () => void;
  onCloseTripStats: () => void;
  onCloseAddCamera: () => void;
  onConfirmAddCamera: (params: unknown) => void;
  onPickCameraOnMap: (params: {
    maxspeed: number | null;
    type: CameraType;
    description: string | null;
  }) => void;
  onCloseCameraDetail: () => void;
  onConfirmCamera: (id: string) => void;
  onDeleteCamera: (id: string) => Promise<boolean>;
  onCloseAddFuel: () => void;
  onCreateFuelStation: (data: unknown) => Promise<boolean>;
  onCloseFuelStation: () => void;
  onNavigateToFuel: (lat: number, lng: number, name: string) => void;
  onFuelPricesUpdated: () => void;
  updateFuelPrices: (stationId: string, prices: unknown) => void;
  onClosePartnerPoi: () => void;
  onNavigateToPartner: (lat: number, lng: number, name: string) => void;
  onCloseOfficialMeet: () => void;
  onOpenOfficialMeet: (meetId: number) => void;
  onNavigateToOfficialMeet: (lat: number, lng: number, name: string) => void;
};

export const MapModalsHost = memo(function MapModalsHost(props: MapModalsHostProps) {
  const {
    router,
    isPremium,
    userLocation,
    nearbyUsers,
    homeLocation,
    currentUserId,
    mapType,
    pins,
    snappedRoute,
    saving,
    snapping,
    tripStats,
    selectedUser,
    selectedWarning,
    selectedCamera,
    selectedFuelStation,
    selectedPartnerPoi,
    selectedOfficialMeet,
    addFuelStationCoords,
    pickCenterRef,
    leaderboardRouteId,
    leaderboardRouteName,
    leaderboardData,
    leaderboardRunsData,
    leaderboardLoading,
    myFinishedTime,
    searchModalVisible,
    userInfoVisible,
    settingsVisible,
    reportVisible,
    saveRouteVisible,
    tripStatsVisible,
    addCameraVisible,
    cameraDetailVisible,
    fuelStationModalVisible,
    partnerPoiModalVisible,
    officialMeetModalVisible,
    leaderboardVisible,
    addFuelStationVisible,
    isSubmittingWarning,
    onCloseSearch,
    onSelectStart,
    onSelectEnd,
    onCloseUserInfo,
    onNavigateToUser,
    onViewProfile,
    onMessageUser,
    onChangeMapType,
    onCloseSettings,
    onCloseReport,
    onReport,
    onCloseWarning,
    onConfirmWarning,
    onCancelWarning,
    onCancelSaveRoute,
    onSnapToRoad,
    onSaveRoute,
    totalDistance,
    onCloseLeaderboard,
    onCloseTripStats,
    onCloseAddCamera,
    onConfirmAddCamera,
    onPickCameraOnMap,
    onCloseCameraDetail,
    onConfirmCamera,
    onDeleteCamera,
    onCloseAddFuel,
    onCreateFuelStation,
    onCloseFuelStation,
    onNavigateToFuel,
    onFuelPricesUpdated,
    updateFuelPrices,
    onClosePartnerPoi,
    onNavigateToPartner,
    onCloseOfficialMeet,
    onOpenOfficialMeet,
    onNavigateToOfficialMeet,
  } = props;

  return (
    <>
      <SearchModal
        visible={searchModalVisible}
        onClose={onCloseSearch}
        onSelectStart={onSelectStart}
        onSelectEnd={onSelectEnd}
        userLocation={userLocation}
        nearbyUsers={nearbyUsers}
        homeLocation={homeLocation}
        onPressSetHome={() => {
          onCloseSearch();
          router.push('/profile/settings' as any);
        }}
      />
      <UserInfoModal
        visible={userInfoVisible}
        user={selectedUser}
        distance={selectedUser?.distance ?? 0}
        onNavigate={onNavigateToUser}
        onClose={onCloseUserInfo}
        onViewProfile={onViewProfile}
        onMessage={onMessageUser}
      />
      <SettingsModal
        visible={settingsVisible}
        mapType={mapType}
        onChangeMapType={onChangeMapType}
        onClose={onCloseSettings}
      />
      <ReportModal
        visible={reportVisible}
        onClose={onCloseReport}
        onReport={onReport}
        isSubmitting={isSubmittingWarning}
      />
      <WarningDetailModal
        visible={!!selectedWarning}
        warning={selectedWarning}
        onClose={onCloseWarning}
        onConfirm={onConfirmWarning}
        onCancel={onCancelWarning}
        currentUserId={currentUserId ?? undefined}
      />
      <SaveRouteModal
        visible={saveRouteVisible}
        pinCount={pins.length}
        distanceKm={totalDistance(
          snappedRoute.length > 0
            ? snappedRoute
            : pins.map((p) => ({ latitude: p.latitude, longitude: p.longitude })),
        )}
        saving={saving}
        snapping={snapping}
        isSnapped={snappedRoute.length > 0}
        onSnapToRoad={onSnapToRoad}
        onCancel={onCancelSaveRoute}
        onSave={async (name, desc, isPublic, isOffroad) => {
          if (!isPublic && !isPremium) {
            try {
              const token = await AsyncStorage.getItem('token');
              if (token) {
                const res = await fetch(`${API_URL}/api/routes/my`, {
                  headers: { Authorization: `Bearer ${token}` },
                });
                const json = await res.json();
                const privateCount = Array.isArray(json) ? json.filter((r: { isPublic?: boolean }) => !r.isPublic).length : 0;
                if (privateCount >= 5) {
                  Toast.show({ type: 'info', text1: '🔒 Limit prywatnych tras', text2: 'Free: max 5 · Odblokuj Premium' });
                  onCancelSaveRoute();
                  router.push('/premium' as any);
                  return;
                }
              }
            } catch {
              /* ignore */
            }
          }
          await onSaveRoute(name, desc, isPublic, isOffroad);
        }}
      />
      <RouteLeaderboardModal
        visible={leaderboardVisible}
        routeId={leaderboardRouteId}
        routeName={leaderboardRouteName}
        data={leaderboardData}
        runsData={leaderboardRunsData}
        loading={leaderboardLoading}
        newTime={myFinishedTime}
        onClose={onCloseLeaderboard}
      />
      <TripStatsModal
        visible={tripStatsVisible}
        stats={tripStats}
        onClose={onCloseTripStats}
      />
      <AddSpeedCameraModal
        visible={addCameraVisible}
        onClose={onCloseAddCamera}
        onConfirm={onConfirmAddCamera}
        onPickOnMap={(params) => {
          onPickCameraOnMap(params);
          if (userLocation) {
            pickCenterRef.current = {
              lat: userLocation.latitude,
              lng: userLocation.longitude,
            };
          }
        }}
      />
      <SpeedCameraDetailModal
        visible={cameraDetailVisible}
        camera={selectedCamera}
        onClose={onCloseCameraDetail}
        onConfirm={onConfirmCamera}
        onDelete={onDeleteCamera}
        currentUserId={currentUserId}
      />
      <AddFuelStationModal
        visible={addFuelStationVisible}
        latitude={addFuelStationCoords?.latitude ?? null}
        longitude={addFuelStationCoords?.longitude ?? null}
        onClose={onCloseAddFuel}
        onSubmit={onCreateFuelStation}
      />
      <FuelStationModal
        visible={fuelStationModalVisible}
        station={selectedFuelStation}
        onClose={onCloseFuelStation}
        onNavigate={onNavigateToFuel}
        onPricesUpdated={onFuelPricesUpdated}
        updatePrices={updateFuelPrices}
      />
      <PartnerPoiModal
        visible={partnerPoiModalVisible}
        poi={selectedPartnerPoi}
        onClose={onClosePartnerPoi}
        onNavigate={onNavigateToPartner}
      />
      <OfficialMeetMapModal
        visible={officialMeetModalVisible}
        meet={selectedOfficialMeet}
        onClose={onCloseOfficialMeet}
        onOpenEvent={onOpenOfficialMeet}
        onNavigate={onNavigateToOfficialMeet}
      />
    </>
  );
});
