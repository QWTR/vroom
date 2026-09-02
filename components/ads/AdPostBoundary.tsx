import React, { Component, type ReactNode } from 'react';
import { View } from 'react-native';
import { AppText as Text } from '../ui/AppText';
import { useTheme } from '../../contexts/ThemeContext';

function AdFallback() {
  const { theme } = useTheme();
  return (
    <View style={{
      marginHorizontal: 12,
      marginBottom: 10,
      backgroundColor: theme.surface,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: theme.border,
      borderStyle: 'dashed',
      paddingVertical: 10,
      paddingHorizontal: 12,
      alignItems: 'center',
      minHeight: 40,
    }}>
      <Text style={{ fontFamily: 'Manrope_600SemiBold', color: theme.textDim, fontSize: 12, letterSpacing: 1 }}>
        REKLAMA NIEDOSTĘPNA
      </Text>
    </View>
  );
}

type Props = { children: ReactNode };

type State = { hasError: boolean };

/** Chroni feed dyskusji przed crashami NativeAdView (czarny ekran). */
export class AdPostBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error) {
    if (__DEV__) console.warn('[AdPostBoundary]', error.message);
  }

  render() {
    if (this.state.hasError) return <AdFallback />;
    return this.props.children;
  }
}
