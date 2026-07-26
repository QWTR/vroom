import React, { useRef, useEffect } from 'react';
import { PixelRatio, View } from 'react-native';
import ViewShot from 'react-native-view-shot';
import Svg, { Path } from 'react-native-svg';

/** Logical size; capture is multiplied by PixelRatio for sharp browse MarkerView. */
export const ARROW_MARKER_SIZE = 64;
const CAPTURE_SIZE = Math.round(ARROW_MARKER_SIZE * Math.max(2, PixelRatio.get()));

interface ArrowMarkerRendererProps {
  onCapture: (uri: string) => void;
}

export const ArrowMarkerRenderer = ({ onCapture }: ArrowMarkerRendererProps) => {
  const shotRef = useRef<ViewShot>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      shotRef.current?.capture?.().then(onCapture).catch(() => {});
    }, 50);
    return () => clearTimeout(timer);
  }, [onCapture]);

  return (
    <View style={{
      position: 'absolute',
      top: 0,
      left: -10_000,
      width: ARROW_MARKER_SIZE,
      height: ARROW_MARKER_SIZE,
      opacity: 0,
      overflow: 'hidden',
      pointerEvents: 'none',
    }}>
      <ViewShot
        ref={shotRef}
        options={{ format: 'png', quality: 1, width: CAPTURE_SIZE, height: CAPTURE_SIZE }}
      >
        <View style={{
          width: ARROW_MARKER_SIZE,
          height: ARROW_MARKER_SIZE,
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: ARROW_MARKER_SIZE / 2,
          backgroundColor: '#e33835',
          borderWidth: 3,
          borderColor: '#ffffff',
        }}>
          <Svg width={38} height={38} viewBox="0 0 38 38">
            <Path
              d="M19 3 L32 34 L19 28 L6 34 Z"
              fill="#ffffff"
              stroke="#ffffff"
              strokeWidth={1.5}
              strokeLinejoin="round"
            />
          </Svg>
        </View>
      </ViewShot>
    </View>
  );
};
