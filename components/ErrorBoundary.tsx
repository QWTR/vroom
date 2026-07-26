import React, { Component, type ErrorInfo, type ReactNode } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { resetCriticalAppCache, resetVroomkiVideoCache } from '../lib/criticalStorageReset';

type Props = {
  children: ReactNode;
  /** Gdy true — czyści tylko cache Vroomki (lokalny boundary Rolek). */
  vroomkiOnly?: boolean;
  fallbackTitle?: string;
  onRecovered?: () => void;
};

type State = {
  hasError: boolean;
  message: string;
  resetting: boolean;
};

export class ErrorBoundary extends Component<Props, State> {
  state: State = {
    hasError: false,
    message: '',
    resetting: false,
  };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return {
      hasError: true,
      message: error?.message ? String(error.message).slice(0, 180) : 'Nieoczekiwany błąd',
    };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    if (__DEV__) {
      console.warn('[ErrorBoundary]', error, info?.componentStack);
    }
  }

  private handleReset = async () => {
    if (this.state.resetting) return;
    this.setState({ resetting: true });
    try {
      if (this.props.vroomkiOnly) {
        await resetVroomkiVideoCache();
      } else {
        await resetCriticalAppCache();
      }
      this.props.onRecovered?.();
      this.setState({ hasError: false, message: '', resetting: false });
    } catch {
      this.setState({ resetting: false });
    }
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    const title = this.props.fallbackTitle ?? 'Coś poszło nie tak';

    return (
      <View style={styles.wrap}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.body}>
          Aplikacja napotkała błąd. Możesz wyczyścić lokalny cache i spróbować ponownie — bez wylogowania.
        </Text>
        {!!this.state.message && (
          <Text style={styles.detail} numberOfLines={3}>{this.state.message}</Text>
        )}
        <TouchableOpacity
          style={styles.btn}
          onPress={() => { void this.handleReset(); }}
          disabled={this.state.resetting}
          activeOpacity={0.85}
        >
          <Text style={styles.btnText}>
            {this.state.resetting ? 'Czyszczenie…' : 'Wyczyść cache i kontynuuj'}
          </Text>
        </TouchableOpacity>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    backgroundColor: '#0a0c10',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  title: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 10,
    textAlign: 'center',
  },
  body: {
    color: '#9ca3af',
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
    marginBottom: 12,
  },
  detail: {
    color: '#6b7280',
    fontSize: 11,
    textAlign: 'center',
    marginBottom: 20,
  },
  btn: {
    backgroundColor: '#e33835',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderRadius: 12,
    minWidth: 220,
    alignItems: 'center',
  },
  btnText: {
    color: '#fff',
    fontWeight: '800',
    fontSize: 13,
  },
});
