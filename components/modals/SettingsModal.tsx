import React, { memo } from 'react';
import { Modal, View, Text, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialIcons, MaterialCommunityIcons } from '@expo/vector-icons';
import Toast from 'react-native-toast-message';
import { makeMapStyles } from '../../styles/mapstyle';
import { useTheme } from '../../contexts/ThemeContext';
import { useModalBackHandler } from '../../hooks/useModalBackHandler';
interface SettingsModalProps {
  visible: boolean;
  mapType: string;
  onChangeMapType: (type: string) => void;
  onClose: () => void;
}

const MAP_TYPES = [
  { key: 'standard',  label: 'Standardowa', icon: 'map-outline',      desc: 'Domyślny widok mapy' },
  { key: 'satellite', label: 'Satelita',    icon: 'satellite-variant', desc: 'Zdjęcia z satelity'  },
  { key: 'hybrid',    label: 'Hybrid',      icon: 'layers-outline',    desc: 'Satelita + ulice'    },
  { key: 'terrain',   label: 'Teren',       icon: 'terrain',           desc: 'Rzeźba terenu'       },
] as const;

export const SettingsModal = memo(
  ({ visible, mapType, onChangeMapType, onClose }: SettingsModalProps) => {
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
                <MaterialIcons name="layers" size={18} color={theme.primary} />
              </View>
              <Text style={styles.drawerTitle}>TYP MAPY</Text>
            </View>

            <View style={styles.drawerDivider} />
            <Text style={styles.drawerSectionLabel}>WYBIERZ WIDOK</Text>

            {MAP_TYPES.map(({ key, label, icon, desc }) => {
              const isActive = mapType === key;
              return (
                <TouchableOpacity
                  key={key}
                  style={[styles.drawerBtn, isActive && styles.drawerBtnActive]}
                  activeOpacity={0.72}
                  onPress={() => {
                    onChangeMapType(key);
                    onClose();
                    Toast.show({ type: 'success', text1: 'TYP MAPY', text2: label });
                  }}
                >
                  <View style={{
                    width: 42, height: 42, borderRadius: 12,
                    backgroundColor: isActive ? theme.primaryBg  : theme.border,
                    borderWidth: 1,
                    borderColor:     isActive ? theme.primaryBorder : theme.border2,
                    alignItems: 'center', justifyContent: 'center',
                  }}>
                    <MaterialCommunityIcons
                      name={icon as any}
                      size={22}
                      color={isActive ? theme.primary : theme.textDim}
                    />
                  </View>

                  <View style={{ flex: 1 }}>
                    <Text style={[styles.drawerBtnTxt, isActive && styles.drawerBtnTxtActive]}>
                      {label}
                    </Text>
                    <Text style={[styles.drawerSectionLabel, { marginBottom: 0, marginTop: 2 }]}>
                      {desc}
                    </Text>
                  </View>

                  {isActive && (
                    <View style={{
                      width: 22, height: 22, borderRadius: 11,
                      backgroundColor: theme.primary,
                      alignItems: 'center', justifyContent: 'center',
                    }}>
                      <MaterialIcons name="check" size={14} color="#fff" />
                    </View>
                  )}
                </TouchableOpacity>
              );
            })}

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