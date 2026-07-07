import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Image,
  FlatList,
  Pressable,
  type NativeSyntheticEvent,
  type NativeScrollEvent,
} from 'react-native';

const DOUBLE_TAP_MS = 280;

export function VroomkiPhotoCarousel({
  photos,
  width,
  height,
  active = true,
  photoDurationMs = 3000,
  restartKey = 0,
  onDoubleTap,
  onIndexChange,
}: {
  photos: string[];
  width: number;
  height: number;
  active?: boolean;
  photoDurationMs?: number;
  restartKey?: number | string;
  onDoubleTap?: () => void;
  onIndexChange?: (index: number) => void;
}) {
  const listRef = useRef<FlatList<string>>(null);
  const [userDragging, setUserDragging] = useState(false);
  const photoIndexRef = useRef(0);
  const lastTapRef = useRef(0);

  const updateIndex = useCallback((idx: number) => {
    const clamped = Math.max(0, Math.min(idx, photos.length - 1));
    photoIndexRef.current = clamped;
    onIndexChange?.(clamped);
  }, [photos.length, onIndexChange]);

  useEffect(() => {
    photoIndexRef.current = 0;
    onIndexChange?.(0);
    listRef.current?.scrollToOffset({ offset: 0, animated: false });
  }, [photos, restartKey]);

  useEffect(() => {
    if (photos.length <= 1 || !active || userDragging) return undefined;
    const timer = setInterval(() => {
      const next = (photoIndexRef.current + 1) % photos.length;
      photoIndexRef.current = next;
      onIndexChange?.(next);
      listRef.current?.scrollToIndex({ index: next, animated: true });
    }, photoDurationMs);
    return () => clearInterval(timer);
  }, [photos.length, photoDurationMs, active, userDragging, restartKey, onIndexChange]);

  const onScrollEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const w = e.nativeEvent.layoutMeasurement.width || width;
    const idx = Math.round(e.nativeEvent.contentOffset.x / w);
    updateIndex(idx);
  };

  const handlePhotoPress = () => {
    if (!onDoubleTap) return;
    const now = Date.now();
    if (now - lastTapRef.current < DOUBLE_TAP_MS) {
      lastTapRef.current = 0;
      onDoubleTap();
      return;
    }
    lastTapRef.current = now;
  };

  if (photos.length === 0) return null;

  if (photos.length === 1) {
    return (
      <Pressable onPress={handlePhotoPress} style={{ width, height }}>
        <Image source={{ uri: photos[0] }} style={{ width, height }} resizeMode="cover" />
      </Pressable>
    );
  }

  return (
    <FlatList
      ref={listRef}
      data={photos}
      horizontal
      pagingEnabled
      nestedScrollEnabled
      showsHorizontalScrollIndicator={false}
      keyExtractor={(item, i) => `${item}-${i}`}
      getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
      onScrollBeginDrag={() => setUserDragging(true)}
      onScrollEndDrag={onScrollEnd}
      onMomentumScrollEnd={onScrollEnd}
      onScrollToIndexFailed={(info) => {
        listRef.current?.scrollToOffset({ offset: info.averageItemLength * info.index, animated: true });
      }}
      style={{ width, height }}
      renderItem={({ item }) => (
        <Pressable onPress={handlePhotoPress} style={{ width, height }}>
          <Image source={{ uri: item }} style={{ width, height }} resizeMode="cover" />
        </Pressable>
      )}
    />
  );
}
