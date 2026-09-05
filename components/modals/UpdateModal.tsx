import React from 'react';
import { Modal, View, TouchableOpacity, ActivityIndicator } from 'react-native';
import { AppText as Text } from '../ui/AppText';
import { LinearGradient } from 'expo-linear-gradient';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useTheme } from '../../contexts/ThemeContext';

interface Props {
  visible:    boolean;
  loading:    boolean;
  restarting: boolean;
  progress:   number | null;
  error:      string | null;
  onUpdate:   () => void;
  onDismiss:  () => void;
}

export function UpdateModal({ visible, loading, restarting, progress, error, onUpdate, onDismiss }: Props) {
  const { theme, isDark } = useTheme();

  if (!visible) return null;

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onDismiss}
    >
      <View style={{ flex: 1, backgroundColor: theme.overlay, justifyContent: 'center', alignItems: 'center', padding: 24 }}>
        <View style={{ width: '100%', borderRadius: 24, overflow: 'hidden', borderWidth: 1, borderColor: theme.primaryBorder }}>
          <LinearGradient
            colors={isDark ? ['#1a0808', '#100404', theme.bg] : [theme.surface2, theme.surface, theme.bgAlt]}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
            style={{ padding: 28 }}
          >
            <View style={{ position: 'absolute', top: -40, right: -40, width: 160, height: 160, borderRadius: 80, backgroundColor: '#e3383510' }} />
            <View style={{ position: 'absolute', top: -10, right: -10, width: 80,  height: 80,  borderRadius: 40, backgroundColor: '#e3383518' }} />

            <View style={{ alignItems: 'center', marginBottom: 20 }}>
              <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: '#e3383520', borderWidth: 2, borderColor: '#e3383540', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
                <MaterialCommunityIcons name="rocket-launch" size={34} color="#e33835" />
              </View>
              <Text style={{ fontFamily: 'Manrope_600SemiBold', fontSize: 12, color: '#e33835', letterSpacing: 1, marginBottom: 6 }}>
                NOWA WERSJA
              </Text>
              <Text style={{ fontFamily: 'Manrope_600SemiBold', fontSize: 20, color: theme.text, fontWeight: '900', textAlign: 'center', letterSpacing: -0.2 }}>
                Aktualizacja{'\n'}dostępna!
              </Text>
            </View>

            <Text style={{ fontFamily: 'Manrope_600SemiBold', fontSize: 12, color: theme.textDim, textAlign: 'center', lineHeight: 16, marginBottom: error ? 12 : 28, letterSpacing: 0.5 }}>
              {loading
                ? restarting
                  ? 'Uruchamianie nowej wersji…'
                  : progress === null
                    ? 'Pobieranie aktualizacji…'
                    : `Pobieranie aktualizacji… ${progress}%`
                : 'Dostępna jest nowa wersja VROOM.\nZaktualizuj teraz, żeby korzystać z najnowszych funkcji i poprawek.'}
            </Text>

            {loading && progress !== null && (
              <View style={{ marginBottom: 20 }}>
                <View style={{ height: 8, borderRadius: 999, backgroundColor: theme.border2, overflow: 'hidden' }}>
                  <View
                    style={{
                      height: '100%',
                      width: `${progress}%`,
                      backgroundColor: '#e33835',
                    }}
                  />
                </View>
              </View>
            )}

            {!!error && (
              <Text style={{ fontFamily: 'Manrope_600SemiBold', fontSize: 12, color: '#e33835', textAlign: 'center', lineHeight: 16, marginBottom: 20, letterSpacing: 0.3 }}>
                {error}
              </Text>
            )}

            <TouchableOpacity onPress={onUpdate} disabled={loading} activeOpacity={0.85} style={{ marginBottom: 12 }}>
              <LinearGradient
                colors={['#e33835', '#c02020']}
                start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                style={{ borderRadius: 16, paddingVertical: 16, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 10 }}
              >
                {loading
                  ? <ActivityIndicator color={theme.onPrimary} size="small" />
                  : <>
                      <MaterialIcons name="system-update" size={18} color={theme.onPrimary} />
                      <Text style={{ fontFamily: 'Manrope_600SemiBold', fontSize: 13, color: theme.onPrimary, fontWeight: '900', letterSpacing: 1 }}>
                        {error ? 'SPRÓBUJ PONOWNIE' : 'AKTUALIZUJ TERAZ'}
                      </Text>
                    </>
                }
              </LinearGradient>
            </TouchableOpacity>

            <TouchableOpacity onPress={onDismiss} activeOpacity={0.7} style={{ alignItems: 'center', paddingVertical: 12 }}>
              <Text style={{ fontFamily: 'Manrope_600SemiBold', fontSize: 12, color: theme.textDim, letterSpacing: 1 }}>
                {loading ? 'UKRYJ — POBIERANIE TRWA W TLE' : 'Później'}
              </Text>
            </TouchableOpacity>
          </LinearGradient>
        </View>
      </View>
    </Modal>
  );
}
