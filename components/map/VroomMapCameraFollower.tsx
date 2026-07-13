import { requireNativeComponent, type ViewProps } from 'react-native';
import Animated from 'react-native-reanimated';

export type VroomMapCameraFollowerProps = ViewProps & {
  enabled: boolean;
  markerVisible: boolean;
  positionValid?: number;
  latitude?: number;
  longitude?: number;
  heading?: number;
  zoom: number;
  pitch: number;
  paddingTop: number;
  paddingBottom: number;
  paddingLeft: number;
  paddingRight: number;
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
};

const NativeVroomMapCameraFollower = requireNativeComponent<VroomMapCameraFollowerProps>(
  'VroomMapCameraFollower',
);
const AnimatedNativeVroomMapCameraFollower = Animated.createAnimatedComponent(NativeVroomMapCameraFollower);

/** Invisible Mapbox feature. Native code applies the latest marker pose once per display frame. */
export function VroomMapCameraFollower({ enabled, markerVisible = true, zoom, pitch, padding, animatedProps }: FollowerHostProps) {
  return (
    <AnimatedNativeVroomMapCameraFollower
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
}
