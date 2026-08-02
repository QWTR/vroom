import { useEffect, useRef, useCallback } from 'react';
import type { FlatList } from 'react-native';
import { InteractionManager, Platform } from 'react-native';
import { useKeyboardInset } from './useKeyboardInset';

function scrollListToNewest(
  listRef: React.RefObject<FlatList | null>,
  animated: boolean,
  inverted: boolean,
) {
  if (inverted) {
    listRef.current?.scrollToOffset({ offset: 0, animated });
    return;
  }
  listRef.current?.scrollToEnd({ animated });
}

/** Wielokrotne scrollToEnd — obrazy/wideo ładują się później i zmieniają wysokość listy. */
export function pinChatToBottom(
  listRef: React.RefObject<FlatList | null>,
  animated = false,
  lastIndex = -1,
) {
  const scrollEnd = () => scrollListToNewest(listRef, animated, false);
  const scrollIndex = () => {
    if (lastIndex < 0) return;
    try {
      listRef.current?.scrollToIndex({ index: lastIndex, animated, viewPosition: 1 });
    } catch {
      scrollEnd();
    }
  };
  scrollEnd();
  scrollIndex();
  requestAnimationFrame(() => {
    scrollEnd();
    scrollIndex();
  });
  for (const delay of [50, 150, 350, 700, 1200]) {
    setTimeout(() => {
      scrollEnd();
      scrollIndex();
    }, delay);
  }
}

/** Keyboard inset + auto scroll-to-end for bottom-anchored chat lists. */
export function useChatKeyboard(
  listRef: React.RefObject<FlatList | null>,
  opts?: {
    composerHeight?: number;
    scrollOnShow?: boolean;
    /**
     * true = rodzic już unika klawiatury (iOS KAV).
     * false = composer dostaje marginBottom = wysokość klawiatury (wzorzec z dyskusji).
     * Android: zawsze ręczny lift — adjustResize tu nie podnosi composera.
     */
    parentUsesKeyboardAvoiding?: boolean;
    inverted?: boolean;
  },
) {
  const keyboardHeight = useKeyboardInset(true);
  const prevHeightRef = useRef(0);
  // iOS: KAV w ChatKeyboardLayout. Android: ręczny marginBottom jak w dyskusjach.
  const parentAvoidsKeyboard = opts?.parentUsesKeyboardAvoiding ?? (Platform.OS === 'ios');
  const inverted = opts?.inverted ?? false;

  const scrollToEnd = useCallback((animated = true) => {
    scrollListToNewest(listRef, animated, inverted);
  }, [listRef, inverted]);

  useEffect(() => {
    if (opts?.scrollOnShow === false) return;
    if (keyboardHeight > 0 && keyboardHeight !== prevHeightRef.current) {
      requestAnimationFrame(() => {
        setTimeout(() => scrollToEnd(true), 48);
      });
    }
    prevHeightRef.current = keyboardHeight;
  }, [keyboardHeight, scrollToEnd, opts?.scrollOnShow]);

  const lift = parentAvoidsKeyboard ? 0 : keyboardHeight;

  return {
    keyboardHeight,
    listPaddingBottom: keyboardHeight > 0 ? 18 : 10,
    /** Wartość pod ChatComposer marginBottom (nie paddingBottom). */
    inputPaddingBottom: lift,
    scrollToEnd,
  };
}

/** Reliable scroll after messages load (first open / channel switch). */
export function scrollChatToEndAfterLayout(
  listRef: React.RefObject<FlatList | null>,
  animated = false,
  inverted = false,
) {
  InteractionManager.runAfterInteractions(() => {
    requestAnimationFrame(() => {
      setTimeout(() => scrollListToNewest(listRef, animated, inverted), 80);
    });
  });
}
