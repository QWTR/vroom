import React from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { AppText as Text } from './ui/AppText';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useTheme } from '../contexts/ThemeContext';

export function ScreenCrashFallback({ title, retry }: { title: string; retry: () => void }) {
  const { theme } = useTheme();
  const router = useRouter();
  return <SafeAreaView style={[styles.safe, { backgroundColor: theme.bg }]}><View style={styles.content}><MaterialIcons name="error-outline" size={42} color="#ef4444" /><Text style={[styles.title, { color: theme.text }]}>{title}</Text><Text style={[styles.message, { color: theme.textDim }]}>Ekran zatrzymał błąd i aplikacja może działać dalej. Spróbuj ponownie albo wróć.</Text><TouchableOpacity onPress={retry} style={styles.primary}><Text style={styles.primaryText}>SPRÓBUJ PONOWNIE</Text></TouchableOpacity><TouchableOpacity onPress={() => router.back()} style={[styles.secondary, { borderColor: theme.border }]}><Text style={{ color: theme.text, fontWeight: '800' }}>WRÓĆ</Text></TouchableOpacity></View></SafeAreaView>;
}

const styles = StyleSheet.create({ safe: { flex: 1 }, content: { flex: 1, padding: 28, alignItems: 'center', justifyContent: 'center', gap: 16 }, title: { fontFamily: 'Manrope_700Bold', textAlign: 'center', fontSize: 16, letterSpacing: 1 }, message: { textAlign: 'center', fontSize: 12, lineHeight: 19 }, primary: { minWidth: 210, minHeight: 48, borderRadius: 12, backgroundColor: '#FFD447', alignItems: 'center', justifyContent: 'center' }, primaryText: { color: '#111', fontWeight: '900' }, secondary: { minWidth: 210, minHeight: 48, borderWidth: 1, borderRadius: 12, alignItems: 'center', justifyContent: 'center' } });
