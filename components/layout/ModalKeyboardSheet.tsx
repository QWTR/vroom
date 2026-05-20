import React, { type ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../contexts/ThemeContext';
import { useKeyboardInset } from '../../hooks/useKeyboardInset';

type Props = {
  visible: boolean;
  onClose: () => void;
  children: ReactNode;
  /** Sheet content — receives computed paddingBottom for keyboard/safe area */
  sheetStyle?: StyleProp<ViewStyle>;
  maxHeight?: `${number}%` | number;
  dismissOnBackdrop?: boolean;
  useKeyboardAvoiding?: boolean;
  animationType?: 'none' | 'slide' | 'fade';
  presentationStyle?: 'fullScreen' | 'pageSheet' | 'formSheet' | 'overFullScreen';
  statusBarTranslucent?: boolean;
};

export function useModalSheetPadding(visible: boolean, parentHasKeyboardAvoiding = false): number {
  const insets = useSafeAreaInsets();
  const keyboardInset = useKeyboardInset(visible);
  const resting = Math.max(insets.bottom, Platform.OS === 'ios' ? 20 : 12);

  if (keyboardInset <= 0) return resting;
  if (Platform.OS === 'ios' && parentHasKeyboardAvoiding) {
    return resting;
  }
  return keyboardInset + 12;
}

export function ModalKeyboardSheet({
  visible,
  onClose,
  children,
  sheetStyle,
  maxHeight = '85%',
  dismissOnBackdrop = false,
  useKeyboardAvoiding = true,
  animationType = 'slide',
  presentationStyle,
  statusBarTranslucent,
}: Props) {
  const { theme } = useTheme();
  const paddingBottom = useModalSheetPadding(visible, useKeyboardAvoiding && Platform.OS === 'ios');

  const overlay = (
    <View style={[styles.overlay, { backgroundColor: theme.overlay }]}>
      {dismissOnBackdrop && (
        <Pressable style={StyleSheet.absoluteFillObject} onPress={onClose} />
      )}
      <View
        style={[
          styles.sheet,
          {
            backgroundColor: theme.surface,
            borderTopColor: theme.border2,
            paddingBottom,
            maxHeight,
          },
          sheetStyle,
        ]}
      >
        {children}
      </View>
    </View>
  );

  return (
    <Modal
      visible={visible}
      transparent
      animationType={animationType}
      onRequestClose={onClose}
      presentationStyle={presentationStyle}
      statusBarTranslucent={statusBarTranslucent}
    >
      {useKeyboardAvoiding && Platform.OS === 'ios' ? (
        <KeyboardAvoidingView
          style={styles.flex}
          behavior="padding"
          enabled
        >
          {overlay}
        </KeyboardAvoidingView>
      ) : (
        overlay
      )}
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: 1,
    paddingHorizontal: 16,
  },
});
