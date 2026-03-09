import React, { useState } from 'react';
import {
  Modal, View, Text, TextInput, TouchableOpacity,
  FlatList, StyleSheet,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { Spot, CATEGORY_COLORS, CATEGORY_ICONS } from '../../constants/spotTypes';

interface SpotListModalProps {
  visible: boolean;
  onClose: () => void;
  spots: Spot[];
  maxDistance: number;
  onSelectSpot: (spot: Spot) => void;
  getDistance: (spot: Spot) => number;
}

export const SpotListModal = ({
  visible, onClose, spots, maxDistance, onSelectSpot, getDistance,
}: SpotListModalProps) => {
  const [query, setQuery] = useState('');

  const filtered = query.trim()
    ? spots.filter(s =>
        s.name.toLowerCase().includes(query.toLowerCase()) ||
        s.category.toLowerCase().includes(query.toLowerCase())
      )
    : spots;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={s.overlay}>
        <View style={s.container}>
          <View style={s.header}>
            <Text style={s.title}>🗺️ SPOTY W POBLIŻU</Text>
            <TouchableOpacity onPress={onClose}>
              <MaterialIcons name="close" size={24} color="#ffffff80" />
            </TouchableOpacity>
          </View>

          <View style={s.inputWrapper}>
            <MaterialIcons name="search" size={18} color="#e33835" />
            <TextInput
              style={s.input}
              placeholder="Szukaj miejscówki..."
              placeholderTextColor="#ffffff30"
              value={query}
              onChangeText={setQuery}
            />
            {query.length > 0 && (
              <TouchableOpacity onPress={() => setQuery('')}>
                <MaterialIcons name="close" size={16} color="#ffffff50" />
              </TouchableOpacity>
            )}
          </View>

          <FlatList
            data={filtered}
            keyExtractor={item => item.id}
            showsVerticalScrollIndicator={false}
            ListEmptyComponent={
              <View style={s.empty}>
                <MaterialIcons name="search-off" size={40} color="#ffffff20" />
                <Text style={s.emptyText}>Brak spotów w zasięgu {maxDistance} km</Text>
              </View>
            }
            renderItem={({ item }) => (
              <TouchableOpacity
                style={s.item}
                onPress={() => { onSelectSpot(item); onClose(); }}
                activeOpacity={0.8}
              >
                <View style={[s.icon, { backgroundColor: CATEGORY_COLORS[item.category] + '22' }]}>
                  <MaterialIcons
                    name={CATEGORY_ICONS[item.category] as any}
                    size={20}
                    color={CATEGORY_COLORS[item.category]}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.name}>{item.name}</Text>
                  <Text style={s.meta}>{item.category} · {getDistance(item).toFixed(1)} km</Text>
                </View>
                <MaterialIcons name="chevron-right" size={20} color="#ffffff30" />
              </TouchableOpacity>
            )}
          />
        </View>
      </View>
    </Modal>
  );
};

const s = StyleSheet.create({
  overlay:      { flex: 1, backgroundColor: '#000000aa', justifyContent: 'flex-end' },
  container:    { backgroundColor: '#161616', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, maxHeight: '85%' },
  header:       { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  title:        { color: '#fff', fontSize: 15, fontWeight: '700', letterSpacing: 1 },
  inputWrapper: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1a1a1a', borderRadius: 12, paddingHorizontal: 14, height: 50, borderWidth: 1, borderColor: '#ffffff10', marginBottom: 12 },
  input:        { flex: 1, color: '#fff', fontSize: 13, marginLeft: 10 },
  item:         { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#ffffff08' },
  icon:         { width: 40, height: 40, borderRadius: 10, justifyContent: 'center', alignItems: 'center' },
  name:         { color: '#fff', fontSize: 13, fontWeight: '600' },
  meta:         { color: '#ffffff40', fontSize: 11, marginTop: 2 },
  empty:        { alignItems: 'center', paddingVertical: 40, gap: 8 },
  emptyText:    { color: '#ffffff30', fontSize: 13 },
});