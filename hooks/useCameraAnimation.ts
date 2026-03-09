import { useRef, useCallback } from 'react';
import MapView from 'react-native-maps';

export const useCameraAnimation = (mapRef: React.RefObject<MapView>) => {
  const lastCameraUpdateRef = useRef<number>(0);
  const cameraAnimationQueueRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const animateCameraSmooth = useCallback(
    (config: any) => {
      const now = Date.now();
      if (now - lastCameraUpdateRef.current < 300) {
        if (cameraAnimationQueueRef.current)
          clearTimeout(cameraAnimationQueueRef.current);
        cameraAnimationQueueRef.current = setTimeout(() => {
          mapRef.current?.animateCamera(config, { duration: 300 });
          lastCameraUpdateRef.current = Date.now();
        }, 300);
      } else {
        mapRef.current?.animateCamera(config, { duration: 300 });
        lastCameraUpdateRef.current = now;
      }
    },
    [mapRef],
  );

  return { animateCameraSmooth };
};