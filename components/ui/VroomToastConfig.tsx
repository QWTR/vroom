import React from 'react';
import { View, type TextStyle, type ViewStyle } from 'react-native';
import { BaseToast, ErrorToast, type ToastConfig } from 'react-native-toast-message';
import { MaterialIcons } from '@expo/vector-icons';

const R = '#e33835';

const toastShellStyle = (accent: string, bg: string): ViewStyle => ({
  width: '92%',
  alignSelf: 'center',
  minHeight: 56,
  paddingVertical: 12,
  borderBottomColor: accent,
  borderBottomWidth: 5,
  borderLeftWidth: 0,
  backgroundColor: bg,
  zIndex: 999990,
  borderRadius: 12,
});

const contentStyle: ViewStyle = {
  paddingHorizontal: 12,
  flexShrink: 1,
};

function makeTextStyles(textMain: string, textSecondary: string) {
  const text1Style: TextStyle = {
    color: textMain,
    fontSize: 13,
    fontFamily: 'Manrope_700Bold',
    flexShrink: 1,
  };
  const text2Style: TextStyle = {
    color: textSecondary,
    fontSize: 12,
    fontFamily: 'Manrope_600SemiBold',
    flexShrink: 1,
    marginTop: 2,
  };
  return { text1Style, text2Style };
}

export function createVroomToastConfig(isDark: boolean): ToastConfig {
  const bg = isDark ? '#141414' : '#ffffff';
  const textMain = isDark ? '#ffffff' : '#151515';
  const textSecondary = isDark ? '#ffffff70' : '#4a4a4a';
  const { text1Style, text2Style } = makeTextStyles(textMain, textSecondary);

  const commonProps = {
    text1NumberOfLines: 2 as const,
    text2NumberOfLines: 3 as const,
    contentContainerStyle: contentStyle,
    text1Style,
    text2Style,
  };

  return {
    success: (props) => (
      <BaseToast
        {...props}
        {...commonProps}
        style={toastShellStyle(R, bg)}
        renderLeadingIcon={() => (
          <View style={{ justifyContent: 'center', paddingLeft: 14 }}>
            <MaterialIcons name="check-circle" size={26} color={R} />
          </View>
        )}
      />
    ),
    info: (props) => (
      <BaseToast
        {...props}
        {...commonProps}
        style={toastShellStyle('#268bff', bg)}
        renderLeadingIcon={() => (
          <View style={{ justifyContent: 'center', paddingLeft: 14 }}>
            <MaterialIcons name="info-outline" size={26} color="#268bff" />
          </View>
        )}
      />
    ),
    error: (props) => (
      <ErrorToast
        {...props}
        {...commonProps}
        style={toastShellStyle('#fa0400', bg)}
        renderLeadingIcon={() => (
          <View style={{ justifyContent: 'center', paddingLeft: 14 }}>
            <MaterialIcons name="error-outline" size={28} color="#fa0400" />
          </View>
        )}
      />
    ),
  };
}
