import React from 'react';
import { TouchableOpacity, View, Image, StyleSheet } from 'react-native';
import { Text } from '@react-navigation/elements';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';

interface Props {
  brand:      string;
  specs:      string;
  isMain:     boolean;
  firstPhoto?: string;
  onPress?:   () => void;
}

export default function CarCard({ brand, specs, isMain, firstPhoto, onPress }: Props) {
  return (
    <TouchableOpacity style={styles.carCard} onPress={onPress}>
      <View style={styles.carIconBox}>
        {firstPhoto ? (
          <Image source={{ uri: firstPhoto }} style={styles.carThumb} />
        ) : (
          <MaterialIcons name="directions-car" size={24} color={isMain ? '#e33835' : '#ffffff40'} />
        )}
      </View>
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Text style={styles.carBrand}>{brand}</Text>
          {isMain && (
            <View style={styles.mainBadge}>
              <Text style={styles.mainBadgeText}>GŁÓWNE</Text>
            </View>
          )}
        </View>
        <Text style={styles.carSpecs}>{specs}</Text>
      </View>
      <MaterialIcons name="chevron-right" size={24} color="#ffffff40" />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  carCard:       { backgroundColor: '#1a1a1a', borderRadius: 12, padding: 15, flexDirection: 'row', alignItems: 'center', marginBottom: 10, borderWidth: 1, borderColor: '#ffffff05' },
  carIconBox:    { backgroundColor: '#252525', width: 48, height: 48, borderRadius: 10, marginRight: 15, justifyContent: 'center', alignItems: 'center', overflow: 'hidden' },
  carThumb:      { width: 48, height: 48 },
  carBrand:      { fontFamily: 'Orbitron', color: '#fff', fontSize: 14 },
  carSpecs:      { fontFamily: 'Orbitron', color: '#ffffff40', fontSize: 11, marginTop: 4 },
  mainBadge:     { backgroundColor: '#e3383520', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4, marginLeft: 10, borderWidth: 1, borderColor: '#e3383540' },
  mainBadgeText: { fontFamily: 'Orbitron', color: '#e33835', fontSize: 8 },
});