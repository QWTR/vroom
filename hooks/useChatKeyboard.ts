import { useEffect, useRef, useCallback } from 'react';
import type { FlatList } from 'react-native';
import { InteractionManager } from 'react-native';
import { useKeyboardInset } from './useKeyboardInset';

const DEFAULT_COMPOSER = 72;

/** Keyboard inset + auto scroll-to-end for bottom-anchored chat lists. */
export function useChatKeyboard(
  listRef: React.RefObject<FlatList | null>,
  opts?: { composerHeight?: number; scrollOnShow?: boolean; parentUsesKeyboardAvoiding?: boolean },
) {
  const composerHeight = opts?.composerHeight ?? DEFAULT_COMPOSER;
  const keyboardHeight = useKeyboardInset(true);
  const prevHeightRef = useRef(0);
  const iosKav = opts?.parentUsesKeyboardAvoiding ?? false;

  const scrollToEnd = useCallback((animated = true) => {
    listRef.current?.scrollToEnd({ animated });
  }, [listRef]);

  useEffect(() => {
    if (opts?.scrollOnShow === false) return;
    if (keyboardHeight > 0 && keyboardHeight !== prevHeightRef.current) {
      requestAnimationFrame(() => {
        setTimeout(() => scrollToEnd(true), 48);
      });
    }
    prevHeightRef.current = keyboardHeight;
  }, [keyboardHeight, scrollToEnd, opts?.scrollOnShow]);

  return {
    keyboardHeight,
    listPaddingBottom: keyboardHeight > 0 ? (iosKav ? 12 : keyboardHeight + 12) : 8,
    inputPaddingBottom: iosKav ? 0 : keyboardHeight,
    scrollToEnd,
  };
}

/** Reliable scroll after messages load (first open / channel switch). */
export function scrollChatToEndAfterLayout(
  listRef: React.RefObject<FlatList | null>,
  animated = false,
) {
  InteractionManager.runAfterInteractions(() => {
    requestAnimationFrame(() => {
      setTimeout(() => listRef.current?.scrollToEnd({ animated }), 80);
    });
  });
}
