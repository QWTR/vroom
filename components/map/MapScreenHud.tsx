import { MaterialCommunityIcons, MaterialIcons } from '@expo/vector-icons';
import React, { memo } from 'react';
import {
  ActivityIndicator,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  type ViewStyle,
} from 'react-native';
import {
  DriveSpeedTile,
  HudQuickReportButton,
} from './SpeedometerHUD';

export type MapScreenHudTheme = {
  bg: string;
  mapOverlay: string;
  mapOverlayText: string;
  primary: string;
  primaryBorder: string;
  primaryBg: string;
  primaryBorder2: string;
  textMuted: string;
  online: string;
  surface: string;
  border: string;
  textDim: string;
};

export type MapScreenHudProps = {
  theme: MapScreenHudTheme;
  styles: {
    hudSpeedTilePos: ViewStyle;
    hudSpeedTilePosBuilding: ViewStyle;
    hudSpeedTilePosNav: ViewStyle;
    hudSpeedTilePosFreeDrive: ViewStyle;
    rightBottomControls: ViewStyle;
    sideBtn: ViewStyle;
  };
  gpsAcquiring: boolean;
  hasUserLocation: boolean;
  isNavigating: boolean;
  timerRunning: boolean;
  timerRouteName: string;
  formatElapsed: (sec: number) => string;
  elapsedSec: number;
  showSpeedPanel: boolean;
  isBuilding: boolean;
  showSideControls: boolean;
  sideControlsBottom: number;
  effectiveSpeedLimit: number | null;
  speedLimitTolerance: number;
  liveDistanceKm: number;
  isTripActiveMap: boolean;
  onExportNavTrace?: () => void;
  onHudBottomLayout: (height: number) => void;
  isDriving: boolean;
  onToggleDriving: () => void;
  onOpenSearch: () => void;
  isSharing: boolean;
  onToggleSharing: () => void;
  onCenterOnUser: () => void;
  connected: boolean;
  onOpenFabModal: () => void;
  onOpenReport: () => void;
  /** top = GPS banner + route timer; bottom = speed tile + side controls */
  section: 'top' | 'bottom';
};

