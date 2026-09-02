import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Modal, TouchableOpacity, ActivityIndicator, StyleSheet, Dimensions } from 'react-native';
import { AppText as Text } from '../ui/AppText';
import { Image } from 'expo-image';
import * as ImageManipulator from 'expo-image-manipulator';
import { LinearGradient } from 'expo-linear-gradient';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  runOnJS,
} from 'react-native-reanimated';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import {
  clampBannerCropTransform,
  getCoverBaseScale,
  getHeroBannerAspectRatio,
  prepareBannerFromViewport,
  type BannerCropTransform,
} from '../../lib/profileBanner';
import type { ProfileBannerFocusPoint } from '../../constants/profilePremiumExtras';

const RED = '#E33835';

export type ProfileBannerCropResult = {
  croppedUri: string;
  focusPoint: ProfileBannerFocusPoint;
};

type Props = {
  visible: boolean;
  imageUri: string | null;
  /** Wymiary z ImagePicker — omija getSize (często pada na Androidzie). */
  imageWidth?: number;
  imageHeight?: number;
  themeBg?: string;
  busy?: boolean;
  onClose: () => void;
  onConfirm: (result: ProfileBannerCropResult) => void | Promise<void>;
};

function useFrameSize() {
  return useMemo(() => {
    const { width: sw, height: sh } = Dimensions.get('window');
    let frameW = sw - 32;
    let frameH = frameW / getHeroBannerAspectRatio();
    const maxH = sh * 0.46;
    if (frameH > maxH) {
      frameH = maxH;
      frameW = frameH * getHeroBannerAspectRatio();
    }
    return { frameW, frameH };
  }, []);
}

async function resolveImageSize(
  uri: string,
  pickerW?: number,
  pickerH?: number,
): Promise<{ w: number; h: number } | null> {
  if (pickerW && pickerH && pickerW > 0 && pickerH > 0) {
    return { w: pickerW, h: pickerH };
  }
  try {
    const info = await ImageManipulator.manipulateAsync(uri, []);
    if (info.width > 0 && info.height > 0) {
      return { w: info.width, h: info.height };
    }
  } catch { /* fallback below */ }
  return null;
}

