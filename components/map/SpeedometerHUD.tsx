import React, { memo, useEffect, useState, type ReactNode } from 'react';
import { DeviceEventEmitter, Pressable, StyleSheet, TouchableOpacity, View, type StyleProp, type ViewStyle } from 'react-native';
import { AppText as Text } from '../ui/AppText';
import { MaterialIcons } from '@expo/vector-icons';
import {
  markSpeedometerEmitted,
  resetDriveSpeedometerThrottle,
  shouldEmitSpeedometerKmh,
} from '../../lib/driveUi/driveUiScheduler';
import { useTheme } from '../../contexts/ThemeContext';
import type { AppTheme } from '../../constants/theme';
import { sanitizeDisplaySpeedLimit } from '../../lib/navigation/osmMaxSpeed';

export const SPEEDOMETER_EVENT = 'vroom:speedometer:update';

/** Twardy sufit HUD — realna jazda max ~200; 250 tylko jako clamp resztek błędu. */
const HUD_SPEED_CAP_KMH = 200;

/** Dystans bieżącej sesji jazdy — jedna cyfra po przecinku, zawsze z jednostką. */
export function formatTripDistanceKm(km: number | null | undefined): string {
  const n = Number(km);
  if (!Number.isFinite(n) || n < 0) return '0.0 km';
  if (n < 10) return `${n.toFixed(1)} km`;
  if (n < 100) return `${n.toFixed(1)} km`;
  return `${Math.round(n)} km`;
}

/** Zawsze zwraca skończoną prędkość ≥ 0 — 0 km/h to poprawna wartość, nie brak sygnału. */
export function normalizeHudSpeedKmh(value: unknown): number {
  if (value == null || typeof value !== 'number' || !Number.isFinite(value)) {
    return 0;
  }
  const raw = Math.max(0, value);
  return raw > HUD_SPEED_CAP_KMH ? HUD_SPEED_CAP_KMH : raw;
}

/**
 * Preferuj jawny prop (w tym 0), potem strumień live — nigdy `||`, bo 0 jest falsy.
 */
export function resolveHudSpeedKmh(
  explicitKmh: number | null | undefined,
  liveKmh: number,
): number {
  if (explicitKmh != null && Number.isFinite(explicitKmh)) {
    return normalizeHudSpeedKmh(explicitKmh);
  }
  return normalizeHudSpeedKmh(liveKmh);
}

export function emitSpeedometerKmh(kmh: number | null | undefined) {
  const normalized = normalizeHudSpeedKmh(kmh);
  if (!shouldEmitSpeedometerKmh(normalized)) return;
  markSpeedometerEmitted(normalized);
  DeviceEventEmitter.emit(SPEEDOMETER_EVENT, { kmh: normalized });
}

/** Po wyjściu z trybu jazdy — następny tick może odrazu zaktualizować HUD. */
export function resetSpeedometerEmitterThrottle(): void {
  resetDriveSpeedometerThrottle();
}

function useSpeedometerKmh(initialKmh = 0) {
  const safeInitial = normalizeHudSpeedKmh(initialKmh);
  const [kmh, setKmh] = useState(safeInitial);

  useEffect(() => {
    setKmh(safeInitial);
  }, [safeInitial]);

  useEffect(() => {
    const sub = DeviceEventEmitter.addListener(
      SPEEDOMETER_EVENT,
      (payload: { kmh?: number } | undefined) => {
        const next = normalizeHudSpeedKmh(payload?.kmh);
        setKmh((prev) => (Math.round(prev) === Math.round(next) ? prev : next));
      },
    );
    return () => sub.remove();
  }, []);

  return kmh;
}

export const SpeedometerHUD = memo(function SpeedometerHUD({
  initialKmh = 0,
  children,
}: {
  initialKmh?: number;
  children: (kmh: number) => ReactNode;
}) {
  const kmh = useSpeedometerKmh(initialKmh);
  return <>{children(kmh)}</>;
});

