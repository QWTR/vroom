import React, { useState } from 'react';
import {
  View, Text, Modal, TouchableOpacity,
  Pressable, Platform, ScrollView,
} from 'react-native';
import { MaterialCommunityIcons, MaterialIcons } from '@expo/vector-icons';
import { useTheme } from '../../contexts/ThemeContext';

export type CameraType = 'fixed' | 'section' | 'mobile' | 'bump';

interface Props {
  visible:   boolean;
  onClose:   () => void;
  onConfirm: (params: {
    maxspeed:    number | null;
    type:        CameraType;
    description: string | null;
  }) => void;
}

const SPEEDS = [20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140];

const CAM_TYPES: {
  value: CameraType; label: string; icon: string; desc: string; color: string;
}[] = [
  { value: 'fixed',   label: 'STAŁY',     icon: 'camera-outline',    desc: 'Fotoradar stacjonarny', color: '#e33835' },
  { value: 'section', label: 'ODCINKOWY', icon: 'camera-timer',      desc: 'Pomiar odcinkowy',      color: '#ff922b' },
  { value: 'mobile',  label: 'MOBILNY',   icon: 'car-speed-limiter', desc: 'Mobilna kontrola',      color: '#FFD700' },
  { value: 'bump',    label: 'PRÓG',      icon: 'speedometer-slow',  desc: 'Próg zwalniający',      color: '#4de926' },
];