export function ProfileBannerCropModal({
  visible,
  imageUri,
  imageWidth,
  imageHeight,
  themeBg = '#090909',
  busy = false,
  onClose,
  onConfirm,
}: Props) {
  const { frameW, frameH } = useFrameSize();
  const [sizeReady, setSizeReady] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [preparing, setPreparing] = useState(false);

  const imgW = useSharedValue(0);
  const imgH = useSharedValue(0);
  const baseScale = useSharedValue(1);
  const userScale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const panX = useSharedValue(0);
  const panY = useSharedValue(0);
  const savedPanX = useSharedValue(0);
  const savedPanY = useSharedValue(0);

  const resetTransform = useCallback(() => {
    userScale.value = 1;
    savedScale.value = 1;
    panX.value = 0;
    panY.value = 0;
    savedPanX.value = 0;
    savedPanY.value = 0;
  }, [panX, panY, savedPanX, savedPanY, savedScale, userScale]);

  useEffect(() => {
    if (!visible || !imageUri) {
      imgW.value = 0;
      imgH.value = 0;
      baseScale.value = 1;
      setSizeReady(false);
      setLoadError(false);
      return;
    }

    let cancelled = false;
    resetTransform();
    setSizeReady(false);
    setLoadError(false);

    void (async () => {
      const size = await resolveImageSize(imageUri, imageWidth, imageHeight);
      if (cancelled) return;
      if (!size) {
        setLoadError(true);
        return;
      }
      imgW.value = size.w;
      imgH.value = size.h;
      baseScale.value = getCoverBaseScale(size.w, size.h, frameW, frameH);
      setSizeReady(true);
    })();

    return () => { cancelled = true; };
  }, [visible, imageUri, imageWidth, imageHeight, frameW, frameH, resetTransform, imgW, imgH, baseScale]);

  const applyClamp = useCallback(
    (scale: number, tx: number, ty: number) => {
      const w = imgW.value;
      const h = imgH.value;
      if (w <= 0 || h <= 0) return;
      const c = clampBannerCropTransform(w, h, frameW, frameH, {
        scale,
        translateX: tx,
        translateY: ty,
      });
      userScale.value = c.scale;
      savedScale.value = c.scale;
      panX.value = c.translateX;
      panY.value = c.translateY;
      savedPanX.value = c.translateX;
      savedPanY.value = c.translateY;
    },
    [frameW, frameH, imgW, imgH, panX, panY, savedPanX, savedPanY, savedScale, userScale],
  );

  const pinch = Gesture.Pinch()
    .onUpdate((e) => {
      userScale.value = Math.max(1, Math.min(4, savedScale.value * e.scale));
    })
    .onEnd(() => {
      runOnJS(applyClamp)(userScale.value, panX.value, panY.value);
    });

  const pan = Gesture.Pan()
    .onUpdate((e) => {
      panX.value = savedPanX.value + e.translationX;
      panY.value = savedPanY.value + e.translationY;
    })
    .onEnd(() => {
      savedPanX.value = panX.value;
      savedPanY.value = panY.value;
      runOnJS(applyClamp)(userScale.value, panX.value, panY.value);
    });

  const composed = Gesture.Simultaneous(pan, pinch);

  const imageAnimStyle = useAnimatedStyle(() => {
    const w = imgW.value;
    const h = imgH.value;
    if (w <= 0 || h <= 0) {
      return { opacity: 0, width: 0, height: 0 };
    }
    const totalScale = baseScale.value * userScale.value;
    const dispW = w * totalScale;
    const dispH = h * totalScale;
    return {
      opacity: 1,
      position: 'absolute',
      width: dispW,
      height: dispH,
      left: (frameW - dispW) / 2 + panX.value,
      top: (frameH - dispH) / 2 + panY.value,
    };
  });

  const handleConfirm = async () => {
    if (!imageUri || !sizeReady) return;
    const w = imgW.value;
    const h = imgH.value;
    if (w <= 0 || h <= 0) return;

    setPreparing(true);
    try {
      const transform: BannerCropTransform = clampBannerCropTransform(w, h, frameW, frameH, {
        scale: userScale.value,
        translateX: panX.value,
        translateY: panY.value,
      });
      const prepared = await prepareBannerFromViewport(
        imageUri,
        w,
        h,
        frameW,
        frameH,
        transform,
      );
      await onConfirm({ croppedUri: prepared.uri, focusPoint: prepared.focusPoint });
    } finally {
      setPreparing(false);
    }
  };

  const handleZoomIn = () => {
    applyClamp(Math.min(4, savedScale.value + 0.25), savedPanX.value, savedPanY.value);
  };

  const handleZoomOut = () => {
    applyClamp(Math.max(1, savedScale.value - 0.25), savedPanX.value, savedPanY.value);
  };

  const isBusy = busy || preparing;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={() => { if (!isBusy) onClose(); }}
    >
      <GestureHandlerRootView style={{ flex: 1 }}>
        <View style={[styles.root, { backgroundColor: themeBg }]}>
          <View style={styles.header}>
            <TouchableOpacity onPress={onClose} disabled={isBusy} style={styles.iconBtn}>
              <MaterialIcons name="close" size={22} color="#fff" />
            </TouchableOpacity>
            <View style={styles.headerCenter}>
              <Text style={styles.title}>KADROWANIE BANERA</Text>
              <Text style={styles.subtitle}>Przesuń i przybliż — tak będzie na profilu</Text>
            </View>
            <TouchableOpacity onPress={resetTransform} disabled={isBusy} style={styles.iconBtn}>
              <MaterialIcons name="refresh" size={22} color="#fff" />
            </TouchableOpacity>
          </View>

          <View style={styles.frameWrap}>
            <View style={[styles.frame, { width: frameW, height: frameH }]}>
              {imageUri && sizeReady ? (
                <GestureDetector gesture={composed}>
                  <View style={{ width: frameW, height: frameH }}>
                    <Animated.View style={imageAnimStyle}>
                      <Image
                        source={{ uri: imageUri }}
                        style={StyleSheet.absoluteFill}
                        contentFit="fill"
                        cachePolicy="none"
                      />
                    </Animated.View>
                  </View>
                </GestureDetector>
              ) : loadError ? (
                <View style={styles.loader}>
                  <MaterialIcons name="broken-image" size={32} color={RED} />
                  <Text style={styles.errorText}>Nie udało się wczytać zdjęcia</Text>
                </View>
              ) : (
                <View style={styles.loader}>
                  <ActivityIndicator color={RED} />
                </View>
              )}

              <View style={StyleSheet.absoluteFill} pointerEvents="none">
                <View style={[styles.corner, styles.cTL]} />
                <View style={[styles.corner, styles.cTR]} />
                <View style={[styles.corner, styles.cBL]} />
                <View style={[styles.corner, styles.cBR]} />
              </View>

              <LinearGradient
                colors={['transparent', themeBg]}
                style={StyleSheet.absoluteFill}
                pointerEvents="none"
              />

              <View style={styles.avatarMock} pointerEvents="none">
                <View style={styles.avatarCircle} />
                <View style={styles.avatarBarShort} />
                <View style={styles.avatarBarLong} />
              </View>
            </View>
          </View>

          <View style={styles.zoomRow}>
            <TouchableOpacity onPress={handleZoomOut} disabled={isBusy || !sizeReady} style={styles.zoomBtn}>
              <MaterialIcons name="remove" size={22} color="#fff" />
            </TouchableOpacity>
            <Text style={styles.zoomHint}>SZPINAĆ · PRZESUŃ PALCEM</Text>
            <TouchableOpacity onPress={handleZoomIn} disabled={isBusy || !sizeReady} style={styles.zoomBtn}>
              <MaterialIcons name="add" size={22} color="#fff" />
            </TouchableOpacity>
          </View>

          <View style={styles.footer}>
            <TouchableOpacity
              onPress={onClose}
              disabled={isBusy}
              style={[styles.btn, styles.btnGhost]}
            >
              <Text style={styles.btnGhostText}>ANULUJ</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => void handleConfirm()}
              disabled={isBusy || !sizeReady}
              style={[styles.btn, styles.btnPrimary, (isBusy || !sizeReady) && { opacity: 0.5 }]}
            >
              {isBusy ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={styles.btnPrimaryText}>ZAPISZ BANER</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
}

