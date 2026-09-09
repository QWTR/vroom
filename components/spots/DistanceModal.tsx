import React from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Modal, View, TouchableOpacity, ScrollView } from 'react-native';
import { AppText as Text } from '../ui/AppText';
import { MaterialIcons } from '@expo/vector-icons';
import { DISTANCE_OPTIONS } from '../../constants/spotTypes';
import { useMapHudTheme as useTheme } from '../map/useMapHudTheme';

interface DistanceModalProps {
  visible: boolean;
  maxDistance: number;
  onSelect: (d: number) => void;
  onClose: () => void;
}

export const DistanceModal = ({ visible, maxDistance, onSelect, onClose }: DistanceModalProps) => {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: theme.overlay, justifyContent: 'flex-end' }}>
        <View style={{ backgroundColor: theme.surface, borderTopLeftRadius: 30, borderTopRightRadius: 30, padding: 20, paddingBottom: Math.max(insets.bottom, 16) + 16 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
            <Text style={{ color: theme.text, fontSize: 23, fontWeight: '800', letterSpacing: -0.4 }}>Jak daleko szukamy?</Text>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="Zamknij wybór zasięgu" onPress={onClose} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
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
                  minWidth: 80, height: 64, borderRadius: 18, paddingHorizontal: 10,
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
