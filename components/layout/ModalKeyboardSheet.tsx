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

/** Safe-area padding wewnątrz sheetu (bez wysokości klawiatury — ta idzie w marginBottom). */
export function useModalSheetPadding(visible: boolean, parentHasKeyboardAvoiding = false): number {
  const insets = useSafeAreaInsets();
  const keyboardInset = useKeyboardInset(visible);
  const resting = Math.max(insets.bottom, Platform.OS === 'ios' ? 20 : 12);

  // Klawiatura: iOS KAV / Android marginBottom na sheet — nie paddingBottom (zgniata content).
  if (keyboardInset <= 0) return resting;
  if (parentHasKeyboardAvoiding || Platform.OS === 'android') {
    return resting;
  }
  return keyboardInset + 12;
}

/** O ile podnieść sheet nad klawiaturę (Android Modal nie ma KAV). */
export function useModalSheetKeyboardLift(visible: boolean): number {
  const keyboardInset = useKeyboardInset(visible);
  if (Platform.OS !== 'android' || keyboardInset <= 0) return 0;
  return keyboardInset;
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
  const keyboardLift = useModalSheetKeyboardLift(visible);

  const overlay = (
    <View style={[styles.overlay, { paddingBottom: keyboardLift }]}>
      <Pressable
        style={[StyleSheet.absoluteFillObject, { backgroundColor: theme.overlay }]}
        onPress={dismissOnBackdrop ? onClose : undefined}
      />
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
      presentationStyle={presentationStyle ?? 'overFullScreen'}
      statusBarTranslucent={statusBarTranslucent ?? true}
      navigationBarTranslucent
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
