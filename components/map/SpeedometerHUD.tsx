import React, { memo, useEffect, useState, type ReactNode } from 'react';
import { DeviceEventEmitter, Text, View } from 'react-native';

export const SPEEDOMETER_EVENT = 'vroom:speedometer:update';

const HUD_SPEED_CAP_KMH = 250;

export function emitSpeedometerKmh(kmh: number | null) {
  const raw = Number.isFinite(kmh ?? NaN) ? Math.max(0, kmh as number) : 0;
  // Ostatnia bariera: HUD nie pokazuje absurdalnych skoków zanim pipeline je wyłapie.
  const safe = raw > HUD_SPEED_CAP_KMH ? HUD_SPEED_CAP_KMH : raw;
  DeviceEventEmitter.emit(SPEEDOMETER_EVENT, { kmh: safe });
}

function useSpeedometerKmh(initialKmh = 0) {
  const [kmh, setKmh] = useState(Number.isFinite(initialKmh) ? Math.max(0, initialKmh) : 0);

  useEffect(() => {
    const sub = DeviceEventEmitter.addListener(SPEEDOMETER_EVENT, (payload: { kmh?: number } | undefined) => {
      const next = Number(payload?.kmh ?? 0);
      setKmh(Number.isFinite(next) ? Math.max(0, next) : 0);
    });
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
  const liveKmh = useSpeedometerKmh(initialKmh);
  const valueKmh = Number.isFinite(kmh ?? NaN) ? Math.max(0, kmh as number) : liveKmh;
  const overLimit = speedLimit !== null && valueKmh > speedLimit + tolerance;
  return (
    <Text style={[style, overLimit && { color: '#e33835' }]}>
      {Math.round(valueKmh)}
      {showUnit ? <Text style={unitStyle}> km/h</Text> : null}
    </Text>
  );
});

export const SpeedLimitBadge = memo(function SpeedLimitBadge({
  initialKmh = 0,
  kmh,
  speedLimit,
  tolerance,
  size = 44,
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
  const liveKmh = useSpeedometerKmh(initialKmh);
  const valueKmh = Number.isFinite(kmh ?? NaN) ? Math.max(0, kmh as number) : liveKmh;
  const overLimit = speedLimit !== null && valueKmh > speedLimit + tolerance;
  const smallFont = speedLimit != null && speedLimit >= smallFontAt;

  return (
    <View
      style={[
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: '#fff',
          borderWidth: size >= 48 ? 3 : 4,
          borderColor: overLimit ? '#e33835' : '#222',
          alignItems: 'center',
          justifyContent: 'center',
        },
        style,
      ]}
    >
      <Text
        style={{
          fontFamily: 'Orbitron',
          fontSize: smallFont ? 10 : 13,
          fontWeight: '900',
          color: overLimit ? '#e33835' : '#111',
        }}
      >
        {speedLimit ?? '—'}
      </Text>
    </View>
  );
});
