import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, PanResponder, StyleSheet, type GestureResponderEvent } from 'react-native';
import { VroomkiStyledText } from './VroomkiStyledText';
import type { VroomkiTextOverlay } from '../../lib/vroomkiTypes';

const SNAP_THRESHOLD = 18;

function touchDistance(touches: readonly { pageX: number; pageY: number }[]) {
  if (touches.length < 2) return 0;
  const dx = touches[0].pageX - touches[1].pageX;
  const dy = touches[0].pageY - touches[1].pageY;
  return Math.sqrt(dx * dx + dy * dy);
}

export function VroomkiDraggableOverlay({
  overlay,
  width,
  height,
  selected,
  onSelect,
  onChange,
  onSnapChange,
}: {
  overlay: VroomkiTextOverlay;
  width: number;
  height: number;
  selected: boolean;
  onSelect: () => void;
  onChange: (patch: { x: number; y: number; scale: number }) => void;
  onSnapChange?: (snap: { horizontal: boolean; vertical: boolean }) => void;
}) {
  const centerX = width * 0.5;
  const centerY = height * 0.5;

  const [pos, setPos] = useState({ x: overlay.x * width, y: overlay.y * height });
  const [scale, setScale] = useState(overlay.scale);

  const posRef = useRef(pos);
  const scaleRef = useRef(scale);
  const dragStartRef = useRef({ x: overlay.x * width, y: overlay.y * height });
  const pinchStartDistRef = useRef(0);
  const pinchStartScaleRef = useRef(overlay.scale);
  const isPinchingRef = useRef(false);

  const onSelectRef = useRef(onSelect);
  const onChangeRef = useRef(onChange);
  const onSnapChangeRef = useRef(onSnapChange);
  onSelectRef.current = onSelect;
  onChangeRef.current = onChange;
  onSnapChangeRef.current = onSnapChange;

  useEffect(() => {
    const nextPos = { x: overlay.x * width, y: overlay.y * height };
    posRef.current = nextPos;
    dragStartRef.current = nextPos;
    scaleRef.current = overlay.scale;
    setPos(nextPos);
    setScale(overlay.scale);
  }, [overlay.x, overlay.y, overlay.scale, width, height]);

  const panResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onStartShouldSetPanResponderCapture: () => true,
    onMoveShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponderCapture: () => true,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: (evt: GestureResponderEvent) => {
      onSelectRef.current();
      const touches = evt.nativeEvent.touches;
      if (touches.length >= 2) {
        isPinchingRef.current = true;
        pinchStartDistRef.current = touchDistance(touches);
        pinchStartScaleRef.current = scaleRef.current;
      } else {
        isPinchingRef.current = false;
        pinchStartDistRef.current = 0;
        dragStartRef.current = { ...posRef.current };
      }
    },
    onPanResponderMove: (evt: GestureResponderEvent, gesture) => {
      const touches = evt.nativeEvent.touches;

      if (touches.length >= 2) {
        if (!isPinchingRef.current) {
          isPinchingRef.current = true;
          pinchStartDistRef.current = touchDistance(touches);
          pinchStartScaleRef.current = scaleRef.current;
        }
        const dist = touchDistance(touches);
        if (pinchStartDistRef.current > 0 && dist > 0) {
          const nextScale = Math.max(
            0.4,
            Math.min(3.5, pinchStartScaleRef.current * (dist / pinchStartDistRef.current)),
          );
          scaleRef.current = nextScale;
          setScale(nextScale);
        }
        return;
      }

      if (isPinchingRef.current) return;

      let nx = dragStartRef.current.x + gesture.dx;
      let ny = dragStartRef.current.y + gesture.dy;
      const snapH = Math.abs(nx - centerX) < SNAP_THRESHOLD;
      const snapV = Math.abs(ny - centerY) < SNAP_THRESHOLD;
      if (snapH) nx = centerX;
      if (snapV) ny = centerY;
      const next = {
        x: Math.max(0, Math.min(width, nx)),
        y: Math.max(0, Math.min(height, ny)),
      };
      posRef.current = next;
      setPos(next);
      onSnapChangeRef.current?.({ horizontal: snapH, vertical: snapV });
    },
    onPanResponderRelease: () => {
      isPinchingRef.current = false;
      pinchStartDistRef.current = 0;
      onChangeRef.current({
        x: posRef.current.x / width,
        y: posRef.current.y / height,
        scale: scaleRef.current,
      });
      onSnapChangeRef.current?.({ horizontal: false, vertical: false });
    },
  }), [centerX, centerY, width, height]);

  return (
    <View
      {...panResponder.panHandlers}
      collapsable={false}
      style={{
        position: 'absolute',
        left: pos.x,
        top: pos.y,
        transform: [
          { translateX: '-50%' },
          { translateY: '-50%' },
          { rotate: `${overlay.rotation}deg` },
          { scale },
        ],
        maxWidth: width * 0.86,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: selected ? 1 : 0,
        borderColor: '#e33835',
        borderRadius: 8,
        padding: 8,
        zIndex: selected ? 20 : 10,
      }}
    >
      <VroomkiStyledText overlay={overlay} fontSize={overlay.fontSize} />
    </View>
  );
}

export function VroomkiSnapGuides({
  width,
  height,
  snap,
}: {
  width: number;
  height: number;
  snap: { horizontal: boolean; vertical: boolean };
}) {
  if (!snap.horizontal && !snap.vertical) return null;
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {snap.vertical && (
        <View style={{
          position: 'absolute',
          left: width / 2,
          top: 0,
          bottom: 0,
          width: 1,
          backgroundColor: '#00e5ff',
          opacity: 0.85,
        }} />
      )}
      {snap.horizontal && (
        <View style={{
          position: 'absolute',
          top: height / 2,
          left: 0,
          right: 0,
          height: 1,
          backgroundColor: '#00e5ff',
          opacity: 0.85,
        }} />
      )}
    </View>
  );
}
