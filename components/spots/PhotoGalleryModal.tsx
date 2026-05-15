import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Modal, View, Text, TouchableOpacity,
  ScrollView, Dimensions, StatusBar, Platform,
  type NativeSyntheticEvent, type NativeScrollEvent,
} from 'react-native';
import { Image } from 'expo-image';
import { MaterialIcons } from '@expo/vector-icons';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

interface PhotoGalleryModalProps {
  visible: boolean;
  photos: string[];
  initialIndex?: number;
  spotName: string;
  onClose: () => void;
}

export const PhotoGalleryModal = ({ visible, photos, initialIndex = 0, spotName, onClose }: PhotoGalleryModalProps) => {
  const scrollRef = useRef<ScrollView>(null);
  const [currentIndex, setCurrentIndex] = useState(0);

  const safeIndex = useCallback(
    (idx: number) => {
      if (!photos.length) return 0;
      return Math.min(Math.max(0, idx), photos.length - 1);
    },
    [photos.length],
  );

  useEffect(() => {
    if (!visible || !photos.length) return;
    const idx = safeIndex(initialIndex);
    setCurrentIndex(idx);
    const t = setTimeout(() => {
      scrollRef.current?.scrollTo({ x: idx * SCREEN_W, animated: false });
    }, 50);
    return () => clearTimeout(t);
  }, [visible, initialIndex, photos.length, safeIndex]);

  const onScrollEnd = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const x = e.nativeEvent.contentOffset.x;
    setCurrentIndex(safeIndex(Math.round(x / SCREEN_W)));
  }, [safeIndex]);

  if (!photos.length) return null;

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent={false}
      presentationStyle="fullScreen"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <StatusBar hidden={Platform.OS === 'android'} />
      <View style={{ flex: 1, backgroundColor: '#000' }}>

        <View style={{
          flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
          paddingTop: Platform.OS === 'ios' ? 54 : 50, paddingHorizontal: 16, paddingBottom: 12,
          backgroundColor: '#000000cc', zIndex: 10,
        }}>
          <TouchableOpacity
            style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: '#ffffff15', justifyContent: 'center', alignItems: 'center' }}
            onPress={onClose}
            activeOpacity={0.8}
          >
            <MaterialIcons name="close" size={24} color="#fff" />
          </TouchableOpacity>
          <View style={{ flex: 1, alignItems: 'center' }}>
            <Text style={{ color: '#fff', fontSize: 14, fontWeight: '700' }} numberOfLines={1}>{spotName}</Text>
            <Text style={{ color: '#ffffff60', fontSize: 12, marginTop: 2 }}>{currentIndex + 1} / {photos.length}</Text>
          </View>
          <View style={{ width: 44 }} />
        </View>

        <ScrollView
          ref={scrollRef}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={onScrollEnd}
          style={{ flex: 1 }}
          contentContainerStyle={{ alignItems: 'center' }}
        >
          {photos.map((uri, i) => (
            <View
              key={`${uri}_${i}`}
              style={{ width: SCREEN_W, height: SCREEN_H - 120, justifyContent: 'center', alignItems: 'center' }}
            >
              <Image
                source={{ uri }}
                style={{ width: SCREEN_W, height: SCREEN_H - 120 }}
                contentFit="contain"
                transition={0}
                cachePolicy="memory-disk"
              />
            </View>
          ))}
        </ScrollView>

        {photos.length > 1 && (
          <View style={{ position: 'absolute', bottom: 40, left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', gap: 6 }}>
            {photos.map((_, i) => (
              <TouchableOpacity
                key={i}
                style={[
                  { width: 6, height: 6, borderRadius: 3, backgroundColor: '#ffffff40' },
                  i === currentIndex && { backgroundColor: '#fff', width: 18 },
                ]}
                onPress={() => {
                  scrollRef.current?.scrollTo({ x: i * SCREEN_W, animated: true });
                  setCurrentIndex(i);
                }}
              />
            ))}
          </View>
        )}
      </View>
    </Modal>
  );
};
