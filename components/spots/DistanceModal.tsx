import React from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { DISTANCE_OPTIONS } from '../../constants/spotTypes';

interface DistanceModalProps {
  visible: boolean;
  maxDistance: number;
  onSelect: (d: number) => void;
  onClose: () => void;
}

export const DistanceModal = ({ visible, maxDistance, onSelect, onClose }: DistanceModalProps) => (
  <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
    <View style={s.overlay}>
      <View style={s.container}>
        <View style={s.header}>
          <Text style={s.title}>📡 ZASIĘG SPOTÓW</Text>
          <TouchableOpacity onPress={onClose}>
            <MaterialIcons name="close" size={24} color="#ffffff80" />
          </TouchableOpacity>
        </View>
        <View style={s.row}>
          {DISTANCE_OPTIONS.map(d => (
            <TouchableOpacity
              key={d}
              style={[s.option, maxDistance === d && s.optionActive]}
              onPress={() => { onSelect(d); onClose(); }}
              activeOpacity={0.8}
            >
              <Text style={[s.optionText, maxDistance === d && { color: '#e33835' }]}>
                {d} km
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
    </View>
  </Modal>
);

const s = StyleSheet.create({
  overlay:      { flex: 1, backgroundColor: '#000000aa', justifyContent: 'flex-end' },
  container:    { backgroundColor: '#161616', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20 },
  header:       { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  title:        { color: '#fff', fontSize: 15, fontWeight: '700', letterSpacing: 1 },
  row:          { flexDirection: 'row', gap: 12, paddingBottom: 8 },
  option:       { flex: 1, height: 52, borderRadius: 12, backgroundColor: '#1a1a1a', justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: '#ffffff10' },
  optionActive: { borderColor: '#e33835', backgroundColor: '#e3383515' },
  optionText:   { color: '#ffffff60', fontSize: 15, fontWeight: '700' },
});