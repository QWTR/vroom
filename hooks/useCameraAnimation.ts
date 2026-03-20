import { useCallback, useRef } from 'react';
import MapView from 'react-native-maps';

interface CameraParams {
  center:   { latitude: number; longitude: number };
  pitch:    number;
  heading:  number;
  zoom:     number;
  altitude?: number;
}

export function useCameraAnimation(mapRef: React.RefObject<MapView>) {
  const lastUpdateRef = useRef(0);

  const animateCameraSmooth = useCallback((params: CameraParams) => {
    const now = Date.now();
    // Throttle do 250ms żeby nie zalewać bridge'a
    if (now - lastUpdateRef.current < 250) return;
    lastUpdateRef.current = now;

    mapRef.current?.animateCamera(
      {
        center:  params.center,
        pitch:   params.pitch,
        heading: params.heading,
        zoom:    params.zoom,
        altitude: params.altitude ?? 0,
      },
      { duration: 300 },
    );
  }, [mapRef]);

  const resetCamera = useCallback((
    center: { latitude: number; longitude: number },
    zoom = 15,
  ) => {
    mapRef.current?.animateCamera(
      { center, pitch: 0, heading: 0, zoom, altitude: 0 },
      { duration: 800 },
    );
  }, [mapRef]);

  return { animateCameraSmooth, resetCamera };
}