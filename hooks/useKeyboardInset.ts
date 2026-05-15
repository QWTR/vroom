import { useEffect, useState } from 'react';
import { Keyboard, Platform, type KeyboardEvent } from 'react-native';

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
