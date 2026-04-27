import React, { memo } from 'react';
import { Modal, View, Text, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialIcons, MaterialCommunityIcons } from '@expo/vector-icons';
import { makeMapStyles } from '../../styles/mapstyle';
import { useTheme } from '../../contexts/ThemeContext';
import { useModalBackHandler } from '../../hooks/useModalBackHandler';

interface MapActionsModalProps {
  visible: boolean;
  isSpeechEnabled: boolean;
  isBuilding: boolean;
  pinsCount: number;
  onToggleVoice: () => void;
  onOpenMapType: () => void;
  onStartBuilding: () => void;
  onFinishBuilding: () => void;
  onCancelBuilding: () => void;
  onClose: () => void;
}

export const MapActionsModal = memo(
  ({
    visible,
    isSpeechEnabled,
    isBuilding,
    pinsCount,
    onToggleVoice,
    onOpenMapType,
    onStartBuilding,
    onFinishBuilding,
    onCancelBuilding,
    onClose,
  }: MapActionsModalProps) => {
    const { theme, isDark } = useTheme();
    const styles = makeMapStyles(theme, isDark);
    useModalBackHandler(visible, onClose);

    return (
      <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
        <SafeAreaView style={styles.drawerModalContainer}>
          <View style={styles.drawerModal}>

            {/* Handle */}
            <View style={styles.drawerHandle} />

            {/* Header */}
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
              <View style={{
                backgroundColor: theme.primaryBg, padding: 8, borderRadius: 10,
                borderWidth: 1, borderColor: theme.primaryBorder, marginRight: 12,
              }}>
                <MaterialIcons name="tune" size={18} color={theme.primary} />
              </View>
              <Text style={styles.drawerTitle}>AKCJE MAPY</Text>
            </View>

            <View style={styles.drawerDivider} />
            <Text style={styles.drawerSectionLabel}>OPCJE</Text>

            {/* Voice toggle */}
            <TouchableOpacity
              style={[
                styles.drawerBtn,
                !isSpeechEnabled && styles.drawerBtnActive,
              ]}
              activeOpacity={0.72}
              onPress={() => {
                onToggleVoice();
                onClose();
              }}
            >
              <View style={{
                width: 42, height: 42, borderRadius: 12,
                backgroundColor: !isSpeechEnabled ? theme.primaryBg : theme.border,
                borderWidth: 1,
                borderColor: !isSpeechEnabled ? theme.primaryBorder : theme.border2,
                alignItems: 'center', justifyContent: 'center',
              }}>
                <MaterialIcons
                  name={isSpeechEnabled ? 'volume-up' : 'volume-off'}
                  size={22}
                  color={!isSpeechEnabled ? theme.primary : theme.textDim}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.drawerBtnTxt, !isSpeechEnabled && styles.drawerBtnTxtActive]}>
                  {isSpeechEnabled ? 'WYCISZ GŁOS' : 'WŁĄCZ GŁOS'}
                </Text>
                <Text style={[styles.drawerSectionLabel, { marginBottom: 0, marginTop: 2 }]}>
                  {isSpeechEnabled ? 'Wyłącz komunikaty głosowe' : 'Włącz komunikaty głosowe'}
                </Text>
              </View>
              {!isSpeechEnabled && (
                <View style={{
                  width: 22, height: 22, borderRadius: 11,
                  backgroundColor: theme.primary,
                  alignItems: 'center', justifyContent: 'center',
                }}>
                  <MaterialIcons name="volume-off" size={14} color="#fff" />
                </View>
              )}
            </TouchableOpacity>

            {/* Map type */}
            <TouchableOpacity
              style={styles.drawerBtn}
              activeOpacity={0.72}
              onPress={() => {
                onClose();
                onOpenMapType();
              }}
            >
              <View style={{
                width: 42, height: 42, borderRadius: 12,
                backgroundColor: theme.border,
                borderWidth: 1, borderColor: theme.border2,
                alignItems: 'center', justifyContent: 'center',
              }}>
                <MaterialCommunityIcons name="layers-outline" size={22} color={theme.textDim} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.drawerBtnTxt}>TYP MAPY</Text>
                <Text style={[styles.drawerSectionLabel, { marginBottom: 0, marginTop: 2 }]}>
                  Zmień widok mapy
                </Text>
              </View>
              <MaterialIcons name="chevron-right" size={20} color={theme.textDim} />
            </TouchableOpacity>

            {/* Route building */}
            <TouchableOpacity
              style={[
                styles.drawerBtn,
                isBuilding && { backgroundColor: '#db1e1e18', borderColor: '#db1e1e45' },
              ]}
              activeOpacity={0.72}
              onPress={() => {
                if (isBuilding) {
                  if (pinsCount >= 2) {
                    onFinishBuilding();
                  } else {
                    onCancelBuilding();
                  }
                } else {
                  onStartBuilding();
                }
                onClose();
              }}
            >
              <View style={{
                width: 42, height: 42, borderRadius: 12,
                backgroundColor: isBuilding ? '#db1e1e25' : theme.primaryBg,
                borderWidth: 1,
                borderColor: isBuilding ? '#db1e1e70' : theme.primaryBorder,
                alignItems: 'center', justifyContent: 'center',
              }}>
                <MaterialCommunityIcons
                  name={isBuilding ? 'check' : 'map-marker-path'}
                  size={22}
                  color={isBuilding ? '#db1e1e' : theme.primary}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[
                  styles.drawerBtnTxt,
                  isBuilding && { color: '#db1e1e' },
                ]}>
                  {isBuilding ? (pinsCount >= 2 ? 'ZAKOŃCZ TRASĘ' : 'ANULUJ TRASĘ') : 'UTWÓRZ TRASĘ'}
                </Text>
                <Text style={[styles.drawerSectionLabel, { marginBottom: 0, marginTop: 2 }]}>
                  {isBuilding
                    ? (pinsCount >= 2 ? 'Zapisz zaznaczoną trasę' : 'Anuluj tworzenie trasy')
                    : 'Dotykaj mapę aby dodać punkty'}
                </Text>
              </View>
            </TouchableOpacity>

            {/* Close */}
            <TouchableOpacity style={styles.drawerCloseBtn} onPress={onClose}>
              <MaterialIcons name="close" size={18} color={theme.textMuted} />
            </TouchableOpacity>

          </View>
        </SafeAreaView>
      </Modal>
    );
  },
);