function makeHudStyles(theme: AppTheme, isDark: boolean) {
  return StyleSheet.create({
    panelShell: {
      borderRadius: 20,
      borderWidth: 1.5,
      borderColor: theme.border,
      backgroundColor: theme.surface,
      overflow: 'hidden',
      flexGrow: 0,
      flexShrink: 0,
      alignSelf: 'stretch',
      elevation: 8,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.3,
      shadowRadius: 12,
    },
    speedTile: {
      borderRadius: 18,
      borderWidth: 1.5,
      borderColor: theme.border,
      backgroundColor: theme.surface,
      overflow: 'hidden',
      elevation: 8,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.3,
      shadowRadius: 12,
      paddingVertical: 10,
      paddingHorizontal: 12,
      minWidth: 72,
      alignItems: 'center',
    },
    speedTileCol: {
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      minWidth: 72,
    },
    speedValueWrap: {
      alignItems: 'center',
      justifyContent: 'center',
      minWidth: 72,
      width: 72,
      marginTop: 6,
    },
    speedNumber: {
      fontFamily: 'Manrope_600SemiBold',
      fontSize: 36,
      fontWeight: '900',
      color: theme.text,
      letterSpacing: -0.2,
      lineHeight: 40,
      width: '100%',
      textAlign: 'center',
    },
    speedNumberOver: {
      color: theme.danger,
    },
    speedUnit: {
      fontSize: 13,
      fontWeight: '700',
      color: theme.textMuted,
      marginTop: 2,
    },
    tripMeter: {
      fontSize: 13,
      fontWeight: '600',
      color: theme.textMuted,
      marginTop: 5,
      letterSpacing: 0.2,
    },
    limitRing: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: isDark ? '#f5f5f5' : '#ffffff',
      borderWidth: 2.5,
      borderColor: isDark ? '#1a1a1a' : '#222222',
      alignItems: 'center',
      justifyContent: 'center',
    },
    limitRingOver: {
      borderColor: theme.danger,
      backgroundColor: '#fff5f5',
    },
    limitText: {
      fontFamily: 'Manrope_600SemiBold',
      fontSize: 13,
      fontWeight: '900',
      color: '#111111',
    },
    limitTextOver: {
      color: theme.danger,
    },
    limitDash: {
      fontFamily: 'Manrope_600SemiBold',
      fontSize: 13,
      fontWeight: '700',
      color: '#666666',
    },
    pendingBadge: {
      marginTop: 3,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 3,
    },
    pendingDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: '#f59f00' },
    pendingText: { color: '#f59f00', fontSize: 12, fontWeight: '900' },
    quickReportBtn: {
      width: 62,
      height: 62,
      borderRadius: 16,
      backgroundColor: '#f23835',
      borderWidth: 2,
      borderColor: 'rgba(255,255,255,0.30)',
      alignItems: 'center',
      justifyContent: 'center',
      elevation: 8,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.35,
      shadowRadius: 10,
    },
    quickReportLabel: {
      fontSize: 12,
      fontWeight: '800',
      color: '#ffffff',
      marginTop: 2,
    },
    maneuverBox: {
      width: 52,
      height: 52,
      borderRadius: 14,
      backgroundColor: theme.surface2,
      borderWidth: 1.5,
      borderColor: theme.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    navDistance: {
      fontFamily: 'Manrope_600SemiBold',
      fontSize: 26,
      fontWeight: '900',
      color: theme.text,
      letterSpacing: -0.2,
      lineHeight: 30,
    },
    instruction: {
      fontSize: 14,
      fontWeight: '600',
      color: theme.text,
      lineHeight: 20,
    },
    label: {
      fontSize: 13,
      fontWeight: '600',
      color: theme.textMuted,
    },
    meta: {
      fontSize: 12,
      fontWeight: '600',
      color: theme.textMuted,
    },
    metaAccent: {
      fontSize: 13,
      fontWeight: '700',
      color: theme.info,
    },
    metaPrimary: {
      fontSize: 13,
      fontWeight: '700',
      color: theme.primary,
    },
    closeBtn: {
      position: 'absolute',
      top: 10,
      right: 10,
      width: 32,
      height: 32,
      borderRadius: 10,
      backgroundColor: theme.surface2,
      borderWidth: 1,
      borderColor: theme.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    thenRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      backgroundColor: theme.surface2,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: theme.border,
      paddingHorizontal: 12,
      paddingVertical: 8,
      marginBottom: 8,
    },
    thenText: {
      fontSize: 12,
      fontWeight: '600',
      color: theme.textMuted,
      flex: 1,
    },
    metaRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      flexWrap: 'wrap',
    },
    metaDot: {
      width: 4,
      height: 4,
      borderRadius: 2,
      backgroundColor: theme.border3,
    },
  });
}

