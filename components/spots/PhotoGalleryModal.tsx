import React, { useState, useRef } from 'react';
import {
  Modal, View, Text, TouchableOpacity, StyleSheet,
  FlatList, Image, Dimensions, StatusBar,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

interface PhotoGalleryModalProps {
  visible: boolean;
  photos: string[];
  initialIndex?: number;
  spotName: string;
  onClose: () => void;
}

export const PhotoGalleryModal = ({
  visible, photos, initialIndex = 0, spotName, onClose,
}: PhotoGalleryModalProps) => {
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const flatListRef = useRef<FlatList>(null);

  const handleViewableItemsChanged = useRef(({ viewableItems }: any) => {
    if (viewableItems.length > 0) {
      setCurrentIndex(viewableItems[0].index ?? 0);
    }
  }).current;

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent={false}
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <StatusBar hidden />
      <View style={s.container}>

        {/* Header */}
        <View style={s.header}>
          <TouchableOpacity style={s.closeBtn} onPress={onClose} activeOpacity={0.8}>
            <MaterialIcons name="close" size={24} color="#fff" />
          </TouchableOpacity>
          <View style={s.headerCenter}>
            <Text style={s.spotName} numberOfLines={1}>{spotName}</Text>
            <Text style={s.counter}>{currentIndex + 1} / {photos.length}</Text>
          </View>
          <View style={{ width: 44 }} />
        </View>

        {/* Slider */}
        <FlatList
          ref={flatListRef}
          data={photos}
          keyExtractor={(item, i) => `${item}_${i}`}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          initialScrollIndex={initialIndex}
          getItemLayout={(_, index) => ({
            length: SCREEN_W, offset: SCREEN_W * index, index,
          })}
          onViewableItemsChanged={handleViewableItemsChanged}
          viewabilityConfig={{ itemVisiblePercentThreshold: 50 }}
          renderItem={({ item }) => (
            <View style={s.slide}>
              <Image
                source={{ uri: item }}
                style={s.photo}
                resizeMode="contain"
              />
            </View>
          )}
        />

        {/* Dots */}
        {photos.length > 1 && (
          <View style={s.dots}>
            {photos.map((_, i) => (
              <TouchableOpacity
                key={i}
                style={[s.dot, i === currentIndex && s.dotActive]}
                onPress={() => {
                  flatListRef.current?.scrollToIndex({ index: i, animated: true });
                }}
              />
            ))}
          </View>
        )}

        {/* Strzałki */}
        {photos.length > 1 && (
          <>
            {currentIndex > 0 && (
              <TouchableOpacity
                style={[s.arrow, s.arrowLeft]}
                onPress={() => {
                  const prev = currentIndex - 1;
                  flatListRef.current?.scrollToIndex({ index: prev, animated: true });
                }}
                activeOpacity={0.8}
              >
                <MaterialIcons name="chevron-left" size={32} color="#fff" />
              </TouchableOpacity>
            )}
            {currentIndex < photos.length - 1 && (
              <TouchableOpacity
                style={[s.arrow, s.arrowRight]}
                onPress={() => {
                  const next = currentIndex + 1;
                  flatListRef.current?.scrollToIndex({ index: next, animated: true });
                }}
                activeOpacity={0.8}
              >
                <MaterialIcons name="chevron-right" size={32} color="#fff" />
              </TouchableOpacity>
            )}
          </>
        )}
      </View>
    </Modal>
  );
};

const s = StyleSheet.create({
  container:   { flex: 1, backgroundColor: '#000' },
  header:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 50, paddingHorizontal: 16, paddingBottom: 12, backgroundColor: '#000000cc', position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10 },
  closeBtn:    { width: 44, height: 44, borderRadius: 22, backgroundColor: '#ffffff15', justifyContent: 'center', alignItems: 'center' },
  headerCenter:{ flex: 1, alignItems: 'center' },
  spotName:    { color: '#fff', fontSize: 14, fontWeight: '700' },
  counter:     { color: '#ffffff60', fontSize: 12, marginTop: 2 },
  slide:       { width: SCREEN_W, height: SCREEN_H, justifyContent: 'center', alignItems: 'center' },
  photo:       { width: SCREEN_W, height: SCREEN_H },
  dots:        { position: 'absolute', bottom: 40, left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', gap: 6 },
  dot:         { width: 6, height: 6, borderRadius: 3, backgroundColor: '#ffffff40' },
  dotActive:   { backgroundColor: '#fff', width: 18 },
  arrow:       { position: 'absolute', top: '50%', marginTop: -28, width: 52, height: 52, borderRadius: 26, backgroundColor: '#000000aa', justifyContent: 'center', alignItems: 'center' },
  arrowLeft:   { left: 12 },
  arrowRight:  { right: 12 },
});