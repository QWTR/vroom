import React, { memo } from 'react';
import { Modal, SafeAreaView, View, Text, TouchableOpacity } from 'react-native';
import { MaterialIcons, MaterialCommunityIcons } from '@expo/vector-icons';
import Toast from 'react-native-toast-message';
import { styles } from '../../styles/mapstyle';

interface SettingsModalProps {
  visible: boolean;
  mapType: string;
  onChangeMapType: (type: string) => void;
  onClose: () => void;
}

const MAP_TYPES = [
  { key: 'standard',  label: 'Standardowa', icon: 'map-outline',      desc: 'Domyślny widok mapy'    },
  { key: 'satellite', label: 'Satelita',    icon: 'satellite-variant', desc: 'Zdjęcia z satelity'    },
  { key: 'hybrid',    label: 'Hybrid',      icon: 'layers-outline',    desc: 'Satelita + ulice'      },
  { key: 'terrain',   label: 'Teren',       icon: 'terrain',           desc: 'Rzeźba terenu'         },
] as const;

export const SettingsModal = memo(
  ({ visible, mapType, onChangeMapType, onClose }: SettingsModalProps) => (
    <Modal visible={visible} animationType="slide" transparent>
      <SafeAreaView style={styles.drawerModalContainer}>
        <View style={styles.drawerModal}>

          {/* Handle */}
          <View style={styles.drawerHandle} />

          {/* Header */}
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
            <View style={{
              backgroundColor: '#e3383518', padding: 8, borderRadius: 10,
              borderWidth: 1, borderColor: '#e3383535', marginRight: 12,
            }}>
              <MaterialIcons name="layers" size={18} color="#e33835ce" />
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
                {/* Ikona */}
                <View style={{
                  width: 42,
                  height: 42,
                  borderRadius: 12,
                  backgroundColor: isActive ? '#e3383525' : '#ffffff08',
                  borderWidth: 1,
                  borderColor: isActive ? '#e3383545' : '#ffffff10',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}>
                  <MaterialCommunityIcons
                    name={icon as any}
                    size={22}
                    color={isActive ? '#e33835ce' : '#ffffff55'}
                  />
                </View>

                {/* Tekst */}
                <View style={{ flex: 1 }}>
                  <Text style={[styles.drawerBtnTxt, isActive && styles.drawerBtnTxtActive]}>
                    {label}
                  </Text>
                  <Text style={[styles.drawerSectionLabel, { marginBottom: 0, marginTop: 2 }]}>
                    {desc}
                  </Text>
                </View>

                {/* Check */}
                {isActive && (
                  <View style={{
                    width: 22, height: 22, borderRadius: 11,
                    backgroundColor: '#e33835ce',
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
            <MaterialIcons name="close" size={18} color="#ffffff70" />
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </Modal>
  ),
);