/** Solid panel z lekkim blur — tylko rozmiar treści, nie pełny ekran. */
export const HudPanelShell = memo(function HudPanelShell({
  children,
  style,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const { theme, isDark } = useTheme();
  const hud = makeHudStyles(theme, isDark);

  return (
    <View style={[hud.panelShell, style]}>
      <View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFillObject,
          { backgroundColor: theme.surface, opacity: isDark ? 0.92 : 0.94 },
        ]}
      />
      <View style={{ padding: 16 }} pointerEvents="auto">
        {children}
      </View>
    </View>
  );
});

/** Rdzeń UI prędkości + limit (bez zewnętrznego kafelka). */
export const DriveSpeedCluster = memo(function DriveSpeedCluster({
  initialKmh = 0,
  kmh,
  speedLimit,
  tolerance,
  tripDistanceKm,
  showTripMeter = false,
  speedLimitStatus = 'known',
  canReportSpeedLimit = false,
  onPressSpeedLimit,
}: {
  initialKmh?: number;
  kmh?: number;
  speedLimit: number | null;
  tolerance: number;
  tripDistanceKm?: number | null;
  showTripMeter?: boolean;
  speedLimitStatus?: 'known' | 'pending' | 'queued' | 'unknown';
  canReportSpeedLimit?: boolean;
  onPressSpeedLimit?: () => void;
}) {
  const { theme, isDark } = useTheme();
  const hud = makeHudStyles(theme, isDark);
  const liveKmh = useSpeedometerKmh(initialKmh);
  const valueKmh = resolveHudSpeedKmh(kmh, liveKmh);
  const displayLimit = sanitizeDisplaySpeedLimit(speedLimit);
  const overLimit = displayLimit !== null && valueKmh > displayLimit + tolerance;
  const limitSmall = displayLimit != null && displayLimit >= 100;

  return (
    <View style={hud.speedTileCol}>
      <Pressable
        accessibilityRole={canReportSpeedLimit ? 'button' : undefined}
        accessibilityLabel={canReportSpeedLimit ? 'Dodaj ograniczenie prędkości' : undefined}
        disabled={!canReportSpeedLimit || !onPressSpeedLimit}
        onPress={onPressSpeedLimit}
        style={({ pressed }) => [hud.limitRing, overLimit && hud.limitRingOver, pressed && { opacity: 0.72 }]}
      >
        <Text
          style={[
            limitSmall ? { fontSize: 12, fontFamily: 'Manrope_600SemiBold', fontWeight: '900' } : hud.limitText,
            overLimit && hud.limitTextOver,
          ]}
          numberOfLines={1}
          minimumFontScale={0.75}
        >
          {displayLimit ?? (canReportSpeedLimit ? '+' : '—')}
        </Text>
      </Pressable>
      {speedLimitStatus === 'pending' || speedLimitStatus === 'queued' ? (
        <View pointerEvents="none" style={hud.pendingBadge}>
          <View style={hud.pendingDot} />
          <Text style={hud.pendingText}>{speedLimitStatus === 'queued' ? 'WYSYŁANIE' : 'OCZEKUJE'}</Text>
        </View>
      ) : null}
      <View style={hud.speedValueWrap}>
        <Text
          style={[hud.speedNumber, overLimit && hud.speedNumberOver]}
          numberOfLines={1}
          minimumFontScale={0.65}
        >
          {Math.round(valueKmh)}
        </Text>
        <Text style={hud.speedUnit}>km/h</Text>
        {showTripMeter ? (
          <Text style={hud.tripMeter}>{formatTripDistanceKm(tripDistanceKm)}</Text>
        ) : null}
      </View>
    </View>
  );
});

/** Spójny kafelek prędkości + limit — wzorowany na Apple Maps / Waze. */
export const DriveSpeedTile = memo(function DriveSpeedTile({
  initialKmh = 0,
  kmh,
  speedLimit,
  tolerance,
  tripDistanceKm,
  showTripMeter = false,
  style,
  onLongPress,
  speedLimitStatus = 'known',
  canReportSpeedLimit = false,
  onPressSpeedLimit,
}: {
  initialKmh?: number;
  kmh?: number;
  speedLimit: number | null;
  tolerance: number;
  tripDistanceKm?: number | null;
  showTripMeter?: boolean;
  style?: StyleProp<ViewStyle>;
  onLongPress?: () => void;
  speedLimitStatus?: 'known' | 'pending' | 'queued' | 'unknown';
  canReportSpeedLimit?: boolean;
  onPressSpeedLimit?: () => void;
}) {
  const { theme, isDark } = useTheme();
  const hud = makeHudStyles(theme, isDark);

  const content = (
    <View style={[hud.speedTile, style]}>
      <View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFillObject,
          { backgroundColor: theme.surface, opacity: isDark ? 0.92 : 0.94 },
        ]}
      />
      <DriveSpeedCluster
        initialKmh={initialKmh}
        kmh={kmh}
        speedLimit={speedLimit}
        tolerance={tolerance}
        tripDistanceKm={tripDistanceKm}
        showTripMeter={showTripMeter}
        speedLimitStatus={speedLimitStatus}
        canReportSpeedLimit={canReportSpeedLimit}
        onPressSpeedLimit={onPressSpeedLimit}
      />
    </View>
  );

  if (onLongPress) {
    return (
      <Pressable onLongPress={onLongPress} delayLongPress={700}>
        {content}
      </Pressable>
    );
  }
  return content;
});

