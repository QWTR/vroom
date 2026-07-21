import React, { forwardRef, useImperativeHandle, useRef } from 'react';
import { Platform, requireNativeComponent, type ViewProps } from 'react-native';
import Animated from 'react-native-reanimated';
import type { NavigationTarget } from '../../lib/navigationV3/types';

export type NativeNavigationSample = {
  sequence: number;
  lat: number;
  lng: number;
  rawLat: number;
  rawLng: number;
  headingDeg: number;
  speedMs: number;
  sourceTimestampMs: number;
  gpsIntervalMs: number;
  pathMode: string;
  roadBlend: number;
  targetArcM: number | null;
  polylineKey: string | null;
  allowInstant: boolean;
  arcWindow: { baseArcM: number; pointsFlat: number[]; cumM: number[] } | null;
};

export type VroomMapCameraFollowerHandle = {
  pushNavigationSample: (sample: NativeNavigationSample) => void;
};

export function nativeNavigationSampleFromTarget(target: NavigationTarget, sequence: number): NativeNavigationSample {
  return {
    sequence,
    lat: target.lat,
    lng: target.lng,
    rawLat: target.rawLat,
    rawLng: target.rawLng,
    headingDeg: target.headingDeg,
    speedMs: target.speedMs,
    sourceTimestampMs: target.sourceTimestampMs ?? Date.now(),
    gpsIntervalMs: target.gpsIntervalMs ?? 1000,
    pathMode: target.pathMode,
    roadBlend: target.roadBlend,
    targetArcM: target.targetArcM,
    polylineKey: target.polylineKey,
    allowInstant: target.allowInstant,
    arcWindow: target.arcWindow ? {
      baseArcM: target.arcWindow.baseArcM,
      pointsFlat: target.arcWindow.points.flatMap((point) => [point.lng, point.lat]),
      cumM: target.arcWindow.cumM,
    } : null,
  };
}

export type VroomMapCameraFollowerProps = ViewProps & {
  enabled: boolean;
  markerVisible: boolean;
  positionValid?: number;
  latitude?: number;
  longitude?: number;
  heading?: number;
  segmentDurationMs?: number;
  zoom: number;
  pitch: number;
  paddingTop?: number;
  paddingBottom?: number;
  paddingLeft: number;
  paddingRight: number;
  bottomOcclusion?: number;
  navigationSample?: NativeNavigationSample;
};

type FollowerHostProps = {
  enabled: boolean;
  markerVisible?: boolean;
  zoom: number;
  pitch: number;
  padding: {
    paddingTop: number;
    paddingBottom: number;
    paddingLeft: number;
    paddingRight: number;
  };
  animatedProps: object;
  bottomOcclusion?: number;
};

const NativeVroomMapCameraFollower = requireNativeComponent<VroomMapCameraFollowerProps>(
  'VroomMapCameraFollower',
);
const AnimatedNativeVroomMapCameraFollower = Animated.createAnimatedComponent(NativeVroomMapCameraFollower);

/** Invisible Mapbox feature. Native code applies the latest marker pose once per display frame. */
export const VroomMapCameraFollower = forwardRef<VroomMapCameraFollowerHandle, FollowerHostProps>(
  function VroomMapCameraFollower({ enabled, markerVisible = true, zoom, pitch, padding, animatedProps, bottomOcclusion = 0 }, forwardedRef) {
    const nativeRef = useRef<any>(null);
    useImperativeHandle(forwardedRef, () => ({
      pushNavigationSample(sample) {
        if (Platform.OS === 'ios') nativeRef.current?.setNativeProps?.({ navigationSample: sample });
      },
    }), []);

    if (Platform.OS === 'ios') {
      return (
        <NativeVroomMapCameraFollower
          ref={nativeRef}
          enabled={enabled}
          markerVisible={markerVisible}
          zoom={zoom}
          pitch={pitch}
          paddingLeft={padding.paddingLeft}
          paddingRight={padding.paddingRight}
          bottomOcclusion={bottomOcclusion}
        />
      );
    }
    return (
      <AnimatedNativeVroomMapCameraFollower
        ref={nativeRef}
        enabled={enabled}
        markerVisible={markerVisible}
        zoom={zoom}
        pitch={pitch}
        paddingTop={padding.paddingTop}
        paddingBottom={padding.paddingBottom}
        paddingLeft={padding.paddingLeft}
        paddingRight={padding.paddingRight}
        animatedProps={animatedProps}
      />
    );
  },
);
