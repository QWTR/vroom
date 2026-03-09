import React, { memo } from 'react';
import { Modal, SafeAreaView, View, Text, TouchableOpacity, ScrollView } from 'react-native';
import { MaterialIcons, MaterialCommunityIcons } from '@expo/vector-icons';
import Toast from 'react-native-toast-message';
import { styles } from '../../styles/mapstyle';

interface ReportModalProps {
  visible: boolean;
  onClose: () => void;
}

const REPORT_ITEMS = [
  { icon: 'traffic',          label: 'Korek',   color: '#ff6b6b' },
  { icon: 'cloud-alert',      label: 'Pogoda',  color: '#ffd43b' },
  { icon: 'alert-circle',     label: 'Wypadek', color: '#ff922b' },
  { icon: 'car-light-dimmed', label: 'Auto',    color: '#748ffc' },
] as const;

export const ReportModal = memo(({ visible, onClose }: ReportModalProps) => (
  <Modal visible={visible} animationType="slide" transparent>
    <SafeAreaView style={styles.drawerModalContainer}>
      <View style={styles.drawerModal}>
        <TouchableOpacity style={styles.drawerCloseBtn} onPress={onClose}>
          <MaterialIcons name="close" size={24} color="#fff" />
        </TouchableOpacity>

        <Text style={styles.drawerTitle}>Zgłoś problem</Text>

        <ScrollView showsVerticalScrollIndicator={false}>
          {REPORT_ITEMS.map(item => (
            <TouchableOpacity
              key={item.label}
              style={styles.reportItem}
              activeOpacity={0.7}
              onPress={() => {
                Toast.show({ type: 'success', text1: 'ZGŁOSZONO', text2: item.label });
                onClose();
              }}
            >
              <MaterialCommunityIcons name={item.icon} size={24} color={item.color} />
              <Text style={styles.reportItemText}>{item.label}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>
    </SafeAreaView>
  </Modal>
));