export function AddSpeedCameraModal({ visible, onClose, onConfirm }: Props) {
  const { theme, isDark } = useTheme();
  const [selectedSpeed, setSelectedSpeed] = useState<number | null>(null);
  const [selectedType,  setSelectedType]  = useState<CameraType>('fixed');

  const isBump = selectedType === 'bump';

  const handleConfirm = () => {
    onConfirm({
      maxspeed:    isBump ? null : selectedSpeed,
      type:        selectedType,
      description: null,
    });
    setSelectedSpeed(null);
    setSelectedType('fixed');
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: '#000000bb', justifyContent: 'flex-end' }}>
        <Pressable
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
          onPress={onClose}
        />
        <View style={{
          backgroundColor:      theme.surface,
          borderTopLeftRadius:  24,
          borderTopRightRadius: 24,
          borderTopWidth:       1,
          borderColor:          theme.border2,
          paddingBottom:        Platform.OS === 'ios' ? 34 : 20,
        }}>
          <View style={{
            width: 40, height: 4, borderRadius: 2,
            backgroundColor: theme.border3,
            alignSelf: 'center', marginTop: 12,
          }} />

          <ScrollView contentContainerStyle={{ padding: 16 }}>
            {/* Nagłówek */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 20 }}>
              <View style={{
                width: 38, height: 38, borderRadius: 11,
                backgroundColor: '#e3383520', borderWidth: 1, borderColor: '#e3383540',
                alignItems: 'center', justifyContent: 'center',
              }}>
                <MaterialCommunityIcons name="camera-plus-outline" size={20} color="#e33835" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: 'Orbitron', fontSize: 13, color: theme.text, fontWeight: '700' }}>
                  ZGŁOŚ PRZESZKODĘ
                </Text>
                <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: theme.textDim, marginTop: 2 }}>
                  Twoja lokalizacja GPS zostanie użyta
                </Text>
              </View>
              <TouchableOpacity onPress={onClose}>
                <MaterialIcons name="close" size={20} color={theme.textDim} />
              </TouchableOpacity>
            </View>

            {/* Typ */}
            <Text style={{
              fontFamily: 'Orbitron', fontSize: 9,
              color: theme.textDim, letterSpacing: 1, marginBottom: 8,
            }}>
              TYP
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 20 }}>
              {CAM_TYPES.map(ct => (
                <TouchableOpacity
                  key={ct.value}
                  onPress={() => setSelectedType(ct.value)}
                  style={{
                    width:           '47%',
                    padding:         12,
                    borderRadius:    14,
                    flexDirection:   'row',
                    alignItems:      'center',
                    gap:             10,
                    backgroundColor: selectedType === ct.value
                      ? ct.color + '20'
                      : (isDark ? '#ffffff08' : '#00000008'),
                    borderWidth:  1.5,
                    borderColor:  selectedType === ct.value ? ct.color : theme.border,
                  }}
                >
                  <View style={{
                    width:           34,
                    height:          34,
                    borderRadius:    9,
                    backgroundColor: selectedType === ct.value ? ct.color + '25' : theme.surface2,
                    alignItems:      'center',
                    justifyContent:  'center',
                  }}>
                    <MaterialCommunityIcons
                      name={ct.icon as any}
                      size={18}
                      color={selectedType === ct.value ? ct.color : theme.textDim}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{
                      fontFamily: 'Orbitron', fontSize: 9,
                      color:      selectedType === ct.value ? ct.color : theme.text,
                      fontWeight: '700',
                    }}>
                      {ct.label}
                    </Text>
                    <Text style={{
                      fontFamily: 'Orbitron', fontSize: 7,
                      color: theme.textDim, marginTop: 2,
                    }}>
                      {ct.desc}
                    </Text>
                  </View>
                </TouchableOpacity>
              ))}
            </View>

            {/* Limit — tylko gdy nie próg */}
            {!isBump && (
              <>
                <Text style={{
                  fontFamily: 'Orbitron', fontSize: 9,
                  color: theme.textDim, letterSpacing: 1, marginBottom: 8,
                }}>
                  LIMIT PRĘDKOŚCI (opcjonalnie)
                </Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 24 }}>
                  {/* Nieznany */}
                  <TouchableOpacity
                    onPress={() => setSelectedSpeed(null)}
                    style={{
                      width:           50,
                      height:          50,
                      borderRadius:    25,
                      alignItems:      'center',
                      justifyContent:  'center',
                      backgroundColor: selectedSpeed === null
                        ? (isDark ? '#ffffff15' : '#00000010')
                        : theme.surface2,
                      borderWidth: 2,
                      borderColor: selectedSpeed === null ? theme.textDim : theme.border,
                    }}
                  >
                    <Text style={{
                      fontFamily: 'Orbitron', fontSize: 10,
                      color: selectedSpeed === null ? theme.text : theme.textDim,
                    }}>?</Text>
                  </TouchableOpacity>

                  {SPEEDS.map(s => (
                    <TouchableOpacity
                      key={s}
                      onPress={() => setSelectedSpeed(s === selectedSpeed ? null : s)}
                      style={{
                        width:           50,
                        height:          50,
                        borderRadius:    25,
                        alignItems:      'center',
                        justifyContent:  'center',
                        backgroundColor: selectedSpeed === s ? '#fff' : theme.surface2,
                        borderWidth:     3,
                        borderColor:     selectedSpeed === s ? '#cc0000' : theme.border,
                      }}
                    >
                      <Text style={{
                        fontFamily: 'Orbitron',
                        fontSize:   s >= 100 ? 9 : 11,
                        color:      selectedSpeed === s ? '#111' : theme.textDim,
                        fontWeight: '900',
                      }}>
                        {s}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </>
            )}

            {/* Przycisk */}
            <TouchableOpacity
              onPress={handleConfirm}
              style={{
                backgroundColor: isBump ? '#4de926' : '#e33835',
                borderRadius:    14,
                paddingVertical: 14,
                alignItems:      'center',
                flexDirection:   'row',
                justifyContent:  'center',
                gap:             8,
              }}
              activeOpacity={0.85}
            >
              <MaterialCommunityIcons
                name={isBump ? 'speedometer-slow' : 'camera-plus-outline'}
                size={18}
                color="#fff"
              />
              <Text style={{
                fontFamily: 'Orbitron', fontSize: 12,
                color: '#fff', fontWeight: '700', letterSpacing: 1,
              }}>
                {isBump ? 'DODAJ PRÓG' : 'DODAJ FOTORADAR'}
              </Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}