import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  FlatList,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { ModalKeyboardSheet } from '../layout/ModalKeyboardSheet';
import { Spot, CATEGORY_COLORS, CATEGORY_ICONS } from '../../constants/spotTypes';
import { SortMode } from '../../hooks/useSpots';
import { useTheme } from '../../contexts/ThemeContext';

interface SpotListModalProps {
  visible: boolean; onClose: () => void; spots: Spot[]; maxDistance: number;
  onSelectSpot: (spot: Spot) => void; getDistance: (spot: Spot) => number;
  sortMode: SortMode; onSortChange: (mode: SortMode) => void;
}

const SORT_OPTIONS: { mode: SortMode; label: string; icon: string }[] = [
  { mode: 'distance', label: 'Odległość', icon: 'near-me'   },
  { mode: 'likes',    label: 'Polubienia', icon: 'favorite' },
  { mode: 'newest',   label: 'Najnowsze',  icon: 'schedule' },
];

export const SpotListModal = ({ visible, onClose, spots, maxDistance, onSelectSpot, getDistance, sortMode, onSortChange }: SpotListModalProps) => {
  const { theme } = useTheme();
  const [query, setQuery] = useState('');

  const filtered = query.trim()
    ? spots.filter(s => s.name.toLowerCase().includes(query.toLowerCase()) || s.category.toLowerCase().includes(query.toLowerCase()))
    : spots;

  return (
    <ModalKeyboardSheet visible={visible} onClose={onClose} maxHeight="85%" sheetStyle={{ padding: 20, paddingHorizontal: 20 }}>

          {/* Header */}
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <Text style={{ color: theme.text, fontSize: 15, fontWeight: '700', letterSpacing: 1 }}>🗺️ SPOTY W POBLIŻU</Text>
            <TouchableOpacity onPress={onClose}>
              <MaterialIcons name="close" size={24} color={theme.textDim} />
            </TouchableOpacity>
          </View>

          {/* Sortowanie */}
          <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
            {SORT_OPTIONS.map(opt => (
              <TouchableOpacity
                key={opt.mode}
                style={[{
                  flexDirection: 'row', alignItems: 'center', gap: 5,
                  paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10,
                  backgroundColor: theme.surface3, borderWidth: 1, borderColor: theme.border2,
                }, sortMode === opt.mode && { borderColor: theme.primaryBorder2, backgroundColor: theme.primaryBg }]}
                onPress={() => onSortChange(opt.mode)} activeOpacity={0.8}
              >
                <MaterialIcons name={opt.icon as any} size={13} color={sortMode === opt.mode ? theme.primary : theme.textDim} />
                <Text style={{ color: sortMode === opt.mode ? theme.primary : theme.textDim, fontSize: 12, fontWeight: '600' }}>{opt.label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Szukaj */}
          <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: theme.surface3, borderRadius: 12, paddingHorizontal: 14, height: 50, borderWidth: 1, borderColor: theme.border2, marginBottom: 12 }}>
            <MaterialIcons name="search" size={18} color={theme.primary} />
            <TextInput
              style={{ flex: 1, color: theme.text, fontSize: 13, marginLeft: 10 }}
              placeholder="Szukaj miejscówki..." placeholderTextColor={theme.textDim}
              value={query} onChangeText={setQuery}
            />
            {query.length > 0 && (
              <TouchableOpacity onPress={() => setQuery('')}>
                <MaterialIcons name="close" size={16} color={theme.textDim} />
              </TouchableOpacity>
            )}
          </View>

          <FlatList
            data={filtered} keyExtractor={item => item.id}
            showsVerticalScrollIndicator={false}
            ListEmptyComponent={
              <View style={{ alignItems: 'center', paddingVertical: 40, gap: 8 }}>
                <MaterialIcons name="search-off" size={40} color={theme.border3} />
                <Text style={{ color: theme.textDim, fontSize: 13 }}>Brak spotów w zasięgu {maxDistance} km</Text>
              </View>
            }
            renderItem={({ item }) => (
              <TouchableOpacity
                style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: theme.border }}
                onPress={() => { onSelectSpot(item); onClose(); }} activeOpacity={0.8}
              >
                <View style={{ width: 40, height: 40, borderRadius: 10, backgroundColor: CATEGORY_COLORS[item.category] + '22', justifyContent: 'center', alignItems: 'center' }}>
                  <MaterialIcons name={CATEGORY_ICONS[item.category] as any} size={20} color={CATEGORY_COLORS[item.category]} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: theme.text, fontSize: 13, fontWeight: '600' }}>{item.name}</Text>
                  <Text style={{ color: theme.textDim, fontSize: 11, marginTop: 2 }}>{item.category} · {getDistance(item).toFixed(1)} km</Text>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, marginRight: 4 }}>
                  <MaterialIcons name="favorite" size={11} color={theme.primaryBorder2} />
                  <Text style={{ color: theme.textDim, fontSize: 11 }}>{item.likesCount}</Text>
                </View>
                <MaterialIcons name="chevron-right" size={20} color={theme.textFaint} />
              </TouchableOpacity>
            )}
          />
    </ModalKeyboardSheet>
  );
};