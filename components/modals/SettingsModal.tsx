import React, { memo } from 'react';
import { Modal, SafeAreaView, View, Text, TouchableOpacity } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import Toast from 'react-native-toast-message';
import { styles } from '../../styles/mapstyle';

interface SettingsModalProps {
  visible: boolean;
  mapType: string;
  onChangeMapType: (type: string) => void;
  onClose: () => void;
}

const MAP_TYPES = [
  { key: 'standard',  label: 'Standardowa' },
  { key: 'satellite', label: 'Satelita'    },
  { key: 'hybrid',    label: 'Hybrid'      },
  { key: 'terrain',   label: 'Teren'       },
] as const;

export const SettingsModal = memo(
  ({ visible, mapType, onChangeMapType, onClose }: SettingsModalProps) => (
    <Modal visible={visible} animationType="slide" transparent>
      <SafeAreaView style={styles.drawerModalContainer}>
        <View style={styles.drawerModal}>
          <TouchableOpacity style={styles.drawerCloseBtn} onPress={onClose}>
            <MaterialIcons name="close" size={24} color="#fff" />
          </TouchableOpacity>

          <Text style={styles.drawerTitle}>Mapa</Text>

          <View style={{ marginVertical: 16 }}>
            {MAP_TYPES.map(({ key, label }) => (
              <TouchableOpacity
                key={key}
                style={styles.drawerBtn}
                activeOpacity={0.7}
                onPress={() => {
                  onChangeMapType(key);
                  onClose();
                  Toast.show({ type: 'success', text1: 'TYP MAPY', text2: `Zmieniono na ${label}` });
                }}
              >
                <View style={[styles.drawerBtnIcon, mapType === key && { backgroundColor: '#e33835ce' }]}>
                  <View style={styles.drawerBtnIconInner} />
                </View>
                <Text style={[styles.drawerBtnTxt, mapType === key && { color: '#e33835ce', fontWeight: 'bold' }]}>
                  {label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </SafeAreaView>
    </Modal>
  ),
);