import { useEffect, useState } from 'react';
import { Keyboard, Platform, type KeyboardEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/** Wysokość klawiatury (px) — do paddingBottom / marginBottom nad klawiaturą. */
export function useKeyboardInset(enabled = true): number {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    if (!enabled) {
      setInset(0);
      return;
    }

    const apply = (height: number) => setInset(Math.max(0, height));

    const onShow = (e: KeyboardEvent) => apply(e.endCoordinates?.height ?? 0);
    const onHide = () => apply(0);

    const subs =
      Platform.OS === 'ios'
        ? [
            Keyboard.addListener('keyboardWillShow', onShow),
            Keyboard.addListener('keyboardWillHide', onHide),
          ]
        : [
            Keyboard.addListener('keyboardDidShow', onShow),
            Keyboard.addListener('keyboardDidHide', onHide),
          ];

    return () => subs.forEach(s => s.remove());
  }, [enabled]);

  return inset;
}

/** Padding dla ScrollView / footera formularzy — Android: inset; iOS: safe area + opcjonalny KAV. */
export function useFormKeyboardPadding(extra = 24): {
  keyboardHeight: number;
  scrollPaddingBottom: number;
  footerPaddingBottom: number;
} {
  const insets = useSafeAreaInsets();
  const keyboardHeight = useKeyboardInset(true);
  const base = Math.max(insets.bottom, 12);
  if (keyboardHeight > 0) {
    return {
      keyboardHeight,
      scrollPaddingBottom: keyboardHeight + extra,
      footerPaddingBottom: keyboardHeight + 12,
    };
  }
  return {
    keyboardHeight: 0,
    scrollPaddingBottom: base + extra,
    footerPaddingBottom: base,
  };
}
