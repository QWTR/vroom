import React, { type ReactNode } from 'react';
import { View, KeyboardAvoidingView, Platform } from 'react-native';

type Props = {
  header?: ReactNode;
  children: ReactNode;
  keyboardVerticalOffset?: number;
};

/** iOS: KAV padding. Android: zwykły View (adjustResize + useChatKeyboard w rodzicu). */
export function ChatKeyboardLayout({ header, children, keyboardVerticalOffset = 0 }: Props) {
  if (Platform.OS === 'ios') {
    return (
      <View style={{ flex: 1 }}>
        {header}
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior="padding"
          keyboardVerticalOffset={keyboardVerticalOffset}
          enabled
        >
          {children}
        </KeyboardAvoidingView>
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      {header}
      <View style={{ flex: 1 }}>{children}</View>
    </View>
  );
}
