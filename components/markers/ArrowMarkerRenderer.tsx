import React, { useRef, useEffect } from 'react';
import { View } from 'react-native';
import ViewShot from 'react-native-view-shot';
import { MaterialIcons } from '@expo/vector-icons';

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
      position: 'absolute', top: 0, left: 0,
      opacity: 0, zIndex: -999, pointerEvents: 'none',
    }}>
      <ViewShot
        ref={shotRef}
        options={{ format: 'png', quality: 1.0 }}
      >
        <View style={{
          width: 60,
          height: 60,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: 'transparent',
        }}>
          <View style={{
            width: 50,
            height: 50,
            borderRadius: 25,
            backgroundColor: '#e33835',
            justifyContent: 'center',
            alignItems: 'center',
            borderWidth: 2.5,
            borderColor: '#ffffff',
          }}>
            <MaterialIcons name="navigation" size={28} color="#ffffff" />
          </View>
        </View>
      </ViewShot>
    </View>
  );
};