/** Potężny przycisk Quick Report — widoczny w trybie jazdy / nawigacji. */
export const HudQuickReportButton = memo(function HudQuickReportButton({
  onPress,
}: {
  onPress: () => void;
}) {
  const { theme } = useTheme();
  const hud = makeHudStyles(theme, true);

  return (
    <TouchableOpacity
      style={hud.quickReportBtn}
      onPress={onPress}
      activeOpacity={0.85}
      accessibilityRole="button"
      accessibilityLabel="Zgłoś ostrzeżenie"
    >
      <MaterialIcons name="warning" size={27} color="#ffffff" />
      <Text style={hud.quickReportLabel}>ZGŁOŚ</Text>
    </TouchableOpacity>
  );
});

/** Legacy exports — zachowane dla kompatybilności, delegują do nowego tile. */
export const SpeedValueText = memo(function SpeedValueText({
  initialKmh = 0,
  kmh,
  speedLimit,
  tolerance,
  style,
  unitStyle,
  showUnit = false,
}: {
  initialKmh?: number;
  kmh?: number;
  speedLimit: number | null;
  tolerance: number;
  style: any;
  unitStyle?: any;
  showUnit?: boolean;
}) {
  const { theme } = useTheme();
  const liveKmh = useSpeedometerKmh(initialKmh);
  const valueKmh = resolveHudSpeedKmh(kmh, liveKmh);
  const overLimit = speedLimit !== null && valueKmh > speedLimit + tolerance;
  return (
    <Text
      style={[style, overLimit && { color: theme.danger }]}
      numberOfLines={1}
      minimumFontScale={0.65}
    >
      {Math.round(valueKmh)}
      {showUnit ? (
        <Text style={unitStyle ?? { fontSize: 13, fontWeight: '700', color: theme.textMuted }}>
          {' '}km/h
        </Text>
      ) : null}
    </Text>
  );
});

export const SpeedLimitBadge = memo(function SpeedLimitBadge({
  initialKmh = 0,
  kmh,
  speedLimit,
  tolerance,
  size = 52,
  smallFontAt = 100,
  style,
}: {
  initialKmh?: number;
  kmh?: number;
  speedLimit: number | null;
  tolerance: number;
  size?: number;
  smallFontAt?: number;
  style?: any;
}) {
  const { theme, isDark } = useTheme();
  const liveKmh = useSpeedometerKmh(initialKmh);
  const valueKmh = resolveHudSpeedKmh(kmh, liveKmh);
  const displayLimit = sanitizeDisplaySpeedLimit(speedLimit);
  const overLimit = displayLimit !== null && valueKmh > displayLimit + tolerance;
  const smallFont = displayLimit != null && displayLimit >= smallFontAt;

  return (
    <View
      style={[
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: isDark ? '#f5f5f5' : '#ffffff',
          borderWidth: 3,
          borderColor: overLimit ? theme.danger : (isDark ? '#1a1a1a' : '#222222'),
          alignItems: 'center',
          justifyContent: 'center',
        },
        overLimit && { backgroundColor: '#fff5f5' },
        style,
      ]}
    >
      <Text
        style={{
          fontFamily: 'Manrope_600SemiBold',
          fontSize: smallFont ? 12 : 15,
          fontWeight: '900',
          color: overLimit ? theme.danger : '#111111',
        }}
      >
        {displayLimit ?? '—'}
      </Text>
    </View>
  );
});

export function useHudStyles() {
  const { theme, isDark } = useTheme();
  return makeHudStyles(theme, isDark);
}
