import React, { type ReactNode } from 'react';
import { View, KeyboardAvoidingView, Platform } from 'react-native';

type Props = {
  header?: ReactNode;
  children: ReactNode;
  keyboardVerticalOffset?: number;
};

/** iOS: KAV padding. Android: zwykły View (adjustResize + useChatKeyboard w rodzicu). */
export function ChatKeyboardLayout({ header, children, keyboardVerticalOffset = 0 }: Props) {
  return (
    <View style={{ flex: 1 }}>
      {header}
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={keyboardVerticalOffset}
        enabled
      >
        {children}
      </KeyboardAvoidingView>
    </View>
  );
}