export const MapScreenHud = memo(function MapScreenHud({
  section,
  theme,
  styles,
  gpsAcquiring,
  hasUserLocation,
  isNavigating,
  timerRunning,
  timerRouteName,
  formatElapsed,
  elapsedSec,
  showSpeedPanel,
  isBuilding,
  showSideControls,
  sideControlsBottom,
  effectiveSpeedLimit,
  speedLimitTolerance,
  liveDistanceKm,
  isTripActiveMap,
  onExportNavTrace,
  onHudBottomLayout,
  isDriving,
  onToggleDriving,
  onOpenSearch,
  isSharing,
  onToggleSharing,
  onCenterOnUser,
  connected,
  onOpenFabModal,
  onOpenReport,
}: MapScreenHudProps) {
  if (section === 'top') {
    return (
      <>
        {gpsAcquiring && !hasUserLocation && (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: 6,
            alignSelf: 'center',
            zIndex: 40,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
            backgroundColor: theme.mapOverlay,
            paddingHorizontal: 12,
            paddingVertical: 6,
            borderRadius: 14,
            borderWidth: 1,
            borderColor: theme.primaryBorder,
          }}
        >
          <ActivityIndicator size="small" color={theme.primary} />
          <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: theme.mapOverlayText, letterSpacing: 0.5 }}>
            SZUKAM GPS…
          </Text>
        </View>
      )}

      {isNavigating && timerRunning && (
        <View style={{
          position: 'absolute',
          bottom: Platform.OS === 'ios' ? 110 : 90,
          alignSelf: 'center',
          flexDirection: 'row', alignItems: 'center', gap: 10,
          backgroundColor: theme.mapOverlay,
          borderRadius: 20, paddingHorizontal: 18, paddingVertical: 10,
          borderWidth: 1, borderColor: theme.primaryBorder,
          shadowColor: theme.primary, shadowOpacity: 0.3,
          shadowOffset: { width: 0, height: 0 }, shadowRadius: 10,
          elevation: 8, zIndex: 25,
        }}>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: theme.primary }} />
          <View>
            <Text style={{ fontFamily: 'Orbitron', fontSize: 7, color: theme.textDim, letterSpacing: 2 }}>
              {timerRouteName.toUpperCase()}
            </Text>
            <Text style={{ fontFamily: 'Orbitron', fontSize: 20, color: theme.mapOverlayText, fontWeight: '700', letterSpacing: 2 }}>
              {formatElapsed(elapsedSec)}
            </Text>
          </View>
          <MaterialCommunityIcons name="timer-outline" size={20} color="#e33835" />
        </View>
      )}
      </>
    );
  }

  return (
    <>
      {showSpeedPanel && (
        <View
          pointerEvents="box-none"
          style={[
            styles.hudSpeedTilePos,
            isBuilding
              ? styles.hudSpeedTilePosBuilding
              : isNavigating
                ? styles.hudSpeedTilePosNav
                : styles.hudSpeedTilePosFreeDrive,
          ]}
          onLayout={(e) => onHudBottomLayout(e.nativeEvent.layout.height)}
        >
          <DriveSpeedTile
            speedLimit={effectiveSpeedLimit}
            tolerance={speedLimitTolerance}
            tripDistanceKm={liveDistanceKm}
            showTripMeter={isTripActiveMap}
            onLongPress={isTripActiveMap ? onExportNavTrace : undefined}
          />
        </View>
      )}

      {showSideControls && !isBuilding && (
        <View style={[styles.rightBottomControls, { bottom: sideControlsBottom }]}>
          {(isDriving || isNavigating) && (
            <HudQuickReportButton onPress={onOpenReport} />
          )}

          {!isNavigating && (
            <TouchableOpacity
              style={[
                styles.sideBtn,
                isDriving && {
                  backgroundColor: theme.primaryBg,
                  borderColor: theme.primaryBorder2,
                },
              ]}
              onPress={onToggleDriving}
              activeOpacity={0.75}
            >
              <MaterialCommunityIcons
                name="car-outline"
                size={22}
                color={isDriving ? theme.primary : theme.textMuted}
              />
            </TouchableOpacity>
          )}

          {isNavigating && (
            <TouchableOpacity
              style={[styles.sideBtn, { borderColor: theme.primaryBorder }]}
              onPress={onOpenSearch}
              activeOpacity={0.75}
            >
              <MaterialIcons name="alt-route" size={22} color={theme.primary} />
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={[
              styles.sideBtn,
              isSharing && {
                backgroundColor: theme.online + '18',
                borderColor: theme.online + '45',
              },
            ]}
            onPress={onToggleSharing}
            activeOpacity={0.75}
          >
            <MaterialIcons
              name={isSharing ? 'location-on' : 'location-off'}
              size={22}
              color={isSharing ? theme.online : theme.textMuted}
            />
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.sideBtn}
            onPress={onCenterOnUser}
            activeOpacity={0.75}
          >
            <MaterialIcons name="my-location" size={22} color={theme.textMuted} />
          </TouchableOpacity>

          {connected && isSharing && (
            <View style={{
              position: 'absolute',
              top: -36,
              right: 0,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
              backgroundColor: theme.surface,
              paddingHorizontal: 10,
              paddingVertical: 5,
              borderRadius: 20,
              borderWidth: 1.5,
              borderColor: theme.border,
              zIndex: 15,
              pointerEvents: 'none',
              elevation: 6,
              shadowColor: '#000',
              shadowOpacity: 0.25,
              shadowRadius: 6,
            }}>
              <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: theme.online }} />
              <Text style={{ color: theme.online, fontSize: 12, fontWeight: '700' }}>LIVE</Text>
            </View>
          )}

          <TouchableOpacity
            style={styles.sideBtn}
            onPress={onOpenFabModal}
            activeOpacity={0.75}
          >
            <MaterialCommunityIcons name="widgets-outline" size={24} color={theme.textMuted} />
          </TouchableOpacity>
        </View>
      )}
    </>
  );
});