const CORNER = 22;
const styles = StyleSheet.create({
  root: { flex: 1, paddingTop: 48 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingBottom: 12,
  },
  headerCenter: { flex: 1, alignItems: 'center' },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  title: {
    fontFamily: 'Manrope_600SemiBold',
    fontSize: 13,
    fontWeight: '900',
    color: '#fff',
    letterSpacing: 1,
  },
  subtitle: {
    fontFamily: 'Manrope_600SemiBold',
    fontSize: 12,
    color: 'rgba(255,255,255,0.45)',
    marginTop: 4,
    textAlign: 'center',
  },
  frameWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  frame: {
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: '#111',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  loader: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 },
  errorText: {
    fontFamily: 'Manrope_600SemiBold',
    fontSize: 12,
    color: 'rgba(255,255,255,0.5)',
    textAlign: 'center',
    paddingHorizontal: 20,
  },
  corner: {
    position: 'absolute',
    width: CORNER,
    height: CORNER,
    borderColor: '#fff',
  },
  cTL: { top: 10, left: 10, borderTopWidth: 2, borderLeftWidth: 2 },
  cTR: { top: 10, right: 10, borderTopWidth: 2, borderRightWidth: 2 },
  cBL: { bottom: 10, left: 10, borderBottomWidth: 2, borderLeftWidth: 2 },
  cBR: { bottom: 10, right: 10, borderBottomWidth: 2, borderRightWidth: 2 },
  avatarMock: {
    position: 'absolute',
    bottom: 28,
    left: 0,
    right: 0,
    alignItems: 'center',
    opacity: 0.35,
  },
  avatarCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 2,
    borderColor: '#fff',
    marginBottom: 8,
  },
  avatarBarShort: {
    width: 80,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#fff',
    marginBottom: 6,
  },
  avatarBarLong: {
    width: 120,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#fff',
  },
  zoomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    paddingVertical: 12,
    paddingHorizontal: 20,
  },
  zoomBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  zoomHint: {
    flex: 1,
    fontFamily: 'Manrope_600SemiBold',
    fontSize: 12,
    color: 'rgba(255,255,255,0.4)',
    textAlign: 'center',
    letterSpacing: 0.5,
  },
  footer: {
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 20,
    paddingBottom: 32,
  },
  btn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnGhost: {
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  btnGhostText: {
    fontFamily: 'Manrope_600SemiBold',
    fontSize: 12,
    color: 'rgba(255,255,255,0.6)',
    fontWeight: '700',
  },
  btnPrimary: { backgroundColor: RED },
  btnPrimaryText: {
    fontFamily: 'Manrope_600SemiBold',
    fontSize: 12,
    color: '#fff',
    fontWeight: '900',
  },
});

export default ProfileBannerCropModal;
