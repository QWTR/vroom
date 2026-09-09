import { MaterialCommunityIcons } from '@expo/vector-icons';
import React, { memo } from 'react';
import { ActivityIndicator, Platform, StyleSheet, TouchableOpacity, View, type ViewStyle } from 'react-native';
import { AppText as Text } from '../ui/AppText';
import {
  DriveSpeedTile,
  HudQuickReportButton,
} from './SpeedometerHUD';
import { LiveWarningHudCard } from './LiveWarningHudCard';
import type { UpcomingWarning } from '../../lib/warnings/warningAhead';

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
  speedPanelTop?: number;
  effectiveSpeedLimit: number | null;
  speedLimitStatus?: 'known' | 'pending' | 'queued' | 'unknown';
  canReportSpeedLimit?: boolean;
  onPressSpeedLimit?: () => void;
  speedLimitTolerance: number;
  liveDistanceKm: number;
  isTripActiveMap: boolean;
  onExportNavTrace?: () => void;
  onHudBottomLayout: (height: number) => void;
  isDriving: boolean;
  onToggleDriving: () => void;
  onOpenSearch: () => void;
  isSharing: boolean;
  liveStatus: 'off' | 'connecting' | 'on' | 'error';
  onToggleSharing: () => void;
  onCenterOnUser: () => void;
  onOpenFabModal: () => void;
  onOpenReport: () => void;
  upcomingWarning?: UpcomingWarning | null;
  onOpenUpcomingWarning?: () => void;
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
  speedPanelTop,
  effectiveSpeedLimit,
  speedLimitStatus,
  canReportSpeedLimit,
  onPressSpeedLimit,
  speedLimitTolerance,
  liveDistanceKm,
  isTripActiveMap,
  onExportNavTrace,
  onHudBottomLayout,
  isDriving,
  onToggleDriving,
  onOpenSearch,
  isSharing,
  liveStatus,
  onToggleSharing,
  onCenterOnUser,
  onOpenFabModal,
  onOpenReport,
  upcomingWarning,
  onOpenUpcomingWarning,
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
          <Text style={{ fontFamily: 'Manrope_600SemiBold', fontSize: 12, color: theme.mapOverlayText, letterSpacing: 0.5 }}>
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
            <Text style={{ fontFamily: 'Manrope_600SemiBold', fontSize: 12, color: theme.textDim, letterSpacing: 1 }}>
              {timerRouteName.toUpperCase()}
            </Text>
            <Text style={{ fontFamily: 'Manrope_600SemiBold', fontSize: 20, color: theme.mapOverlayText, fontWeight: '700', letterSpacing: 1 }}>
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
            speedPanelTop != null ? { top: speedPanelTop } : null,
          ]}
          onLayout={(e) => onHudBottomLayout(e.nativeEvent.layout.height)}
        >
          <DriveSpeedTile
            speedLimit={effectiveSpeedLimit}
            tolerance={speedLimitTolerance}
            tripDistanceKm={liveDistanceKm}
            showTripMeter={isTripActiveMap}
            onLongPress={isTripActiveMap ? onExportNavTrace : undefined}
            speedLimitStatus={speedLimitStatus}
            canReportSpeedLimit={canReportSpeedLimit}
            onPressSpeedLimit={onPressSpeedLimit}
          />
        </View>
      )}

      {showSideControls && !isBuilding && (
        <View pointerEvents="box-none" style={[styles.rightBottomControls, { bottom: sideControlsBottom }]}>
          {upcomingWarning && onOpenUpcomingWarning ? (
            <View pointerEvents="box-none" style={{ position: 'absolute', right: 0, top: -94, zIndex: 250, elevation: 24 }}>
              <LiveWarningHudCard upcoming={upcomingWarning} onPress={onOpenUpcomingWarning} />
            </View>
          ) : null}
          {(isDriving || isNavigating) && (
            <HudQuickReportButton onPress={onOpenReport} />
          )}

          <View style={[controls.rail, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            {!isNavigating ? (
              <HudAction icon="car-outline" label={isDriving ? 'Jedziesz' : 'Jazda'}
                accessibilityLabel={isDriving ? 'Zakończ tryb jazdy' : 'Włącz tryb jazdy'}
                active={isDriving} theme={theme} onPress={onToggleDriving} />
            ) : (
              <HudAction icon="map-marker-path" label="Trasa" accessibilityLabel="Zmień trasę"
                theme={theme} onPress={onOpenSearch} />
            )}
            <HudAction icon={isSharing ? 'access-point' : 'access-point-off'}
              label={isSharing ? liveStatus === 'error' ? 'Błąd' : liveStatus === 'connecting' ? 'Łączę…' : 'Live' : 'Live'}
              accessibilityLabel={isSharing ? 'Wyłącz udostępnianie pozycji' : 'Udostępnij pozycję na żywo'}
              active={isSharing} theme={theme} onPress={onToggleSharing}
              statusColor={isSharing ? liveStatus === 'on' ? theme.online : liveStatus === 'error' ? '#E5484D' : '#F5B942' : undefined} />
            <View style={{ height: 1, backgroundColor: theme.border, marginHorizontal: 10 }} />
            <HudAction icon="crosshairs-gps" label="Centruj" accessibilityLabel="Wyśrodkuj mapę na mojej pozycji"
              theme={theme} onPress={onCenterOnUser} />
            <HudAction icon="view-grid-outline" label="Menu" accessibilityLabel="Otwórz menu mapy"
              theme={theme} onPress={onOpenFabModal} />
          </View>
        </View>
      )}
    </>
  );
});

function HudAction({ icon, label, accessibilityLabel, active = false, theme, onPress, statusColor }: {
  icon: keyof typeof MaterialCommunityIcons.glyphMap; label: string; accessibilityLabel: string;
  active?: boolean; theme: MapScreenHudTheme; onPress: () => void; statusColor?: string;
}) {
  const color = statusColor ?? (active ? theme.primary : theme.mapOverlayText);
  return <TouchableOpacity accessibilityRole="button" accessibilityLabel={accessibilityLabel}
    accessibilityState={{ selected: active }} onPress={onPress} activeOpacity={0.65}
    style={[controls.action, active && { backgroundColor: theme.primaryBg }]}>
    <MaterialCommunityIcons name={icon} size={23} color={color} />
    <Text numberOfLines={1} style={[controls.caption, { color }]}>{label}</Text>
  </TouchableOpacity>;
}
const controls = StyleSheet.create({
  rail: { padding: 4, borderRadius: 22, borderWidth: 1, gap: 2,
    shadowColor: '#000', shadowOpacity: 0.16, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 8 },
  action: { width: 56, minHeight: 53, paddingVertical: 6, borderRadius: 17, alignItems: 'center', justifyContent: 'center', gap: 2 },
  caption: { fontFamily: 'Manrope_600SemiBold', fontSize: 11, fontWeight: '700' },
});
