import React, { forwardRef, memo, type ReactNode } from 'react';
import { Platform, type ViewProps } from 'react-native';
import Mapbox from '@rnmapbox/maps';

export type MapCanvasProps = {
  styleURL: string;
  style?: ViewProps['style'];
  onPress?: (e: any) => void;
  onLongPress?: (e: any) => void;
  onMapIdle?: (e: any) => void;
  onCameraChanged?: (e: any) => void;
  children?: ReactNode;
};

/**
 * Memoized MapView shell — position updates live in child layers (puck, camera)
 * so this component does not re-render on every GPS tick.
 */
export const MapCanvas = memo(
  forwardRef<Mapbox.MapView, MapCanvasProps>(function MapCanvas(
    {
      styleURL,
      style,
      onPress,
      onLongPress,
      onMapIdle,
      onCameraChanged,
      children,
    },
    ref,
  ) {
    return (
      <Mapbox.MapView
        ref={ref}
        style={style ?? { flex: 1 }}
        styleURL={styleURL}
        logoEnabled={false}
        attributionEnabled={false}
        compassEnabled={false}
        surfaceView={Platform.OS === 'android' ? false : undefined}
        pitchEnabled
        rotateEnabled
        onPress={onPress}
        onLongPress={onLongPress}
        onMapIdle={onMapIdle}
        onCameraChanged={onCameraChanged}
      >
        {children}
      </Mapbox.MapView>
    );
  }),
);
