import React, { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  PanResponder,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { Canvas, useFrame, useLoader } from '@react-three/fiber/native';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as THREE from 'three';
import type { CatalogItem } from '../../hooks/useProfileShop';
import { normalizeMediaUri } from '../../lib/mediaUri';
import { sanitizeGlbForExpoGl } from '../../lib/sanitizeGlbForExpoGl';
import { normalizeVehicleModelMeta } from '../../lib/vehicleModelMeta';
import { resolveMapVehicleScale } from '../../lib/mapVehicleScale';
import { useHeavySurface } from '../../hooks/useHeavySurface';

type Props = {
  item: CatalogItem;
  height?: number;
  isDark: boolean;
};

type BoundaryProps = {
  resetKey: string;
  fallback: React.ReactNode;
  onError: () => void;
  children: React.ReactNode;
};

class PreviewErrorBoundary extends React.PureComponent<BoundaryProps, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch() {
    this.props.onError();
  }

  componentDidUpdate(prevProps: BoundaryProps) {
    if (prevProps.resetKey !== this.props.resetKey && this.state.failed) {
      this.setState({ failed: false });
    }
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

function VehicleModel({
  url,
  item,
  rotationYRef,
  zoomRef,
  onLoaded,
}: {
  url: string;
  item: CatalogItem;
  rotationYRef: React.MutableRefObject<number>;
  zoomRef: React.MutableRefObject<number>;
  onLoaded: () => void;
}) {
  const gltf = useLoader(GLTFLoader, url);
  const groupRef = useRef<THREE.Group>(null);
  const meta = useMemo(() => normalizeVehicleModelMeta(item.metadata), [item.metadata]);

  const prepared = useMemo(() => {
    const root = gltf.scene.clone(true);
    sanitizeGlbForExpoGl(root);
    const [sx, sy, sz] = resolveMapVehicleScale(meta.scale);
    root.scale.set(sx, sy, sz);

    const box = new THREE.Box3().setFromObject(root);
    const center = new THREE.Vector3();
    const size = new THREE.Vector3();
    box.getCenter(center);
    box.getSize(size);
    root.position.sub(center);

    const maxDim = Math.max(size.x, size.y, size.z, 0.01);
    const fitScale = 2.35 / maxDim;
    return { root, fitScale };
  }, [gltf.scene, meta.scale]);

  useEffect(() => {
    onLoaded();
  }, [onLoaded]);

  useFrame(() => {
    const group = groupRef.current;
    if (!group) return;
    group.rotation.x = THREE.MathUtils.degToRad(Number(meta.pitch) || 0);
    group.rotation.y = rotationYRef.current + THREE.MathUtils.degToRad(Number(meta.yawOffset) || 0);
    group.rotation.z = THREE.MathUtils.degToRad(Number(meta.roll) || 0);
    group.scale.setScalar(prepared.fitScale * zoomRef.current);
  });

  return (
    <group ref={groupRef} scale={prepared.fitScale} position={[0, -0.12, 0]}>
      <primitive object={prepared.root} />
    </group>
  );
}

function PreviewFallback({ item, isDark }: { item: CatalogItem; isDark: boolean }) {
  const preview = normalizeMediaUri(item.previewUrl ?? item.assetUrl);
  return (
    <View style={[styles.fallback, { backgroundColor: isDark ? '#0b0b0c' : '#f0f0f2' }]}>
      {preview ? (
        <Image source={{ uri: preview }} style={StyleSheet.absoluteFill} contentFit="cover" />
      ) : null}
      <View style={styles.fallbackBadge}>
        <Text style={styles.fallbackText}>PODGLAD 3D NIEDOSTEPNY</Text>
      </View>
    </View>
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function touchDistance(touches: ArrayLike<{ pageX: number; pageY: number }>): number {
  if (touches.length < 2) return 0;
  const a = touches[0];
  const b = touches[1];
  return Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY);
}

export function VehicleModelPreview3D({ item, height = 220, isDark }: Props) {
  useHeavySurface('three:vehicle-preview');
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const rotationYRef = useRef(0);
  const zoomRef = useRef(1);
  const dragStartRotationRef = useRef(0);
  const pinchStartDistanceRef = useRef(0);
  const pinchStartZoomRef = useRef(1);
  const isPinchingRef = useRef(false);
  const invalidateRef = useRef<(() => void) | null>(null);
  const modelUrl = normalizeMediaUri(item.assetUrl);

  useEffect(() => {
    rotationYRef.current = 0;
    zoomRef.current = 1;
    setLoading(true);
    setFailed(false);
  }, [item.id, modelUrl]);

  const panResponder = useMemo(
    () => PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dx) > 2 || Math.abs(gesture.dy) > 2,
      onPanResponderGrant: (evt) => {
        const touches = evt.nativeEvent.touches;
        if (touches.length >= 2) {
          isPinchingRef.current = true;
          pinchStartDistanceRef.current = touchDistance(touches);
          pinchStartZoomRef.current = zoomRef.current;
          return;
        }
        isPinchingRef.current = false;
        dragStartRotationRef.current = rotationYRef.current;
      },
      onPanResponderMove: (evt, gesture) => {
        const touches = evt.nativeEvent.touches;
        if (touches.length >= 2) {
          const nextDistance = touchDistance(touches);
          if (!isPinchingRef.current || pinchStartDistanceRef.current <= 0) {
            isPinchingRef.current = true;
            pinchStartDistanceRef.current = nextDistance;
            pinchStartZoomRef.current = zoomRef.current;
            return;
          }
          const startDistance = pinchStartDistanceRef.current;
          if (startDistance > 0 && nextDistance > 0) {
            zoomRef.current = clamp(pinchStartZoomRef.current * (nextDistance / startDistance), 0.72, 1.75);
            invalidateRef.current?.();
          }
          return;
        }
        if (isPinchingRef.current) {
          isPinchingRef.current = false;
          dragStartRotationRef.current = rotationYRef.current - gesture.dx * 0.024;
        }
        rotationYRef.current = dragStartRotationRef.current + gesture.dx * 0.024;
        invalidateRef.current?.();
      },
      onPanResponderRelease: () => {
        isPinchingRef.current = false;
        pinchStartDistanceRef.current = 0;
      },
      onPanResponderTerminate: () => {
        isPinchingRef.current = false;
        pinchStartDistanceRef.current = 0;
      },
      onPanResponderTerminationRequest: () => false,
    }),
    [],
  );

  if (!modelUrl || failed) {
    return <PreviewFallback item={item} isDark={isDark} />;
  }

  return (
    <View
      style={[
        styles.root,
        {
          height,
          backgroundColor: isDark ? '#08090a' : '#eef0f3',
        },
      ]}
      {...panResponder.panHandlers}
    >
      <PreviewErrorBoundary
        resetKey={`${item.id}:${modelUrl}`}
        fallback={<PreviewFallback item={item} isDark={isDark} />}
        onError={() => {
          setLoading(false);
          setFailed(true);
        }}
      >
        <Canvas
          frameloop="demand"
          onCreated={({ invalidate }) => { invalidateRef.current = invalidate; }}
          camera={{ position: [0, 1.2, 4.2], fov: 35 }}
          style={{ ...StyleSheet.absoluteFillObject }}
          gl={{ antialias: true, alpha: true }}
        >
          <color attach="background" args={[isDark ? '#08090a' : '#eef0f3']} />
          <ambientLight intensity={1.15} />
          <directionalLight position={[3, 4, 5]} intensity={2.1} />
          <directionalLight position={[-4, 2, -3]} intensity={0.85} />
          <Suspense fallback={null}>
            <VehicleModel
              url={modelUrl}
              item={item}
              rotationYRef={rotationYRef}
              zoomRef={zoomRef}
              onLoaded={() => setLoading(false)}
            />
          </Suspense>
        </Canvas>
      </PreviewErrorBoundary>
      {loading ? (
        <View style={styles.loading} pointerEvents="none">
          <ActivityIndicator color="#e33835" />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    width: '100%',
    borderRadius: 16,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  loading: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.12)',
  },
  fallback: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fallbackBadge: {
    borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.62)',
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  fallbackText: {
    color: '#fff',
    fontFamily: 'Orbitron',
    fontSize: 8,
    letterSpacing: 1,
    fontWeight: '800',
  },
});
