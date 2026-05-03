import React from 'react';
import { Modal, View, Text, TouchableOpacity, ScrollView } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { DISTANCE_OPTIONS } from '../../constants/spotTypes';
import { useTheme } from '../../contexts/ThemeContext';

interface DistanceModalProps {
  visible: boolean;
  maxDistance: number;
  onSelect: (d: number) => void;
  onClose: () => void;
}

export const DistanceModal = ({ visible, maxDistance, onSelect, onClose }: DistanceModalProps) => {
  const { theme } = useTheme();
  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: theme.overlay, justifyContent: 'flex-end' }}>
        <View style={{ backgroundColor: theme.surface2, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
            <Text style={{ color: theme.text, fontSize: 15, fontWeight: '700', letterSpacing: 1 }}>📡 ZASIĘG SPOTÓW</Text>
            <TouchableOpacity onPress={onClose}>
              <MaterialIcons name="close" size={24} color={theme.textDim} />
            </TouchableOpacity>
          </View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ flexDirection: 'row', gap: 10, paddingBottom: 8, paddingRight: 4 }}
          >
            {DISTANCE_OPTIONS.map(d => (
              <TouchableOpacity
                key={d}
                style={[{
                  minWidth: 72, height: 52, borderRadius: 12, paddingHorizontal: 10,
                  backgroundColor: theme.surface3, justifyContent: 'center', alignItems: 'center',
                  borderWidth: 1, borderColor: theme.border2,
                }, maxDistance === d && { borderColor: theme.primary, backgroundColor: theme.primaryBg }]}
                onPress={() => { onSelect(d); onClose(); }} activeOpacity={0.8}
              >
                <Text style={{ color: maxDistance === d ? theme.primary : theme.textDim, fontSize: 14, fontWeight: '700' }}>
                  {d} km
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
};
