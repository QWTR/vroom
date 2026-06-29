import React, { useEffect, useMemo, useState } from 'react';
import { View, Image, TouchableOpacity, StyleSheet, Dimensions } from 'react-native';
import { Video, ResizeMode } from 'expo-av';
import { CHAT_MEDIA_MAX_WIDTH_RATIO } from './constants';

const SCREEN_W = Dimensions.get('window').width;
const MAX_W = SCREEN_W * CHAT_MEDIA_MAX_WIDTH_RATIO;
const SINGLE_MAX_W = Math.min(220, SCREEN_W * 0.58);
const PHONE_W = Math.min(178, SCREEN_W * 0.46);
const PHONE_H = Math.min(308, SCREEN_W * 0.78);
const GRID_TILE = Math.min(108, (MAX_W - 8) / 2);

type Props = {
  photos: string[];
  videos?: string[];
  onPressPhoto?: (uri: string) => void;
};

export function ChatMediaGrid({ photos, videos = [], onPressPhoto }: Props) {
  const allItems = [
    ...photos.map(uri => ({ type: 'photo' as const, uri })),
    ...videos.map(uri => ({ type: 'video' as const, uri })),
  ];
  if (allItems.length === 0) return null;

  const single = allItems.length === 1;

  return (
    <View style={[styles.grid, single && styles.singleGrid]}>
      {allItems.map((item, i) => (
        <MediaTile
          key={`${item.type}-${item.uri}-${i}`}
          uri={item.uri}
          type={item.type}
          single={single}
          onPressPhoto={onPressPhoto}
        />
      ))}
    </View>
  );
}

function MediaTile({
  uri,
  type,
  single,
  onPressPhoto,
}: {
  uri: string;
  type: 'photo' | 'video';
  single: boolean;
  onPressPhoto?: (uri: string) => void;
}) {
  const [ratio, setRatio] = useState<number | null>(null);

  useEffect(() => {
    if (type !== 'photo') {
      setRatio(9 / 16);
      return;
    }
    let mounted = true;
    Image.getSize(
      uri,
      (w, h) => {
        if (!mounted || !w || !h) return;
        setRatio(w / h);
      },
      () => {
        if (mounted) setRatio(null);
      },
    );
    return () => { mounted = false; };
  }, [type, uri]);

  const tileStyle = useMemo(() => {
    if (!single) return styles.multiPhoto;
    const r = ratio ?? 0.72;
    if (r < 0.82) {
      const height = PHONE_H;
      const width = Math.max(142, Math.min(PHONE_W, height * r));
      return [styles.singlePhoto, { width, height }];
    }
    if (r > 1.2) {
      const width = SINGLE_MAX_W;
      const height = Math.max(132, Math.min(168, width / r));
      return [styles.singlePhoto, { width, height }];
    }
    const side = Math.min(208, SINGLE_MAX_W);
    return [styles.singlePhoto, { width: side, height: side }];
  }, [ratio, single]);

  return (
    <TouchableOpacity
      activeOpacity={0.9}
      onPress={() => type === 'photo' && onPressPhoto?.(uri)}
      disabled={type === 'video'}
      style={styles.tileShadow}
    >
      {type === 'photo' ? (
        <Image source={{ uri }} style={tileStyle} resizeMode="cover" />
      ) : (
        <Video
          source={{ uri }}
          style={tileStyle}
          useNativeControls
          resizeMode={ResizeMode.COVER}
        />
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 5, maxWidth: MAX_W },
  singleGrid: { alignSelf: 'center' },
  tileShadow: {
    borderRadius: 18,
    backgroundColor: '#050505',
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 5 },
    elevation: 4,
  },
  singlePhoto: {
    width: PHONE_W,
    height: PHONE_H,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#ffffff18',
    backgroundColor: '#050505',
  },
  multiPhoto: {
    width: GRID_TILE,
    height: GRID_TILE,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#ffffff16',
    backgroundColor: '#050505',
  },
});
