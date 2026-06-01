import React, { useRef, useState } from 'react';
import {
  View, Text, FlatList, Dimensions, NativeSyntheticEvent, NativeScrollEvent, TouchableOpacity,
} from 'react-native';
import { Image } from 'expo-image';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useTheme } from '../../contexts/ThemeContext';

const { width: SCREEN_W } = Dimensions.get('window');

interface Props {
  photos: string[];
  height?: number;
  width?: number;
  accentColor?: string;
  borderColor?: string;
}

function photosEqual(a: string[], b: string[]) {
  if (a.length !== b.length) return false;
  return a.every((uri, i) => uri === b[i]);
}

export const DailyDuelCarCarousel = React.memo(function DailyDuelCarCarousel({
  photos,
  height = 240,
  width,
  accentColor,
  borderColor,
}: Props) {
  const { theme } = useTheme();
  const listRef = useRef<FlatList<string>>(null);
  const [index, setIndex] = useState(0);
  const accent = accentColor ?? theme.primary;
  const border = borderColor ?? theme.border2;
  const uris = photos.filter(Boolean);
  const slideW = width ?? SCREEN_W - 32;

  if (!uris.length) {
    return (
      <View style={{
        width: '100%',
        height,
        backgroundColor: theme.surface2,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1,
        borderColor: border,
        borderRadius: 16,
      }}>
        <MaterialCommunityIcons name="car-sports" size={48} color={theme.border3} />
      </View>
    );
  }

  const onScrollEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const w = e.nativeEvent.layoutMeasurement.width || slideW;
    const idx = Math.round(e.nativeEvent.contentOffset.x / w);
    setIndex(Math.max(0, Math.min(idx, uris.length - 1)));
  };

  return (
    <View style={{
      borderRadius: 16,
      overflow: 'hidden',
      borderWidth: 1,
      borderColor: border,
      backgroundColor: theme.surface2,
    }}>
      <FlatList
        ref={listRef}
        data={uris}
        horizontal
        pagingEnabled
        nestedScrollEnabled
        showsHorizontalScrollIndicator={false}
        keyExtractor={(item, i) => `${item}-${i}`}
        getItemLayout={(_, i) => ({ length: slideW, offset: slideW * i, index: i })}
        onMomentumScrollEnd={onScrollEnd}
        onScrollEndDrag={onScrollEnd}
        renderItem={({ item }) => (
          <View style={{ width: slideW, height, backgroundColor: '#000' }}>
            <Image
              source={{ uri: item }}
              style={{ width: slideW, height }}
              contentFit="cover"
              cachePolicy="memory-disk"
              transition={120}
            />
          </View>
        )}
      />

      {uris.length > 1 && (
        <>
          <View style={{
            position: 'absolute',
            top: 10,
            right: 10,
            backgroundColor: '#000000aa',
            borderRadius: 10,
            paddingHorizontal: 10,
            paddingVertical: 4,
          }}>
            <Text style={{ fontFamily: 'Orbitron', fontSize: 9, color: '#fff', fontWeight: '700' }}>
              {index + 1} / {uris.length}
            </Text>
          </View>

          <View style={{
            position: 'absolute',
            bottom: 10,
            left: 0,
            right: 0,
            flexDirection: 'row',
            justifyContent: 'center',
            gap: 6,
          }}>
            {uris.map((_, i) => (
              <View
                key={i}
                style={{
                  width: i === index ? 18 : 6,
                  height: 6,
                  borderRadius: 3,
                  backgroundColor: i === index ? accent : '#ffffff50',
                }}
              />
            ))}
          </View>

          {index > 0 && (
            <TouchableOpacity
              style={{
                position: 'absolute',
                left: 8,
                top: height / 2 - 18,
                backgroundColor: '#00000088',
                borderRadius: 18,
                padding: 6,
              }}
              onPress={() => {
                const next = index - 1;
                listRef.current?.scrollToIndex({ index: next, animated: true });
                setIndex(next);
              }}
            >
              <MaterialIcons name="chevron-left" size={22} color="#fff" />
            </TouchableOpacity>
          )}
          {index < uris.length - 1 && (
            <TouchableOpacity
              style={{
                position: 'absolute',
                right: 8,
                top: height / 2 - 18,
                backgroundColor: '#00000088',
                borderRadius: 18,
                padding: 6,
              }}
              onPress={() => {
                const next = index + 1;
                listRef.current?.scrollToIndex({ index: next, animated: true });
                setIndex(next);
              }}
            >
              <MaterialIcons name="chevron-right" size={22} color="#fff" />
            </TouchableOpacity>
          )}
        </>
      )}
    </View>
  );
}, (prev, next) => (
  prev.height === next.height
  && prev.width === next.width
  && prev.accentColor === next.accentColor
  && prev.borderColor === next.borderColor
  && photosEqual(prev.photos, next.photos)
));
