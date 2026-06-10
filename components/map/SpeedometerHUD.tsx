import React, { memo, useEffect, useState, type ReactNode } from 'react';
import {
  DeviceEventEmitter,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { MaterialIcons } from '@expo/vector-icons';
import {
  markSpeedometerEmitted,
  resetDriveSpeedometerThrottle,
  shouldEmitSpeedometerKmh,
} from '../../lib/driveUi/driveUiScheduler';
import { useTheme } from '../../contexts/ThemeContext';
import type { AppTheme } from '../../constants/theme';

export const SPEEDOMETER_EVENT = 'vroom:speedometer:update';

/** Twardy sufit HUD — realna jazda max ~200; 250 tylko jako clamp resztek błędu. */
const HUD_SPEED_CAP_KMH = 200;

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
      paddingVertical: 12,
      paddingHorizontal: 14,
      minWidth: 148,
    },
    speedTileRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
    },
    speedValueCol: {
      flex: 1,
      minWidth: 0,
    },
    speedNumber: {
      fontFamily: 'Orbitron',
      fontSize: 38,
      fontWeight: '900',
      color: theme.text,
      letterSpacing: -2,
      lineHeight: 42,
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
    limitRing: {
      width: 52,
      height: 52,
      borderRadius: 26,
      backgroundColor: isDark ? '#f5f5f5' : '#ffffff',
      borderWidth: 3,
      borderColor: isDark ? '#1a1a1a' : '#222222',
      alignItems: 'center',
      justifyContent: 'center',
    },
    limitRingOver: {
      borderColor: theme.danger,
      backgroundColor: '#fff5f5',
    },
    limitText: {
      fontFamily: 'Orbitron',
      fontSize: 15,
      fontWeight: '900',
      color: '#111111',
    },
    limitTextOver: {
      color: theme.danger,
    },
    limitDash: {
      fontFamily: 'Orbitron',
      fontSize: 13,
      fontWeight: '700',
      color: '#666666',
    },
    quickReportBtn: {
      width: 58,
      height: 58,
      borderRadius: 16,
      backgroundColor: theme.primary,
      borderWidth: 1.5,
      borderColor: theme.primaryBorder2,
      alignItems: 'center',
      justifyContent: 'center',
      elevation: 8,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.35,
      shadowRadius: 10,
    },
    quickReportLabel: {
      fontSize: 11,
      fontWeight: '800',
      color: theme.onPrimary,
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
      fontFamily: 'Orbitron',
      fontSize: 26,
      fontWeight: '900',
      color: theme.text,
      letterSpacing: -0.5,
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
      <BlurView
        tint={isDark ? 'dark' : 'light'}
        intensity={Platform.OS === 'ios' ? 28 : 18}
        style={StyleSheet.absoluteFillObject}
        pointerEvents="none"
      />
      <View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFillObject,
          { backgroundColor: theme.surface },
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
}: {
  initialKmh?: number;
  kmh?: number;
  speedLimit: number | null;
  tolerance: number;
}) {
  const { theme, isDark } = useTheme();
  const hud = makeHudStyles(theme, isDark);
  const liveKmh = useSpeedometerKmh(initialKmh);
  const valueKmh = resolveHudSpeedKmh(kmh, liveKmh);
  const overLimit = speedLimit !== null && valueKmh > speedLimit + tolerance;
  const limitSmall = speedLimit != null && speedLimit >= 100;

  return (
    <View style={hud.speedTileRow}>
      <View style={hud.speedValueCol}>
        <Text style={[hud.speedNumber, overLimit && hud.speedNumberOver]}>
          {Math.round(valueKmh)}
        </Text>
        <Text style={hud.speedUnit}>km/h</Text>
      </View>
      <View style={[hud.limitRing, overLimit && hud.limitRingOver]}>
        <Text
          style={[
            limitSmall ? { fontSize: 13, fontFamily: 'Orbitron', fontWeight: '900' } : hud.limitText,
            overLimit && hud.limitTextOver,
          ]}
        >
          {speedLimit ?? '—'}
        </Text>
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
  style,
  onLongPress,
}: {
  initialKmh?: number;
  kmh?: number;
  speedLimit: number | null;
  tolerance: number;
  style?: StyleProp<ViewStyle>;
  onLongPress?: () => void;
}) {
  const { theme, isDark } = useTheme();
  const hud = makeHudStyles(theme, isDark);

  const content = (
    <View style={[hud.speedTile, style]}>
      <BlurView
        tint={isDark ? 'dark' : 'light'}
        intensity={Platform.OS === 'ios' ? 24 : 16}
        style={StyleSheet.absoluteFillObject}
      />
      <View
        style={[
          StyleSheet.absoluteFillObject,
          { backgroundColor: theme.surface },
        ]}
      />
      <DriveSpeedCluster
        initialKmh={initialKmh}
        kmh={kmh}
        speedLimit={speedLimit}
        tolerance={tolerance}
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
      <MaterialIcons name="warning" size={26} color={theme.onPrimary} />
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
    <Text style={[style, overLimit && { color: theme.danger }]}>
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
  const overLimit = speedLimit !== null && valueKmh > speedLimit + tolerance;
  const smallFont = speedLimit != null && speedLimit >= smallFontAt;

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
          fontFamily: 'Orbitron',
          fontSize: smallFont ? 12 : 15,
          fontWeight: '900',
          color: overLimit ? theme.danger : '#111111',
        }}
      >
        {speedLimit ?? '—'}
      </Text>
    </View>
  );
});

export function useHudStyles() {
  const { theme, isDark } = useTheme();
  return makeHudStyles(theme, isDark);
}
