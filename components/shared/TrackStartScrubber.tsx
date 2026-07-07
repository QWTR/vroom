import React, { useRef, useState } from 'react';
import { View, Text, PanResponder, type LayoutChangeEvent } from 'react-native';

function formatMs(ms: number) {
  const sec = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function TrackStartScrubber({
  valueMs,
  maxMs,
  onChange,
  accent = '#e33835',
  label = 'OD KIEDY GRA',
  hint,
}: {
  valueMs: number;
  maxMs: number;
  onChange: (ms: number) => void;
  accent?: string;
  label?: string;
  hint?: string;
}) {
  const trackW = useRef(280);
  const [dragging, setDragging] = useState(false);
  const onChangeRef = useRef(onChange);
  const safeMax = Math.max(1000, maxMs);
  const maxStart = Math.max(0, safeMax - 500);

  onChangeRef.current = onChange;

  const msFromX = (x: number) => {
    const ratio = Math.max(0, Math.min(1, x / Math.max(1, trackW.current)));
    return Math.round(ratio * maxStart);
  };

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (evt) => {
        setDragging(true);
        onChangeRef.current(msFromX(evt.nativeEvent.locationX));
      },
      onPanResponderMove: (evt) => {
        onChangeRef.current(msFromX(evt.nativeEvent.locationX));
      },
      onPanResponderRelease: () => setDragging(false),
      onPanResponderTerminate: () => setDragging(false),
    }),
  ).current;

  const onLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    if (w > 0) trackW.current = w;
  };

  const thumbRatio = Math.max(0, Math.min(1, valueMs / Math.max(1, maxStart)));

  return (
    <View style={{ marginTop: 12 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <Text style={{ fontFamily: 'Orbitron', fontSize: 9, color: '#fff', letterSpacing: 1 }}>{label}</Text>
        <Text style={{ fontFamily: 'Orbitron', fontSize: 10, color: accent }}>{formatMs(valueMs)}</Text>
      </View>
      <View
        onLayout={onLayout}
        {...pan.panHandlers}
        style={{ height: 48, justifyContent: 'center', paddingVertical: 16 }}
      >
        <View style={{ height: 8, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.14)' }}>
          <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${thumbRatio * 100}%`, backgroundColor: accent, borderRadius: 4, opacity: 0.55 }} />
        </View>
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: `${thumbRatio * 100}%`,
            marginLeft: -10,
            width: 20,
            height: 20,
            borderRadius: 10,
            backgroundColor: dragging ? '#fff' : accent,
            borderWidth: 2,
            borderColor: '#fff',
            top: 14,
          }}
        />
      </View>
      {!!hint && (
        <Text style={{ color: '#ffffff88', fontSize: 10, marginTop: 6, lineHeight: 14 }}>{hint}</Text>
      )}
    </View>
  );
}
