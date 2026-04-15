import React from 'react';
import { Modal, View, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Text } from '@react-navigation/elements';
import { LinearGradient } from 'expo-linear-gradient';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useTheme } from '../../contexts/ThemeContext';

interface Props {
  visible:    boolean;
  loading:    boolean;
  onUpdate:   () => void;
  onDismiss:  () => void;
}

export function UpdateModal({ visible, loading, onUpdate, onDismiss }: Props) {
  const { theme, isDark } = useTheme();

  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent>
      <View style={{ flex: 1, backgroundColor: '#000000aa', justifyContent: 'center', alignItems: 'center', padding: 24 }}>
        <View style={{ width: '100%', borderRadius: 24, overflow: 'hidden', borderWidth: 1, borderColor: '#e3383540' }}>
          <LinearGradient
            colors={isDark ? ['#1a0808', '#100404', '#0a0a0a'] : ['#fff5f5', '#fff0f0', '#fafafa']}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
            style={{ padding: 28 }}
          >
            {/* Dekoracja */}
            <View style={{ position: 'absolute', top: -40, right: -40, width: 160, height: 160, borderRadius: 80, backgroundColor: '#e3383510' }} />
            <View style={{ position: 'absolute', top: -10, right: -10, width: 80,  height: 80,  borderRadius: 40, backgroundColor: '#e3383518' }} />

            {/* Ikona */}
            <View style={{ alignItems: 'center', marginBottom: 20 }}>
              <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: '#e3383520', borderWidth: 2, borderColor: '#e3383540', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
                <MaterialCommunityIcons name="rocket-launch" size={34} color="#e33835" />
              </View>
              <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: '#e33835', letterSpacing: 4, marginBottom: 6 }}>
                NOWA WERSJA
              </Text>
              <Text style={{ fontFamily: 'Orbitron', fontSize: 20, color: theme.text, fontWeight: '900', textAlign: 'center', letterSpacing: -0.5 }}>
                Aktualizacja{'\n'}dostępna!
              </Text>
            </View>

            <Text style={{ fontFamily: 'Orbitron', fontSize: 9, color: theme.textDim, textAlign: 'center', lineHeight: 16, marginBottom: 28, letterSpacing: 0.5 }}>
              Dostępna jest nowa wersja VROOM.{'\n'}Zaktualizuj teraz, żeby korzystać z najnowszych funkcji i poprawek.
            </Text>

            {/* Przycisk Update */}
            <TouchableOpacity onPress={onUpdate} disabled={loading} activeOpacity={0.85} style={{ marginBottom: 12 }}>
              <LinearGradient
                colors={['#e33835', '#c02020']}
                start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                style={{ borderRadius: 16, paddingVertical: 16, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 10 }}
              >
                {loading
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <>
                      <MaterialIcons name="system-update" size={18} color="#fff" />
                      <Text style={{ fontFamily: 'Orbitron', fontSize: 13, color: '#fff', fontWeight: '900', letterSpacing: 1 }}>
                        AKTUALIZUJ TERAZ
                      </Text>
                    </>
                }
              </LinearGradient>
            </TouchableOpacity>

            {/* Przycisk Później */}
            {!loading && (
              <TouchableOpacity onPress={onDismiss} activeOpacity={0.7} style={{ alignItems: 'center', paddingVertical: 12 }}>
                <Text style={{ fontFamily: 'Orbitron', fontSize: 10, color: theme.textDim, letterSpacing: 1 }}>
                  Później
                </Text>
              </TouchableOpacity>
            )}
          </LinearGradient>
        </View>
      </View>
    </Modal>
  );
}