import React, { useEffect, useRef } from 'react';
import { View, PixelRatio } from 'react-native';
import { captureRef } from 'react-native-view-shot';
import { MaterialIcons } from '@expo/vector-icons';
import {
  CATEGORIES,
  CATEGORY_COLORS,
  CATEGORY_ICONS,
  CATEGORY_IMAGE_KEYS,
  type SpotCategory,
} from '../../constants/spotTypes';

/** Rozmiar pinu na mapie w punktach logicznych (~36px na ekranie). */
export const SPOT_PIN_DISPLAY_PT = 36;
const PIN_W = 34;
const PIN_H = 42;
const BOX = 28;
const ICON_SZ = 16;

function CategoryPinVisual({ category }: { category: SpotCategory }) {
  const color = CATEGORY_COLORS[category];
  return (
    <View style={{ width: PIN_W, height: PIN_H, alignItems: 'center' }}>
      <View
        style={{
          width: BOX,
          height: BOX,
          borderRadius: 8,
          backgroundColor: '#141414',
          borderWidth: 2,
          borderColor: color,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <MaterialIcons name={CATEGORY_ICONS[category] as any} size={ICON_SZ} color={color} />
      </View>
      <View
        style={{
          width: 0,
          height: 0,
          borderLeftWidth: 5,
          borderRightWidth: 5,
          borderTopWidth: 6,
          borderLeftColor: 'transparent',
          borderRightColor: 'transparent',
          borderTopColor: color,
          marginTop: -1,
        }}
      />
    </View>
  );
}

/** Skala Mapbox iconSize: PNG z captureRef jest w px urządzenia, nie w pt. */
export function spotPinIconSize(): number {
  const pr = PixelRatio.get();
  return SPOT_PIN_DISPLAY_PT / (PIN_W * pr);
}

type Props = {
  onReady: (sprites: Record<string, string>) => void;
};

/** Jednorazowo generuje PNG pinów per kategoria (11 szt.) — do Mapbox.Images. */
export function SpotCategorySpriteGenerator({ onReady }: Props) {
  const refs = useRef<Partial<Record<SpotCategory, View>>>({});
  const doneRef = useRef(false);

  useEffect(() => {
    const timer = setTimeout(async () => {
      if (doneRef.current) return;

      const sprites: Record<string, string> = {};
      await Promise.all(
        CATEGORIES.map(async cat => {
          const node = refs.current[cat];
          if (!node) return;
          try {
            const uri = await captureRef(node, {
              format: 'png',
              quality: 1,
              result: 'tmpfile',
            });
            sprites[CATEGORY_IMAGE_KEYS[cat]] = uri;
          } catch {
            /* ignore single capture failure */
          }
        }),
      );

      if (Object.keys(sprites).length >= CATEGORIES.length - 1) {
        doneRef.current = true;
        onReady(sprites);
      }
    }, 100);

    return () => clearTimeout(timer);
  }, [onReady]);

  return (
    <View
      style={{ position: 'absolute', left: -9999, top: 0, opacity: 0 }}
      pointerEvents="none"
      collapsable={false}
    >
      {CATEGORIES.map(cat => (
        <View
          key={cat}
          collapsable={false}
          ref={node => {
            if (node) refs.current[cat] = node;
          }}
        >
          <CategoryPinVisual category={cat} />
        </View>
      ))}
    </View>
  );
}
