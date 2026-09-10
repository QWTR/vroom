import { usePerformance } from '../../contexts/PerformanceContext';
import { recordNavigationMotion } from '../../lib/performance/telemetry';
import React from 'react';
import { requireNativeComponent, type ViewProps } from 'react-native';
import Animated from 'react-native-reanimated';

export type VroomMapCameraFollowerProps = ViewProps & {
  enabled: boolean;
  cameraMode?: 'courseUp' | 'northUp' | 'free';
  markerVisible: boolean;
  diagnosticsEnabled?: boolean;
  onMotionDiagnostics?: (event: { nativeEvent: { cameraWrites: number; markerWrites: number; frames: number } }) => void;
  positionValid?: number;
  latitude?: number;
  longitude?: number;
  heading?: number;
  markerHeading?: number;
  speedMps?: number;
  segmentDurationMs?: number;
  framesPerSecond?: 15 | 30 | 60;
  zoom: number;
  pitch: number;
  paddingTop?: number;
  paddingBottom?: number;
  paddingLeft: number;
  paddingRight: number;
};

type FollowerHostProps = {
  enabled: boolean;
  cameraMode?: 'courseUp' | 'northUp' | 'free';
  markerVisible?: boolean;
  framesPerSecond?: 15 | 30 | 60;
  zoom: number;
  pitch: number;
  padding: {
    paddingTop: number;
    paddingBottom: number;
    paddingLeft: number;
    paddingRight: number;
  };
  animatedProps: object;
};

const NativeVroomMapCameraFollower = requireNativeComponent<VroomMapCameraFollowerProps>(
  'VroomMapCameraFollower',
);
const AnimatedNativeVroomMapCameraFollower = Animated.createAnimatedComponent(NativeVroomMapCameraFollower);

/** Invisible Mapbox feature. Native code applies the latest marker pose once per display frame. */
export function VroomMapCameraFollower({
  enabled,
  cameraMode = enabled ? 'courseUp' : 'free',
  markerVisible = true,
  framesPerSecond = 60,
  zoom,
  pitch,
  padding,
  animatedProps,
}: FollowerHostProps) {
  const { diagnosticsEnabled } = usePerformance();
  return (
    <AnimatedNativeVroomMapCameraFollower
      enabled={enabled}
      diagnosticsEnabled={diagnosticsEnabled}
      onMotionDiagnostics={diagnosticsEnabled ? (event) => recordNavigationMotion(event.nativeEvent) : undefined}
      cameraMode={cameraMode}
      markerVisible={markerVisible}
      framesPerSecond={framesPerSecond}
      zoom={zoom}
      pitch={pitch}
      paddingTop={padding.paddingTop}
      paddingBottom={padding.paddingBottom}
      paddingLeft={padding.paddingLeft}
      paddingRight={padding.paddingRight}
      animatedProps={animatedProps}
    />
  );
}
